"""Shared prompt-building utilities for AI question generation."""

import uuid
from typing import TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.learning.models import Direction, KnowledgePoint, Major


class KnowledgePointPromptContext(TypedDict):
    selected_name: str
    selected_path: str
    major_name: str
    direction_name: str
    course_name: str
    ancestor_names: list[str]
    child_names: list[str]
    is_course: bool


DIFFICULTY_LABELS = {1: "容易", 2: "较易", 3: "中等", 4: "较难", 5: "很难"}


def _extract_keywords(raw_keywords: str) -> list[str]:
    return [item.strip() for item in raw_keywords.split(",") if item.strip()]


async def load_knowledge_point_prompt_contexts(
    db: AsyncSession,
    knowledge_point_ids: list[uuid.UUID],
) -> list[KnowledgePointPromptContext]:
    if not knowledge_point_ids:
        return []

    ordered_ids = list(dict.fromkeys(knowledge_point_ids))
    selected_rows = (
        await db.execute(
            select(KnowledgePoint, Direction, Major)
            .join(Direction, KnowledgePoint.direction_id == Direction.id)
            .join(Major, Direction.major_id == Major.id)
            .where(
                KnowledgePoint.id.in_(ordered_ids),
                KnowledgePoint.deleted_at.is_(None),
                Direction.deleted_at.is_(None),
                Major.deleted_at.is_(None),
            )
        )
    ).all()

    selected_map = {
        kp.id: (kp, direction, major)
        for kp, direction, major in selected_rows
    }
    if not selected_map:
        return []

    all_points: dict[uuid.UUID, KnowledgePoint] = {kp.id: kp for kp, _, _ in selected_rows}
    pending_parent_ids = {
        kp.parent_id
        for kp, _, _ in selected_rows
        if kp.parent_id is not None
    }

    while pending_parent_ids:
        parent_rows = (
            await db.execute(
                select(KnowledgePoint).where(
                    KnowledgePoint.id.in_(pending_parent_ids),
                    KnowledgePoint.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        pending_parent_ids = set()
        for parent in parent_rows:
            if parent.id in all_points:
                continue
            all_points[parent.id] = parent
            if parent.parent_id is not None and parent.parent_id not in all_points:
                pending_parent_ids.add(parent.parent_id)

    child_rows = (
        await db.execute(
            select(KnowledgePoint)
            .where(
                KnowledgePoint.parent_id.in_(ordered_ids),
                KnowledgePoint.deleted_at.is_(None),
            )
            .order_by(KnowledgePoint.name)
        )
    ).scalars().all()
    child_map: dict[uuid.UUID, list[str]] = {}
    for child in child_rows:
        if child.parent_id is None:
            continue
        child_map.setdefault(child.parent_id, []).append(child.name)

    # 选择了主知识（课程根节点）时，收集其下各级全部子知识点，供 AI 尽量覆盖。
    descendant_map: dict[uuid.UUID, list[str]] = {}
    root_direction_ids = {
        direction.id for kp, direction, _ in selected_rows if kp.parent_id is None
    }
    if root_direction_ids:
        direction_nodes = (
            await db.execute(
                select(KnowledgePoint)
                .where(
                    KnowledgePoint.direction_id.in_(root_direction_ids),
                    KnowledgePoint.deleted_at.is_(None),
                )
                .order_by(KnowledgePoint.name)
            )
        ).scalars().all()
        children_by_parent: dict[uuid.UUID, list[KnowledgePoint]] = {}
        for node in direction_nodes:
            if node.parent_id is not None:
                children_by_parent.setdefault(node.parent_id, []).append(node)
        for kp, _, _ in selected_rows:
            if kp.parent_id is not None:
                continue
            names: list[str] = []
            stack = list(children_by_parent.get(kp.id, []))
            while stack:
                current_node = stack.pop(0)
                names.append(current_node.name)
                stack.extend(children_by_parent.get(current_node.id, []))
            descendant_map[kp.id] = names

    contexts: list[KnowledgePointPromptContext] = []
    for kp_id in ordered_ids:
        row = selected_map.get(kp_id)
        if row is None:
            continue

        selected_kp, direction, major = row
        is_course = selected_kp.parent_id is None
        lineage: list[KnowledgePoint] = []
        current: KnowledgePoint | None = selected_kp
        while current is not None:
            lineage.append(current)
            current = all_points.get(current.parent_id) if current.parent_id else None
        lineage.reverse()

        contexts.append(
            {
                "selected_name": selected_kp.name,
                "selected_path": " > ".join(node.name for node in lineage),
                "major_name": major.name,
                "direction_name": direction.name,
                "course_name": lineage[0].name if lineage else selected_kp.name,
                "ancestor_names": [node.name for node in lineage[:-1]],
                "child_names": descendant_map.get(selected_kp.id, []) if is_course else child_map.get(selected_kp.id, []),
                "is_course": is_course,
            }
        )

    return contexts


def build_ai_generate_system_prompt(
    *,
    total_count: int,
    difficulty: int,
    type_distribution: dict[str, int],
    knowledge_keywords: str,
    user_prompt: str,
    course_name: str = "",
    exam_title: str = "",
    knowledge_contexts: list[KnowledgePointPromptContext] | None = None,
    material_text: str = "",
) -> str:
    difficulty_label = DIFFICULTY_LABELS.get(difficulty, "中等")

    if type_distribution:
        type_names = {
            "choice": "选择题(choice)",
            "single_choice": "单选题(choice，answer.correct 为单个字符串，content.multi=false)",
            "multi_choice": "多选题(choice，answer.correct 为数组，content.multi=true)",
            "true_false": "判断题(true_false)",
            "fill_in": "填空题(fill_in)",
            "short_answer": "简答题(short_answer)",
            "essay": "论述题(essay)",
            "code": "编程题(code)",
        }
        parts = [f"{type_names.get(qtype, qtype)} {count}题" for qtype, count in type_distribution.items()]
        type_instruction = (
            f"题型分布要求：{', '.join(parts)}。必须严格满足该分布，"
            "不得擅自替换题型；不得把代码题、简答题等改成选择题结构；"
            "例如要求 code 时，不能生成 choice/选择题。"
        )
    else:
        type_instruction = f"共生成 {total_count} 道题目，题型自行合理分配。"

    knowledge_contexts = knowledge_contexts or []
    knowledge_context_instruction = ""
    if knowledge_contexts:
        context_lines = ["知识点命题上下文（按权重从高到低理解）："]
        for index, context in enumerate(knowledge_contexts, start=1):
            context_lines.extend(
                [
                    f"{index}. 专业：{context['major_name']}",
                    f"   方向：{context['direction_name']}",
                    f"   主知识点（课程语境）：{context['course_name']}",
                    f"   当前重点知识点：{context['selected_name']}",
                    f"   上层知识链路：{context['selected_path']}",
                ]
            )
            if context["child_names"]:
                shown = "、".join(context["child_names"][:80])
                suffix = "等" if len(context["child_names"]) > 80 else ""
                if context.get("is_course"):
                    context_lines.append(f"   该主知识下需尽量覆盖的各级子知识点：{shown}{suffix}")
                else:
                    context_lines.append(f"   可参考的下级知识点：{shown}{suffix}")
        knowledge_context_instruction = "\n".join(context_lines)

    explicit_course_name = course_name.strip()
    explicit_exam_title = exam_title.strip()
    inferred_course_names = [
        context["course_name"].strip()
        for context in knowledge_contexts
        if context.get("course_name", "").strip()
    ]
    strict_course_name = explicit_course_name or (inferred_course_names[0] if inferred_course_names else "")
    strict_scope_lines = [
        "学科与上下文硬性边界：",
        "- 只允许依据本次请求中明确给出的课程、考试、专业、方向、知识点、资料和额外要求生成题目。",
        "- 必须忽略模型可能记住的任何无关历史对话、个人记忆、其它老师/其它学科/其它考试的上下文、先前生成过的数学或其它课程题目。",
        "- 不得主动迁移到与本次课程或考试无关的学科、术语、案例或题材；即使模型记忆中存在其它学科内容，也必须视为无效信息。",
        "- 如果模型内部记忆、历史上下文或常见示例与本次请求边界冲突，必须完全丢弃这些记忆，以本次课程/考试/知识点/资料为唯一依据。",
    ]
    if strict_course_name:
        strict_scope_lines.append(
            f"- 本次必须严格围绕课程/主知识点「{strict_course_name}」命题；题干、选项、答案和解析都必须符合该课程的学科语境。"
        )
    if explicit_exam_title:
        strict_scope_lines.append(
            f"- 本次考试/练习名称为「{explicit_exam_title}」；若课程名缺失，则以该考试/练习名称作为命题范围边界。"
        )
    if strict_course_name or explicit_exam_title:
        strict_scope_lines.append(
            "- 如果资料、额外要求或模型记忆中出现与上述课程/考试无关的内容，必须舍弃，不得据此出题。"
        )
    strict_scope_instruction = "\n".join(strict_scope_lines)

    coverage_instruction = ""
    if any(context.get("is_course") for context in knowledge_contexts):
        coverage_instruction = (
            f"本次选择了主知识（课程）整体，请结合题目总数（{total_count} 道）尽量均匀覆盖上述主知识下的各级子知识点，"
            "扩大知识点覆盖面，避免集中堆叠在少数知识点。"
        )
        if user_prompt.strip():
            coverage_instruction += "若与下方“额外要求”冲突，则以额外要求为主，并在其约束下尽量覆盖更多知识点。"

    keyword_instruction = ""
    keywords = _extract_keywords(knowledge_keywords)
    if keywords:
        keyword_instruction = f"补充参考关键词：{'、'.join(keywords)}。"

    extra_instruction = ""
    if user_prompt.strip():
        extra_instruction = f"额外要求：{user_prompt.strip()}"

    material_section = ""
    trimmed_material = material_text.strip()
    if trimmed_material:
        # 防止过长正文吃掉模型上下文，给个保险阈值（远高于通常 PDF 体量也够用）。
        if len(trimmed_material) > 60000:
            trimmed_material = trimmed_material[:60000] + "\n...（资料过长，已截断）"
        material_section = (
            "\n\n以下为用户提供的学习资料原文，请优先依据其中的概念、步骤和易错点出题，"
            "题目须能在资料中找到依据：\n"
            f"<<<MATERIAL>>>\n{trimmed_material}\n<<<END_MATERIAL>>>"
        )

    return f"""你是一位专业的考试命题教师。请根据以下要求生成考试题目。

要求：
- 难度级别：{difficulty_label}（{difficulty}/5）
- {strict_scope_instruction}
- {type_instruction}
- {knowledge_context_instruction}
- {coverage_instruction}
- {keyword_instruction}
- {extra_instruction}{material_section}

支持的题型代码：choice（选择题）、true_false（判断题）、fill_in（填空题）、short_answer（简答题）、essay（论述题）、code（编程题）

知识点理解与命题规则：
- 专业和方向用于确定学科边界、术语体系、案例背景，权重最高。
- 主知识点用于确定课程语境，是命题的核心范围，权重高于子知识点。
- 子知识点或下级知识点仅用于细化考查范围、能力点和表述侧重点，不能脱离主知识点单独命题。
- 若当前选择的是下层知识点，必须沿其父节点向上还原到主知识点、方向、专业后再理解题意。
- 若当前选择的知识点存在下级知识点，可将其作为细化参考，但不要超出当前主知识点语境。
- 若存在同名或近义知识点，优先采用当前专业/方向/主知识点链路下的含义，不得混入其它专业或方向的定义、案例、术语。
- 必须先判断当前课程/专业所属学科，严禁生成与当前课程、专业、方向、知识链路无关的语文、英语、文学、历史、常识类题目；除非当前课程本身就是这些学科。
- 命题前必须先在内部确认并锁定本次课程/考试边界，再在该边界内构造题目；不得沿用任何不属于该边界的模型记忆、过往对话、其它教师或其它学科内容。
- 若额外要求中提供了原题内容或源题参考，必须沿用原题的学科场景、术语体系、考查能力和同一子知识点，只能替换素材、数值或任务场景，不得迁移到其它学科。
- 同一次生成的一组题目必须互相区分，严禁出现重复题、同题改写题、题干/选项/答案/考查点基本相同的近似题；每道题应覆盖不同角度、任务或情境。

输出格式要求：
- 每道题目输出为一个独立的 JSON 对象，题目之间用换行分隔
- 不要输出 JSON 数组，不要添加 ```json 等标记
- type 字段必须严格使用系统题型代码；单选题和多选题都使用 "choice"，并通过 content.multi 与 answer.correct 格式区分
- 支持 LaTeX 公式：行内公式用 $...$，块级公式用 $$...$$
- 所有内容使用中文
- 题干和标题必须直接写题目内容，不要以“依据教材第X页”“根据资料第X页”“教材第X页”“参考课件第X页”等来源说明开头

每道题目的 JSON 格式：
{{
  "type": "题型代码",
  "title": "简短题目标题",
  "content": {{"text": "完整题目内容"}},
  "options": {{"A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D"}} 或 null,
  "answer": {{"correct": "A"}} 或 {{"text": "答案文本"}},
  "analysis": "详细解析",
  "difficulty": {difficulty}
}}

说明：
- 单选题(choice)的 content 必须包含 {{"multi": false}}，answer 使用 {{"correct": "A"}} 格式，options 为选项字典
- 多选题(choice)的 content 必须包含 {{"multi": true}}，answer 使用 {{"correct": ["A", "B"]}} 格式，options 为选项字典
- 选择题(choice)的 analysis 必须逐项覆盖所有选项，说明每个选项为什么正确或为什么错误；不得只解释正确选项，也不得遗漏任一选项标识。
- 判断题(true_false)的 answer 使用 {{"correct": "true"}} 或 {{"correct": "false"}}，options 设为 null
- 其他题型的 answer 使用 {{"text": "答案内容"}} 格式，options 设为 null
- 代码题(code)必须使用 {{"text": "参考答案"}} 格式，answer.text 不能为空；参考答案必须包含可执行/可判分的参考实现、关键代码或明确解法步骤
- 代码题(code)的 options 必须为 null，content.text 必须是编程任务描述，不能出现 A/B/C/D 选项

请现在开始生成题目。"""

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

    contexts: list[KnowledgePointPromptContext] = []
    for kp_id in ordered_ids:
        row = selected_map.get(kp_id)
        if row is None:
            continue

        selected_kp, direction, major = row
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
                "child_names": child_map.get(selected_kp.id, []),
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
    knowledge_contexts: list[KnowledgePointPromptContext] | None = None,
    material_text: str = "",
) -> str:
    difficulty_label = DIFFICULTY_LABELS.get(difficulty, "中等")

    if type_distribution:
        parts = [f"{qtype} {count}题" for qtype, count in type_distribution.items()]
        type_instruction = f"题型分布要求：{', '.join(parts)}。"
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
                context_lines.append(f"   可参考的下级知识点：{'、'.join(context['child_names'])}")
        knowledge_context_instruction = "\n".join(context_lines)

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
- {type_instruction}
- {knowledge_context_instruction}
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

输出格式要求：
- 每道题目输出为一个独立的 JSON 对象，题目之间用换行分隔
- 不要输出 JSON 数组，不要添加 ```json 等标记
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
- 选择题(choice)的 answer 使用 {{"correct": "A"}} 格式，options 为选项字典
- 判断题(true_false)的 answer 使用 {{"correct": "true"}} 或 {{"correct": "false"}}，options 设为 null
- 其他题型的 answer 使用 {{"text": "答案内容"}} 格式，options 设为 null

请现在开始生成题目。"""

"""错题本：错题读取（含来源回溯）与 AI 强化练习。

**来源回溯**：错题进度表 `student_question_progress` 每题只有一行，`last_exam_id`
记录「最近一次做错所在的考试/练习」。学生做的错题强化练习本身也是一场练习，
在里面做错的新题会把 `last_exam_id` 指向那场强化练习。为了让错题本保持
「一个来源考试/练习一个分组」的结构，这里统一把强化练习的 id 映射回它的来源
考试（`Exam.origin_exam_id`），所以强化练习不会在错题本里长出一个新分组。

**强化练习流程**：
1. 把来源考试/练习下的错题按最具体的知识点归组（没有标注知识点的落到「其他错题」）；
2. 学生给出总题数（默认 10），可选地逐知识点指定题数；
3. 按分组调用现有 AI 出题流水线，生成「同知识点、不同题目」的新题；
4. 落成一个 `hidden_from_list` 的练习：不出现在考试/练习列表，只在错题本里可见。
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import User
from app.exams.models import Exam, ExamQuestion, ExamStudent, ExamStatus, StudentQuestionProgress
from app.learning.models import KnowledgePoint
from app.questions.ai_generate import AIGenerateRequest, AIModelProvider, generate_questions_stream
from app.questions.models import Question, QuestionSource, QuestionType

logger = logging.getLogger(__name__)

# 没有标注知识点的错题统一落到这个分组。
REMEDIAL_OTHER_GROUP_KEY = "other"

REMEDIAL_DEFAULT_TOTAL = 10
REMEDIAL_MIN_TOTAL = 1
REMEDIAL_MAX_TOTAL = 50
# 单次生成最多覆盖多少个知识点分组，避免一次请求打太多轮模型调用。
REMEDIAL_MAX_GROUPS = 10
# 每个知识点的错题原文最多带多少道给模型做参考。
_REMEDIAL_MATERIAL_MAX_QUESTIONS = 12
_REMEDIAL_MATERIAL_MAX_CHARS = 60000

_SUPPORTED_GENERATED_TYPES = {item.value for item in QuestionType}


@dataclass
class StudentWrongAnswerRow:
    progress: StudentQuestionProgress
    question: Question
    # 回溯后的来源考试/练习 id（强化练习会映射回它的来源）；为空表示历史错题。
    effective_exam_id: uuid.UUID | None


@dataclass
class RemedialWrongQuestion:
    question_id: uuid.UUID
    title: str
    type: str
    content: dict[str, Any]
    options: dict[str, Any] | None
    answer: dict[str, Any]
    analysis: str | None
    difficulty: int


@dataclass
class RemedialGroup:
    """一个知识点（或「其他错题」）下的错题集合。"""

    key: str
    knowledge_point_id: uuid.UUID | None
    name: str
    path: str | None
    wrong_questions: list[RemedialWrongQuestion] = field(default_factory=list)

    @property
    def question_count(self) -> int:
        return len(self.wrong_questions)


@dataclass
class RemedialPracticeSummary:
    id: uuid.UUID
    title: str
    question_count: int
    duration_minutes: int
    created_at: datetime
    started_at: datetime | None
    submitted_at: datetime | None
    score: float | None
    total_score: float


@dataclass
class RemedialPracticeGenerationResult:
    exam_id: uuid.UUID
    title: str
    question_count: int
    requested_count: int
    duration_minutes: int
    total_score: float


# ── 错题读取与来源回溯 ──


def _question_type_value(question: Question) -> str:
    question_type = question.type
    return question_type.value if isinstance(question_type, QuestionType) else str(question_type)


async def load_hidden_practice_sources(
    db: AsyncSession,
    exam_ids: Iterable[uuid.UUID | None],
) -> dict[uuid.UUID, uuid.UUID | None]:
    """把错题强化练习的 id 映射到它的来源考试；普通考试/练习不出现在返回值里。"""
    unique_ids = [exam_id for exam_id in dict.fromkeys(exam_ids) if exam_id is not None]
    if not unique_ids:
        return {}
    rows = (
        await db.execute(
            select(Exam.id, Exam.origin_exam_id).where(
                Exam.id.in_(unique_ids),
                Exam.hidden_from_list.is_(True),
                Exam.deleted_at.is_(None),
            )
        )
    ).all()
    return {row[0]: row[1] for row in rows}


def resolve_effective_exam_id(
    last_exam_id: uuid.UUID | None,
    hidden_practice_sources: dict[uuid.UUID, uuid.UUID | None],
) -> uuid.UUID | None:
    if last_exam_id is None:
        return None
    if last_exam_id in hidden_practice_sources:
        return hidden_practice_sources[last_exam_id]
    return last_exam_id


async def load_student_wrong_answers(
    db: AsyncSession,
    *,
    student_id: uuid.UUID,
    mastered: bool,
) -> list[StudentWrongAnswerRow]:
    """读取某个学生的错题，并把来源考试回溯成错题本里的分组依据。"""
    query = (
        select(StudentQuestionProgress, Question)
        .join(Question, Question.id == StudentQuestionProgress.question_id)
        .where(
            StudentQuestionProgress.student_id == student_id,
            StudentQuestionProgress.wrong_count > 0,
            StudentQuestionProgress.mastered.is_(mastered),
            Question.deleted_at.is_(None),
        )
    )
    if mastered:
        query = query.order_by(StudentQuestionProgress.mastered_at.desc())
    else:
        query = query.order_by(StudentQuestionProgress.last_wrong_at.desc())

    rows = list((await db.execute(query)).all())
    hidden_sources = await load_hidden_practice_sources(
        db,
        (progress.last_exam_id for progress, _ in rows),
    )
    return [
        StudentWrongAnswerRow(
            progress=progress,
            question=question,
            effective_exam_id=resolve_effective_exam_id(progress.last_exam_id, hidden_sources),
        )
        for progress, question in rows
    ]


async def load_exams_by_ids(
    db: AsyncSession,
    exam_ids: Iterable[uuid.UUID | None],
) -> dict[uuid.UUID, Exam]:
    unique_ids = [exam_id for exam_id in dict.fromkeys(exam_ids) if exam_id is not None]
    if not unique_ids:
        return {}
    rows = (
        await db.execute(
            select(Exam).where(Exam.id.in_(unique_ids), Exam.deleted_at.is_(None))
        )
    ).scalars().unique().all()
    return {exam.id: exam for exam in rows}


async def load_exam_question_orders(
    db: AsyncSession,
    pairs: Iterable[tuple[uuid.UUID | None, uuid.UUID]],
) -> dict[tuple[uuid.UUID, uuid.UUID], int]:
    """按 (考试 id, 题目 id) 批量取该题在试卷里的位置。

    返回的是 `exam_questions.order` 原值（0 基），展示时统一 `+1`，与做题页/结果页的题号口径一致。
    找不到配对（历史错题、题目后来被移出试卷）时不出现在返回值里。
    """
    wanted = {(exam_id, question_id) for exam_id, question_id in pairs if exam_id is not None}
    if not wanted:
        return {}
    rows = (
        await db.execute(
            select(ExamQuestion.exam_id, ExamQuestion.question_id, ExamQuestion.order).where(
                ExamQuestion.exam_id.in_({exam_id for exam_id, _ in wanted}),
                ExamQuestion.question_id.in_({question_id for _, question_id in wanted}),
            )
        )
    ).all()
    return {
        (row[0], row[1]): int(row[2] or 0)
        for row in rows
        if (row[0], row[1]) in wanted
    }


# ── 知识点归组 ──


async def _load_knowledge_point_lineages(
    db: AsyncSession,
    knowledge_point_ids: set[uuid.UUID],
) -> dict[uuid.UUID, list[KnowledgePoint]]:
    """返回每个知识点自根到自身的完整链路，用于算深度和展示路径。"""
    if not knowledge_point_ids:
        return {}

    nodes: dict[uuid.UUID, KnowledgePoint] = {}
    pending = set(knowledge_point_ids)
    while pending:
        rows = (
            await db.execute(
                select(KnowledgePoint).where(
                    KnowledgePoint.id.in_(pending),
                    KnowledgePoint.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        pending = set()
        for node in rows:
            if node.id in nodes:
                continue
            nodes[node.id] = node
            if node.parent_id is not None and node.parent_id not in nodes:
                pending.add(node.parent_id)

    lineages: dict[uuid.UUID, list[KnowledgePoint]] = {}
    for node in nodes.values():
        lineage: list[KnowledgePoint] = [node]
        seen = {node.id}
        current = node
        while current.parent_id is not None and current.parent_id in nodes and current.parent_id not in seen:
            current = nodes[current.parent_id]
            seen.add(current.id)
            lineage.append(current)
        lineage.reverse()
        lineages[node.id] = lineage
    return lineages


async def collect_wrong_question_groups(
    db: AsyncSession,
    *,
    student_id: uuid.UUID,
    source_exam_id: uuid.UUID | None,
    mastered: bool = False,
) -> list[RemedialGroup]:
    """把来源考试/练习下的错题按最具体的知识点归组。"""
    rows = [
        row
        for row in await load_student_wrong_answers(db, student_id=student_id, mastered=mastered)
        if row.effective_exam_id == source_exam_id
    ]
    if not rows:
        return []

    all_kp_ids: set[uuid.UUID] = set()
    for row in rows:
        all_kp_ids.update(kp.id for kp in (row.question.knowledge_points or []))

    lineages = await _load_knowledge_point_lineages(db, all_kp_ids)
    groups: dict[str, RemedialGroup] = {}

    for row in rows:
        question = row.question
        knowledge_points = [kp for kp in (question.knowledge_points or []) if kp.id in lineages]
        if knowledge_points:
            # 取链路最深（最具体）的知识点，保证同一道错题只归到一组。
            primary = max(knowledge_points, key=lambda node: len(lineages[node.id]))
            lineage = lineages[primary.id]
            key = f"kp:{primary.id}"
            group = groups.get(key)
            if group is None:
                group = RemedialGroup(
                    key=key,
                    knowledge_point_id=primary.id,
                    name=primary.name,
                    path=" > ".join(node.name for node in lineage),
                )
                groups[key] = group
        else:
            group = groups.get(REMEDIAL_OTHER_GROUP_KEY)
            if group is None:
                group = RemedialGroup(
                    key=REMEDIAL_OTHER_GROUP_KEY,
                    knowledge_point_id=None,
                    name="其他错题",
                    path=None,
                )
                groups[REMEDIAL_OTHER_GROUP_KEY] = group

        group.wrong_questions.append(
            RemedialWrongQuestion(
                question_id=question.id,
                title=question.title,
                type=_question_type_value(question),
                content=question.content or {},
                options=question.options if isinstance(question.options, dict) else None,
                answer=question.answer or {},
                analysis=question.analysis,
                difficulty=int(question.difficulty or 3),
            )
        )

    return sorted(groups.values(), key=lambda item: (-item.question_count, item.name))


# ── 题数分配 ──


def allocate_by_weight(weights: dict[str, int], total: int) -> dict[str, int]:
    """按权重比例把总题数分配到各分组（最大余数法，保证合计等于 total）。"""
    if total <= 0:
        return {}
    positive = {key: weight for key, weight in weights.items() if weight > 0}
    if not positive:
        return {}

    weight_sum = sum(positive.values())
    raw = {key: total * weight / weight_sum for key, weight in positive.items()}
    allocation = {key: int(value) for key, value in raw.items()}
    remainder = total - sum(allocation.values())
    ranked = sorted(raw, key=lambda key: (-(raw[key] - allocation[key]), -positive[key], key))
    for key in ranked:
        if remainder <= 0:
            break
        allocation[key] += 1
        remainder -= 1
    return {key: value for key, value in allocation.items() if value > 0}


def default_allocations(groups: list[RemedialGroup], total_count: int) -> dict[str, int]:
    """默认按各组错题数占比分配；分组过多时只保留错题最多的前若干个。"""
    ranked = sorted(groups, key=lambda item: (-item.question_count, item.name))[:REMEDIAL_MAX_GROUPS]
    weights = {group.key: group.question_count for group in ranked}
    return allocate_by_weight(weights, total_count)


def _type_distribution_for_group(group: RemedialGroup, total: int) -> dict[str, int]:
    weights: dict[str, int] = {}
    for question in group.wrong_questions:
        if question.type not in _SUPPORTED_GENERATED_TYPES:
            continue
        weights[question.type] = weights.get(question.type, 0) + 1
    if not weights:
        # 错题题型不在支持范围内时退化为选择题。
        return {QuestionType.CHOICE.value: total}
    return allocate_by_weight(weights, total)


# ── AI 生成 ──


def _render_group_material(group: RemedialGroup) -> str:
    lines: list[str] = []
    for index, question in enumerate(group.wrong_questions[:_REMEDIAL_MATERIAL_MAX_QUESTIONS], start=1):
        payload = {
            "title": question.title,
            "type": question.type,
            "content": question.content,
            "options": question.options,
            "answer": question.answer,
            "analysis": question.analysis,
        }
        lines.append(f"原错题 {index}：{json.dumps(payload, ensure_ascii=False)}")
    text = "\n".join(lines)
    if len(text) > _REMEDIAL_MATERIAL_MAX_CHARS:
        text = text[:_REMEDIAL_MATERIAL_MAX_CHARS] + "\n...（错题原文过长，已截断）"
    return text


def _build_group_prompt(group: RemedialGroup, count: int) -> str:
    focus = f"知识点「{group.name}」" if group.knowledge_point_id else "这些错题共同考查的内容"
    return (
        f"以下是学生做错的题目，请针对{focus}再出 {count} 道新题。"
        "硬性要求：每道题必须考同一个知识点和同一种考查能力，但题干情境、数值、选项、问法都要与原错题不同，"
        "不得照抄原题，也不得只把原题换个数字。若原题选项有干扰项，新题也要保留同等区分度的干扰项。"
    )


async def _generate_group_questions(
    db: AsyncSession,
    *,
    student: User,
    source_exam: Exam | None,
    group: RemedialGroup,
    count: int,
    difficulty: int,
    model: AIModelProvider,
) -> list[dict[str, Any]]:
    if count <= 0:
        return []

    course_name = ""
    if source_exam is not None and source_exam.course_kp_id is not None:
        course_name = (
            await db.execute(
                select(KnowledgePoint.name).where(KnowledgePoint.id == source_exam.course_kp_id)
            )
        ).scalar_one_or_none() or ""

    request = AIGenerateRequest(
        total_count=count,
        difficulty=difficulty,
        type_distribution=_type_distribution_for_group(group, count),
        knowledge_point_ids=[group.knowledge_point_id] if group.knowledge_point_id else [],
        knowledge_keywords="",
        course_name=course_name,
        exam_title=source_exam.title if source_exam is not None else "",
        prompt=_build_group_prompt(group, count),
        material_text=_render_group_material(group),
        model=model,
    )

    collected: list[dict[str, Any]] = []
    error_message: str | None = None
    async for event in generate_questions_stream(db, request, student.id):
        event_type = str(event.get("type") or "")
        if event_type == "question":
            payload = event.get("data")
            if isinstance(payload, dict):
                collected.append(payload)
        elif event_type == "error":
            error_message = str(event.get("message") or "AI 生成失败")

    if not collected and error_message:
        raise ValueError(error_message)
    if len(collected) < count:
        logger.warning(
            "Remedial practice generated fewer questions than requested: group=%s expected=%s actual=%s",
            group.key,
            count,
            len(collected),
        )
    return collected


async def _persist_generated_question(
    db: AsyncSession,
    *,
    student: User,
    payload: dict[str, Any],
    knowledge_point_id: uuid.UUID | None,
    score: float,
) -> Question:
    raw_type = str(payload.get("type") or "").strip()
    if raw_type not in _SUPPORTED_GENERATED_TYPES:
        raw_type = QuestionType.CHOICE.value
    options = payload.get("options")
    answer = payload.get("answer")
    try:
        difficulty = int(payload.get("difficulty") or 3)
    except (TypeError, ValueError):
        difficulty = 3

    question = Question(
        type=QuestionType(raw_type),
        title=str(payload.get("title") or "错题强化练习题目")[:500],
        content=payload.get("content") if isinstance(payload.get("content"), dict) else {},
        options=options if isinstance(options, (dict, list)) else None,
        answer=answer if isinstance(answer, dict) else {"text": str(answer or "")},
        analysis=payload.get("analysis") if isinstance(payload.get("analysis"), str) else None,
        difficulty=max(1, min(5, difficulty)),
        score=score,
        source=QuestionSource.AI_GENERATED.value,
        created_by=student.id,
        owner_id=student.id,
    )
    if knowledge_point_id is not None:
        knowledge_point = (
            await db.execute(
                select(KnowledgePoint).where(
                    KnowledgePoint.id == knowledge_point_id,
                    KnowledgePoint.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if knowledge_point is not None:
            question.knowledge_points = [knowledge_point]
    db.add(question)
    await db.flush()
    return question


async def _unique_remedial_title(
    db: AsyncSession,
    *,
    student_id: uuid.UUID,
    base_title: str,
) -> str:
    existing = set(
        (
            await db.execute(
                select(Exam.title).where(
                    Exam.created_by == student_id,
                    Exam.hidden_from_list.is_(True),
                    Exam.deleted_at.is_(None),
                )
            )
        ).scalars().all()
    )
    if base_title not in existing:
        return base_title
    index = 2
    while f"{base_title}（{index}）" in existing:
        index += 1
    return f"{base_title}（{index}）"


async def create_remedial_practice(
    db: AsyncSession,
    *,
    student: User,
    source_exam: Exam | None,
    groups: list[RemedialGroup],
    allocations: dict[str, int],
    difficulty: int,
    model: AIModelProvider,
) -> RemedialPracticeGenerationResult:
    """按知识点分配生成题目，并落成一个隐藏练习。"""
    group_by_key = {group.key: group for group in groups}
    selected = [
        (group_by_key[key], count)
        for key, count in allocations.items()
        if key in group_by_key and count > 0
    ]
    if not selected:
        raise ValueError("请至少为一个知识点指定题目数")

    requested_count = sum(count for _, count in selected)
    score_per_question = 10.0
    exam_questions: list[Question] = []

    for group, count in selected:
        payloads = await _generate_group_questions(
            db,
            student=student,
            source_exam=source_exam,
            group=group,
            count=count,
            difficulty=difficulty,
            model=model,
        )
        for payload in payloads:
            question = await _persist_generated_question(
                db,
                student=student,
                payload=payload,
                knowledge_point_id=group.knowledge_point_id,
                score=score_per_question,
            )
            exam_questions.append(question)

    if not exam_questions:
        raise ValueError("AI 没有生成可用题目，请稍后重试")

    question_count = len(exam_questions)
    duration_minutes = max(10, question_count * 2)
    total_score = score_per_question * question_count
    source_title = source_exam.title if source_exam is not None else "历史考试"
    title = await _unique_remedial_title(
        db,
        student_id=student.id,
        base_title=f"{source_title} · 错题强化练习",
    )

    exam = Exam(
        category=(source_exam.category if source_exam is not None else "practice"),
        title=title,
        description=(
            f"根据「{source_title}」的错题生成的知识点强化练习，"
            f"覆盖 {len(selected)} 个知识点、共 {question_count} 道题。"
        ),
        start_time=None,
        end_time=None,
        duration_minutes=duration_minutes,
        total_score=total_score,
        status=ExamStatus.ONGOING.value,
        position_id=source_exam.position_id if source_exam is not None else None,
        max_switch_count=0,
        allow_retake=True,
        show_result=True,
        show_score=True,
        notes_template=None,
        question_mode="auto",
        course_kp_id=source_exam.course_kp_id if source_exam is not None else None,
        origin_exam_id=source_exam.id if source_exam is not None else None,
        hidden_from_list=True,
        created_by=student.id,
        owner_id=student.id,
    )
    db.add(exam)
    await db.flush()

    for index, question in enumerate(exam_questions):
        db.add(
            ExamQuestion(
                exam_id=exam.id,
                question_id=question.id,
                order=index,
                score_override=score_per_question,
            )
        )
    db.add(ExamStudent(exam_id=exam.id, student_id=student.id))
    await db.commit()
    await db.refresh(exam)

    return RemedialPracticeGenerationResult(
        exam_id=exam.id,
        title=exam.title,
        question_count=question_count,
        requested_count=requested_count,
        duration_minutes=duration_minutes,
        total_score=total_score,
    )


# ── 已生成的练习 ──


def _practice_source_filter(source_exam_id: uuid.UUID | None):
    if source_exam_id is None:
        return Exam.origin_exam_id.is_(None)
    return Exam.origin_exam_id == source_exam_id


async def list_remedial_practices(
    db: AsyncSession,
    *,
    student_id: uuid.UUID,
    source_exam_id: uuid.UUID | None,
) -> list[RemedialPracticeSummary]:
    rows = (
        await db.execute(
            select(Exam)
            .where(
                Exam.created_by == student_id,
                Exam.hidden_from_list.is_(True),
                Exam.deleted_at.is_(None),
                _practice_source_filter(source_exam_id),
            )
            .options(
                selectinload(Exam.exam_questions),
                selectinload(Exam.exam_students),
            )
            .order_by(Exam.created_at.desc())
        )
    ).scalars().unique().all()

    summaries: list[RemedialPracticeSummary] = []
    for exam in rows:
        exam_student = next(
            (item for item in exam.exam_students if item.student_id == student_id),
            None,
        )
        summaries.append(
            RemedialPracticeSummary(
                id=exam.id,
                title=exam.title,
                question_count=len(exam.exam_questions),
                duration_minutes=exam.duration_minutes,
                created_at=exam.created_at,
                started_at=exam_student.started_at if exam_student else None,
                submitted_at=exam_student.submitted_at if exam_student else None,
                score=exam_student.score if exam_student else None,
                total_score=exam.total_score,
            )
        )
    return summaries


async def count_remedial_practices_by_source(
    db: AsyncSession,
    *,
    student_id: uuid.UUID,
) -> dict[str, int]:
    """按来源考试 id 统计已生成的强化练习数量（历史错题兜底分组用空串键）。"""
    rows = (
        await db.execute(
            select(Exam.origin_exam_id).where(
                Exam.created_by == student_id,
                Exam.hidden_from_list.is_(True),
                Exam.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    counts: dict[str, int] = {}
    for origin_exam_id in rows:
        key = str(origin_exam_id) if origin_exam_id is not None else ""
        counts[key] = counts.get(key, 0) + 1
    return counts

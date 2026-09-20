"""CRUD service functions for Question, Tag, and KnowledgePoint."""

import asyncio
import base64
import hashlib
import json
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Any
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.auth.models import User
from app.common.data_visibility import VisibilityScope
from app.common.resource_access import teacher_owned_resource_filter, teacher_visible_resource_filter
from app.database import async_session
from app.config import settings
from app.exams.models import Exam, ExamQuestion, ExamStudent, StudentExamAnswer, StudentExamSubmission, StudentExamSubmissionAnswer, StudentQuestionProgress
from app.papers.models import Paper, PaperQuestion
from app.questions.models import KnowledgePoint, Question, QuestionBank, QuestionImportJob, QuestionImportJobStatus, QuestionSource, QuestionType, Tag, question_tags
from app.questions.schemas import (
    EnhanceDraftInput,
    EnhancedDraft,
    ImportConfidence,
    ImportRecognitionMode,
    KnowledgePointSuggestion,
    QuestionImportAnalysisMode,
    ImportReviewStatus,
    ImportedQuestionDraft,
    KnowledgePointCreate,
    QuestionBankCreate,
    QuestionImportDocumentRecognizeRequest,
    QuestionImportDocumentRecognizeResponse,
    QuestionImportDocumentSummary,
    QuestionImportDraft,
    QuestionImportImageInput,
    QuestionImportTableInput,
    QuestionImportRecognizeResponse,
    QuestionCreate,
    QuestionEditLockInfo,
    QuestionImportAnalyzeResponse,
    QuestionUpdate,
    TagCreate,
    TagUpdate,
)


@dataclass
class BulkCreateQuestionsResult:
    created_question_ids: list[uuid.UUID]
    created_questions: list[QuestionCreate]
    existing: int = 0
    existing_question_ids: list[uuid.UUID] = None  # type: ignore[assignment]
    failed: int = 0

    def __post_init__(self) -> None:
        if self.existing_question_ids is None:
            self.existing_question_ids = []

    @property
    def created(self) -> int:
        return len(self.created_question_ids)


@dataclass(frozen=True)
class AffectedSubmittedAttempt:
    exam_id: uuid.UUID
    student_id: uuid.UUID
    question_id: uuid.UUID
    submission_id: uuid.UUID


IN_USE_QUESTION_EDIT_ERROR = "这道题已有学生提交过答卷，不能修改题干、选项、题型或分值。"
IN_USE_ALLOWED_FIELDS = ["answer", "analysis", "difficulty", "knowledge_point_ids", "code_test_cases"]
IN_USE_REGRADE_FIELDS = ["answer", "code_test_cases"]
ALLOWED_CODE_CONTENT_KEYS = {"sample_tests", "test_cases", "judge_cases"}
IN_USE_MUTABLE_FIELDS = {"answer", "analysis", "difficulty", "knowledge_point_ids", "code_test_cases"}


@dataclass
class QuestionUpdateDiff:
    changed_fields: set[str]
    forbidden_fields: set[str]
    allowed_content_change_keys: set[str]
    regrade_fields: set[str]


def _normalize_uuid_list(values: list[Any]) -> list[str]:
    return sorted({str(value) for value in values})


def _question_knowledge_point_ids(question: Question) -> list[str]:
    knowledge_points = getattr(question, "knowledge_points", []) or []
    return _normalize_uuid_list([knowledge_point.id for knowledge_point in knowledge_points])


def _question_tag_ids(question: Question) -> list[str]:
    tags = getattr(question, "tags", []) or []
    return _normalize_uuid_list([tag.id for tag in tags])


# --- Tag ---

async def list_tags(db: AsyncSession, question_bank_id: str | None = None) -> list[dict]:
    """Return tags with question_count, optionally scoped to a question bank."""
    count_base = (
        select(question_tags.c.tag_id, func.count().label("cnt"))
        .join(Question, Question.id == question_tags.c.question_id)
        .where(Question.deleted_at.is_(None))
    )
    if question_bank_id == "__none__":
        count_base = count_base.where(Question.question_bank_id.is_(None))
    elif question_bank_id:
        count_base = count_base.where(Question.question_bank_id == question_bank_id)

    count_subq = count_base.group_by(question_tags.c.tag_id).subquery()

    stmt = (
        select(Tag, func.coalesce(count_subq.c.cnt, 0).label("question_count"))
        .outerjoin(count_subq, Tag.id == count_subq.c.tag_id)
        .where(Tag.deleted_at.is_(None))
        .order_by(Tag.name)
    )
    result = await db.execute(stmt)
    rows = result.all()
    return [{"tag": row[0], "question_count": row[1]} for row in rows]


async def create_tag(db: AsyncSession, data: TagCreate) -> Tag:
    tag = Tag(name=data.name, type=data.type)
    db.add(tag)
    await db.flush()
    await db.refresh(tag)
    return tag


async def get_tag_by_id(db: AsyncSession, tag_id: uuid.UUID) -> Tag | None:
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def update_tag(db: AsyncSession, tag_id: uuid.UUID, data: TagUpdate) -> Tag | None:
    tag = await get_tag_by_id(db, tag_id)
    if tag is None:
        return None
    tag.name = data.name
    await db.flush()
    await db.refresh(tag)
    return tag


async def delete_tag(db: AsyncSession, tag_id: uuid.UUID) -> bool:
    tag = await get_tag_by_id(db, tag_id)
    if tag is None:
        return False
    tag.deleted_at = datetime.now(timezone.utc)
    await db.flush()
    return True


# --- KnowledgePoint ---

async def list_knowledge_points(
    db: AsyncSession,
    *,
    user: User,
    is_platform_admin: bool,
) -> list[KnowledgePoint]:
    stmt = select(KnowledgePoint).where(KnowledgePoint.deleted_at.is_(None))
    if not is_platform_admin:
        stmt = stmt.where(teacher_visible_resource_filter(KnowledgePoint, user.id))
    result = await db.execute(stmt.order_by(KnowledgePoint.name))
    return list(result.scalars().all())


async def create_knowledge_point(db: AsyncSession, data: KnowledgePointCreate, user_id: uuid.UUID) -> KnowledgePoint:
    kp = KnowledgePoint(
        name=data.name,
        parent_id=data.parent_id,
        description=data.description,
        owner_id=user_id,
        visibility=VisibilityScope.PRIVATE,
    )
    db.add(kp)
    await db.flush()
    await db.refresh(kp)
    return kp


# --- QuestionBank ---

async def list_question_banks(
    db: AsyncSession,
    *,
    user: User,
    is_platform_admin: bool,
) -> tuple[list[dict], int]:
    """Return question banks with question_count, plus no-bank count."""
    count_subq = (
        select(Question.question_bank_id, func.count().label("cnt"))
        .where(Question.deleted_at.is_(None))
        .where(Question.question_bank_id.is_not(None))
        .group_by(Question.question_bank_id)
        .subquery()
    )
    stmt = (
        select(
            QuestionBank,
            func.coalesce(count_subq.c.cnt, 0).label("question_count"),
            User.username.label("owner_username"),
            User.full_name.label("owner_full_name"),
        )
        .outerjoin(count_subq, QuestionBank.id == count_subq.c.question_bank_id)
        .join(User, User.id == QuestionBank.owner_id)
        .where(QuestionBank.deleted_at.is_(None))
    )
    if not is_platform_admin:
        stmt = stmt.where(teacher_visible_resource_filter(QuestionBank, user.id))
    stmt = stmt.order_by(QuestionBank.name)
    result = await db.execute(stmt)
    rows = result.all()

    no_bank_stmt = select(func.count()).select_from(Question).where(
        Question.deleted_at.is_(None), Question.question_bank_id.is_(None)
    )
    if not is_platform_admin:
        no_bank_stmt = no_bank_stmt.where(teacher_owned_resource_filter(Question, user.id))
    no_bank_result = await db.execute(no_bank_stmt)
    no_bank_count = no_bank_result.scalar_one()

    return [
        {
            "bank": row[0],
            "question_count": row[1],
            "owner_username": row[2],
            "owner_full_name": row[3],
        }
        for row in rows
    ], no_bank_count


async def create_question_bank(db: AsyncSession, data: QuestionBankCreate, user_id: uuid.UUID) -> QuestionBank:
    qb = QuestionBank(
        name=data.name,
        description=data.description,
        owner_id=user_id,
        visibility=VisibilityScope.PRIVATE,
    )
    db.add(qb)
    await db.flush()
    await db.refresh(qb)
    return qb


async def get_question_bank_by_id(db: AsyncSession, bank_id: uuid.UUID) -> QuestionBank | None:
    result = await db.execute(
        select(QuestionBank).where(QuestionBank.id == bank_id, QuestionBank.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def soft_delete_question_bank(db: AsyncSession, bank: QuestionBank) -> None:
    """Soft-delete the bank and unlink its questions (set question_bank_id to NULL)."""
    now = datetime.now(timezone.utc)
    bank.deleted_at = now
    # Unlink questions from deleted bank
    from sqlalchemy import update as sql_update
    await db.execute(
        sql_update(Question)
        .where(Question.question_bank_id == bank.id, Question.deleted_at.is_(None))
        .values(question_bank_id=None)
    )
    await db.flush()


async def clear_question_bank_questions(db: AsyncSession, bank: QuestionBank) -> dict[str, int]:
    """Delete all active questions in the bank while keeping the bank itself.

    Questions that have never been used are removed physically. Questions with
    exam/practice history are soft-deleted so historical records remain valid.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Question).where(Question.question_bank_id == bank.id, Question.deleted_at.is_(None))
    )
    questions = list(result.scalars().all())
    hard_deleted = 0
    soft_deleted = 0

    for question in questions:
        if await can_hard_delete_question(db, question.id):
            await db.delete(question)
            hard_deleted += 1
        else:
            question.deleted_at = now
            soft_deleted += 1

    await db.flush()
    return {"deleted": hard_deleted + soft_deleted, "hard_deleted": hard_deleted, "soft_deleted": soft_deleted}


# --- Question ---

def _question_scope_query(*, user: User | None, is_platform_admin: bool) -> Select:
    query = select(Question).where(Question.deleted_at.is_(None))
    if user is not None and not is_platform_admin:
        query = query.outerjoin(QuestionBank, Question.question_bank_id == QuestionBank.id).where(
            or_(
                teacher_owned_resource_filter(Question, user.id),
                and_(
                    Question.question_bank_id.is_not(None),
                    QuestionBank.visibility == VisibilityScope.PLATFORM,
                ),
            )
        )
    return query


def _question_base_query(*, user: User | None, is_platform_admin: bool) -> Select:
    return (
        _question_scope_query(user=user, is_platform_admin=is_platform_admin)
        .options(
            joinedload(Question.creator),
            joinedload(Question.question_bank),
            selectinload(Question.tags),
            selectinload(Question.knowledge_points),
        )
    )


async def count_questions_by_type(
    db: AsyncSession,
    *,
    user: User,
    is_platform_admin: bool,
    question_bank_id: uuid.UUID | None = None,
    no_bank: bool = False,
    difficulties: list[int] | None = None,
) -> dict[str, int]:
    """按题型聚合可用题量，复用题目可见范围（自己的题目 + 平台开放题库）。

    用一条 GROUP BY 聚合查询替代"拉全部题目再在前端计数"，避免逐条序列化的开销，
    让自动出题界面的题型总数随难度切换快速刷新。
    """
    query = _question_scope_query(user=user, is_platform_admin=is_platform_admin)
    if no_bank:
        query = query.where(Question.question_bank_id.is_(None))
    elif question_bank_id is not None:
        query = query.where(Question.question_bank_id == question_bank_id)
    if difficulties:
        query = query.where(Question.difficulty.in_(difficulties))

    stmt = query.with_only_columns(Question.type, Question.content, Question.answer).order_by(None)
    rows = (await db.execute(stmt)).all()
    counts: dict[str, int] = {}
    for question_type, content, answer in rows:
        qtype = question_type.value if isinstance(question_type, QuestionType) else str(question_type)
        if qtype == QuestionType.CHOICE.value:
            key = "multi_choice" if (
                (isinstance(content, dict) and content.get("multi") is True)
                or _choice_answer_is_multi(answer)
            ) else "single_choice"
        else:
            key = qtype
        counts[key] = counts.get(key, 0) + 1
    return counts


async def get_question_by_id(
    db: AsyncSession,
    question_id: uuid.UUID,
    *,
    user: User | None,
    is_platform_admin: bool,
) -> Question | None:
    result = await db.execute(
        _question_base_query(user=user, is_platform_admin=is_platform_admin).where(Question.id == question_id)
    )
    return result.unique().scalar_one_or_none()


def _question_source_value(source: object) -> str:
    """Normalize a QuestionSource enum or string into the stored string value."""
    if isinstance(source, QuestionSource):
        return source.value
    if isinstance(source, str) and source:
        return source
    return QuestionSource.MANUAL.value


def _choice_answer_is_multi(answer: Any) -> bool:
    return isinstance(answer, dict) and isinstance(answer.get("correct"), list)


def _normalize_choice_content(
    question_type: QuestionType | str | None,
    content: Any,
    answer: Any,
) -> Any:
    qtype = question_type.value if isinstance(question_type, QuestionType) else str(question_type or "")
    if qtype != QuestionType.CHOICE.value or not isinstance(content, dict):
        return content
    return {**content, "multi": _choice_answer_is_multi(answer)}


async def create_question(db: AsyncSession, data: QuestionCreate, user_id: uuid.UUID) -> Question:
    question = Question(
        type=data.type,
        title=data.title,
        content=_normalize_choice_content(data.type, data.content, data.answer),
        options=data.options,
        answer=data.answer,
        analysis=data.analysis,
        difficulty=data.difficulty,
        score=data.score,
        source=_question_source_value(data.source),
        created_by=user_id,
        owner_id=user_id,
        question_bank_id=data.question_bank_id,
    )

    if data.tag_ids:
        tags_result = await db.execute(select(Tag).where(Tag.id.in_(data.tag_ids)))
        question.tags = list(tags_result.scalars().all())

    if data.knowledge_point_ids:
        kps_result = await db.execute(select(KnowledgePoint).where(KnowledgePoint.id.in_(data.knowledge_point_ids)))
        question.knowledge_points = list(kps_result.scalars().all())

    db.add(question)
    await db.flush()
    await db.refresh(question)

    created = await db.execute(
        _question_base_query(
            user=None,
            is_platform_admin=True,
        ).where(Question.id == question.id)
    )
    return created.unique().scalar_one()  # type: ignore[return-value]


_IN_USE_FORBIDDEN_TOP_LEVEL_FIELDS = {"type", "content", "options", "score"}
_IN_USE_REGRADING_TOP_LEVEL_FIELDS = {"answer"}
_IN_USE_ALLOWED_TOP_LEVEL_FIELDS = {
    "answer", "analysis", "difficulty", "knowledge_point_ids",
    "code_test_cases", "title", "tag_ids", "question_bank_id",
}
_IN_USE_ALLOWED_CODE_CONTENT_KEYS = {"sample_tests", "test_cases", "judge_cases"}


def _normalize_content_text(content: Any) -> str:
    """Extract plain text from content dict for semantic comparison.

    Compares the text representation rather than exact dict equality,
    so that roundtrips through the rich-text editor (which may add/remove
    html keys or normalize tag structure) don't appear as content changes.
    """
    if not isinstance(content, dict):
        return str(content or "").strip()
    return (content.get("text") or content.get("html") or "").strip()


def _content_text_changed(old_content: Any, new_content: Any) -> bool:
    """True when the semantic text of the content has actually changed."""
    return _normalize_content_text(old_content) != _normalize_content_text(new_content)


def _normalize_question_type(question_type: QuestionType | str | None) -> str:
    if isinstance(question_type, QuestionType):
        return question_type.value
    return str(question_type or "")


def _extract_question_attr(question: Question | Any, field: str) -> Any:
    if field == "knowledge_point_ids":
        return _question_knowledge_point_ids(question)
    if field == "tag_ids":
        return _question_tag_ids(question)
    return getattr(question, field)


def _extract_editable_code_content(content: Any) -> dict[str, Any]:
    if not isinstance(content, dict):
        return {}
    return {key: content.get(key) for key in _IN_USE_ALLOWED_CODE_CONTENT_KEYS if key in content}


def _extract_locked_code_content(content: Any) -> dict[str, Any]:
    if not isinstance(content, dict):
        return {}
    return {key: value for key, value in content.items() if key not in _IN_USE_ALLOWED_CODE_CONTENT_KEYS}


async def question_is_in_use(db: AsyncSession, question_id: uuid.UUID) -> bool:
    """Return True only after the question has submitted answers to preserve."""
    return await question_has_submitted_attempts(db, question_id)


async def question_has_submitted_attempts(db: AsyncSession, question_id: uuid.UUID) -> bool:
    submitted = await db.scalar(
        select(StudentExamAnswer.question_id)
        .join(Exam, Exam.id == StudentExamAnswer.exam_id)
        .join(
            ExamStudent,
            and_(
                ExamStudent.exam_id == StudentExamAnswer.exam_id,
                ExamStudent.student_id == StudentExamAnswer.student_id,
            ),
        )
        .where(
            StudentExamAnswer.question_id == question_id,
            Exam.deleted_at.is_(None),
            ExamStudent.submitted_at.is_not(None),
        )
        .limit(1)
    )
    return submitted is not None


async def list_submitted_attempts_for_question_regrade(
    db: AsyncSession,
    question_id: uuid.UUID,
) -> list[AffectedSubmittedAttempt]:
    rows = (
        await db.execute(
            select(
                StudentExamSubmissionAnswer.exam_id,
                StudentExamSubmissionAnswer.student_id,
                StudentExamSubmissionAnswer.question_id,
                StudentExamSubmissionAnswer.submission_id,
            )
            .join(Exam, Exam.id == StudentExamSubmissionAnswer.exam_id)
            .where(
                StudentExamSubmissionAnswer.question_id == question_id,
                Exam.deleted_at.is_(None),
            )
            .order_by(StudentExamSubmissionAnswer.exam_id, StudentExamSubmissionAnswer.student_id)
        )
    ).all()
    return [
        AffectedSubmittedAttempt(
            exam_id=exam_id,
            student_id=student_id,
            question_id=attempt_question_id,
            submission_id=submission_id,
        )
        for exam_id, student_id, attempt_question_id, submission_id in rows
    ]


def diff_question_update(question: Question | Any, incoming: dict[str, Any]) -> QuestionUpdateDiff:
    update = incoming if isinstance(incoming, QuestionUpdate) else QuestionUpdate.model_validate(incoming)
    changed_fields: set[str] = set()
    forbidden_fields: set[str] = set()
    allowed_content_change_keys: set[str] = set()
    regrade_fields: set[str] = set()
    question_type = _normalize_question_type(getattr(question, "type", None))

    for field, new_value in update.model_dump(exclude_unset=True).items():
        if field == "knowledge_point_ids":
            old_value = _extract_question_attr(question, field)
            normalized_new = _normalize_uuid_list(new_value or [])
            if old_value != normalized_new:
                changed_fields.add(field)
            continue

        if field == "tag_ids":
            old_value = _extract_question_attr(question, field)
            normalized_new = _normalize_uuid_list(new_value or [])
            if old_value != normalized_new:
                changed_fields.add(field)
            continue

        if field == "content":
            old_content = getattr(question, "content", None)
            if old_content == new_value:
                continue
            if question_type != QuestionType.CODE.value:
                # Compare semantic text, not exact dict — the rich-text editor
                # may add/remove html keys or normalize tags on roundtrip.
                if not _content_text_changed(old_content, new_value):
                    continue
                forbidden_fields.add("content")
                changed_fields.add(field)
                continue
            changed_fields.add(field)

            old_locked = _extract_locked_code_content(old_content)
            new_locked = _extract_locked_code_content(new_value)
            if old_locked != new_locked:
                forbidden_fields.add("content")
                continue

            old_editable = _extract_editable_code_content(old_content)
            new_editable = _extract_editable_code_content(new_value)
            for key in _IN_USE_ALLOWED_CODE_CONTENT_KEYS:
                if old_editable.get(key) != new_editable.get(key):
                    allowed_content_change_keys.add(key)
            if allowed_content_change_keys:
                changed_fields.add("code_test_cases")
                regrade_fields.add("code_test_cases")
            continue

        old_value = getattr(question, field, None)
        if old_value != new_value:
            changed_fields.add(field)
            if field in _IN_USE_REGRADING_TOP_LEVEL_FIELDS:
                regrade_fields.add(field)
            if field in _IN_USE_FORBIDDEN_TOP_LEVEL_FIELDS:
                forbidden_fields.add(field)

    return QuestionUpdateDiff(
        changed_fields=changed_fields,
        forbidden_fields=forbidden_fields,
        allowed_content_change_keys=allowed_content_change_keys,
        regrade_fields=regrade_fields,
    )


def validate_in_use_question_update(question: Question | Any, diff: QuestionUpdateDiff) -> None:
    del question
    if diff.forbidden_fields:
        raise ValueError(IN_USE_QUESTION_EDIT_ERROR)

    disallowed_fields = diff.changed_fields - _IN_USE_ALLOWED_TOP_LEVEL_FIELDS - {"content"}
    if disallowed_fields:
        raise ValueError(IN_USE_QUESTION_EDIT_ERROR)

    if "content" in diff.changed_fields and not diff.allowed_content_change_keys:
        raise ValueError(IN_USE_QUESTION_EDIT_ERROR)


def question_update_requires_regrade(question: Question | Any, diff: QuestionUpdateDiff) -> bool:
    del question
    return bool(diff.regrade_fields)


async def build_question_edit_lock_info(db: AsyncSession, question_id: uuid.UUID) -> QuestionEditLockInfo:
    in_use = await question_is_in_use(db, question_id)
    has_submitted_attempts = await question_has_submitted_attempts(db, question_id)
    return QuestionEditLockInfo(
        in_use=in_use,
        allowed_fields=IN_USE_ALLOWED_FIELDS if in_use else [],
        regrade_on_fields=IN_USE_REGRADE_FIELDS if in_use else [],
        has_submitted_attempts=has_submitted_attempts,
    )


async def update_question(db: AsyncSession, question: Question, data: QuestionUpdate) -> Question:
    update_data = data.model_dump(exclude_unset=True, exclude={"tag_ids", "knowledge_point_ids"})
    for field, value in update_data.items():
        setattr(question, field, value)

    question.content = _normalize_choice_content(question.type, question.content, question.answer)

    if data.tag_ids is not None:
        tags_result = await db.execute(select(Tag).where(Tag.id.in_(data.tag_ids)))
        question.tags = list(tags_result.scalars().all())

    if data.knowledge_point_ids is not None:
        kps_result = await db.execute(select(KnowledgePoint).where(KnowledgePoint.id.in_(data.knowledge_point_ids)))
        question.knowledge_points = list(kps_result.scalars().all())

    await db.flush()
    refreshed = await db.execute(
        _question_base_query(
            user=None,
            is_platform_admin=True,
        ).where(Question.id == question.id)
    )
    return refreshed.unique().scalar_one()  # type: ignore[return-value]


async def regrade_submitted_attempts_for_question_update(
    question_id: uuid.UUID,
    regrade_fields: set[str] | list[str],
) -> None:
    from app.exams.student_router import (
        _build_grading_task_payload,
        _get_active_role_binding_version,
        _grade_question_with_ai,
        _is_subjective_question_type,
        _run_subjective_grading_tasks,
    )
    from app.exams.models import GradingStatus
    from app.grading.service import (
        _recompute_historical_submission_scores,
        _recompute_submission_scores,
        create_grading_task,
        refresh_student_question_progress_for_regrade,
    )

    normalized_fields = set(regrade_fields)
    if not normalized_fields:
        return

    async with async_session() as db:
        question = await db.get(Question, question_id)
        if question is None:
            return

        attempts = await list_submitted_attempts_for_question_regrade(db, question_id)
        if not attempts:
            return

        task_ids: list[str] = []
        role_binding_version: int | None = None
        progress_refresh_keys: set[tuple[uuid.UUID, uuid.UUID]] = set()

        for attempt in attempts:
            exam = await db.get(Exam, attempt.exam_id)
            if exam is None or exam.deleted_at is not None:
                continue

            exam_question = (
                await db.execute(
                    select(ExamQuestion).where(
                        ExamQuestion.exam_id == attempt.exam_id,
                        ExamQuestion.question_id == question_id,
                    )
                )
            ).scalar_one_or_none()
            if exam_question is None:
                continue

            exam_student = (
                await db.execute(
                    select(ExamStudent).where(
                        ExamStudent.exam_id == attempt.exam_id,
                        ExamStudent.student_id == attempt.student_id,
                    )
                )
            ).scalar_one_or_none()
            if exam_student is None:
                continue

            submission = await db.get(StudentExamSubmission, attempt.submission_id)
            if submission is None:
                continue

            submission_answer = (
                await db.execute(
                    select(StudentExamSubmissionAnswer).where(
                        StudentExamSubmissionAnswer.submission_id == attempt.submission_id,
                        StudentExamSubmissionAnswer.question_id == question_id,
                    )
                )
            ).scalar_one_or_none()
            if submission_answer is None:
                continue

            live_answer = (
                await db.execute(
                    select(StudentExamAnswer).where(
                        StudentExamAnswer.exam_id == attempt.exam_id,
                        StudentExamAnswer.student_id == attempt.student_id,
                        StudentExamAnswer.question_id == question_id,
                    )
                )
            ).scalar_one_or_none()

            question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
            question_score = exam_question.score_override if exam_question.score_override is not None else question.score

            if _is_subjective_question_type(question_type):
                if role_binding_version is None:
                    role_binding_version = await _get_active_role_binding_version(db)
                task = await create_grading_task(
                    db,
                    _build_grading_task_payload(
                        exam=exam,
                        question=question,
                        question_score=question_score,
                        answer_content=dict(submission_answer.answer_content or {}),
                        role_binding_version=role_binding_version,
                        source_business_id=f"{attempt.exam_id}:{question_id}:{attempt.student_id}:{attempt.submission_id}",
                    ),
                )
                task_ids.append(str(task.id))
                submission.grading_status = GradingStatus.PENDING_AI.value
                if exam_student.latest_submission_id == attempt.submission_id:
                    exam_student.grading_status = GradingStatus.PENDING_AI.value
                    exam_student.ai_scored_at = None
                    exam_student.reviewed_at = None
                    exam_student.graded_at = None
                continue

            score_awarded, is_correct, feedback = await _grade_question_with_ai(
                question,
                dict(submission_answer.answer_content or {}),
                float(question_score),
            )
            submission_answer.score_awarded = score_awarded
            submission_answer.is_correct = is_correct
            submission_answer.feedback = feedback

            submission_objective_score, submission_subjective_score = await _recompute_historical_submission_scores(
                db,
                submission_id=attempt.submission_id,
            )
            submission.objective_score = submission_objective_score
            submission.subjective_score = submission_subjective_score
            submission.score = round(submission_objective_score + submission_subjective_score, 2)

            if exam_student.latest_submission_id == attempt.submission_id and live_answer is not None:
                live_answer.score_awarded = score_awarded
                live_answer.is_correct = is_correct
                live_answer.feedback = feedback
                objective_score, subjective_score = await _recompute_submission_scores(
                    db,
                    exam_id=attempt.exam_id,
                    student_id=attempt.student_id,
                )
                exam_student.objective_score = objective_score
                exam_student.subjective_score = subjective_score
                exam_student.score = round(objective_score + subjective_score, 2)
                progress_refresh_keys.add((attempt.student_id, question_id))

        for student_id, refresh_question_id in progress_refresh_keys:
            await refresh_student_question_progress_for_regrade(
                db,
                student_id=student_id,
                question_id=refresh_question_id,
            )

        await db.commit()

        if task_ids:
            await _run_subjective_grading_tasks(task_ids)


async def soft_delete_question(db: AsyncSession, question: Question) -> None:
    question.deleted_at = datetime.now(timezone.utc)
    await db.flush()


async def can_hard_delete_question(db: AsyncSession, question_id: uuid.UUID) -> bool:
    active_exam_ref = await db.scalar(
        select(ExamQuestion.question_id)
        .join(Exam, Exam.id == ExamQuestion.exam_id)
        .where(
            ExamQuestion.question_id == question_id,
            Exam.deleted_at.is_(None),
        )
        .limit(1)
    )
    if active_exam_ref is not None:
        return False

    answer_history = await db.scalar(
        select(StudentExamAnswer.question_id).where(StudentExamAnswer.question_id == question_id).limit(1)
    )
    if answer_history is not None:
        return False

    submission_answer_history = await db.scalar(
        select(StudentExamSubmissionAnswer.question_id)
        .where(StudentExamSubmissionAnswer.question_id == question_id)
        .limit(1)
    )
    if submission_answer_history is not None:
        return False

    progress_history = await db.scalar(
        select(StudentQuestionProgress.question_id)
        .where(StudentQuestionProgress.question_id == question_id)
        .limit(1)
    )
    if progress_history is not None:
        return False

    paper_ref = await db.scalar(
        select(PaperQuestion.question_id)
        .join(Paper, Paper.id == PaperQuestion.paper_id)
        .where(
            PaperQuestion.question_id == question_id,
            Paper.deleted_at.is_(None),
        )
        .limit(1)
    )
    if paper_ref is not None:
        return False

    return True


async def cleanup_soft_deleted_question_if_orphaned(db: AsyncSession, question_id: uuid.UUID) -> bool:
    question = await db.get(Question, question_id)
    if question is None or question.deleted_at is None:
        return False

    if not await can_hard_delete_question(db, question_id):
        return False

    await db.delete(question)
    await db.flush()
    return True


_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=120.0,
            limits=httpx.Limits(max_connections=200, max_keepalive_connections=100),
        )
    return _http_client


async def _request_deepseek_json(prompt: str) -> dict:
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DeepSeek API Key")

    client = _get_http_client()
    response = await client.post(
            f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
            json={
                "model": settings.deepseek_model_name,
                "messages": [
                    {"role": "system", "content": "你只输出合法 JSON。"},
                    {"role": "user", "content": prompt.strip()},
                ],
                "temperature": 0.2,
                "max_tokens": 12000,
            },
        )

    if response.status_code >= 400:
        raise RuntimeError(response.text.strip() or "DeepSeek 分析失败")

    content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("DeepSeek 没有返回分析结果")

    payload = content.strip()
    if "```" in payload:
        start = payload.find("```")
        end = payload.rfind("```")
        if start != -1 and end != -1 and end > start:
            payload = payload[start + 3 : end].strip()
            if payload.startswith("json"):
                payload = payload[4:].strip()

    return json.loads(payload)


def _is_ai_service_unavailable_error(exc: Exception) -> bool:
    return isinstance(exc, (httpx.HTTPError, RuntimeError)) and (
        isinstance(exc, httpx.HTTPError)
        or "DeepSeek API Key" in str(exc)
        or "DeepSeek 分析失败" in str(exc)
        or "DeepSeek 没有返回分析结果" in str(exc)
        # Chunked recognition (试卷导入) aggregates provider failures / missing keys
        # into these messages; they are service outages, not "document has no
        # questions", so paper import should still fall back to rule drafts.
        or "未配置任何 AI 识别服务的 API Key" in str(exc)
        or "AI 题目识别失败" in str(exc)
    )


def _ensure_image_data_url(image: str) -> str:
    """Turn an image reference into a data URL the vision API accepts.

    Accepts a data URL as-is, raw base64, or a server-side upload URL
    (``/api/uploads/files/<name>``) which is read back from disk and inlined so
    server-generated images (e.g. rendered PDF pages) can be sent to the model.
    """
    value = image.strip()
    if value.lower().startswith("data:"):
        return value
    if value.startswith(_UPLOAD_URL_PREFIX):
        filename = Path(value[len(_UPLOAD_URL_PREFIX) :].split("?", 1)[0]).name
        path = _IMG_UPLOAD_DIR / filename
        if filename and path.is_file():
            mime = mimetypes.guess_type(filename)[0] or "image/jpeg"
            return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"
    return f"data:image/jpeg;base64,{value}"


async def _request_vision_json(
    *,
    provider_name: str,
    api_key: str | None,
    base_url: str,
    model_name: str,
    prompt: str,
    images: list[QuestionImportImageInput],
) -> dict:
    if not api_key:
        raise RuntimeError(f"未配置 {provider_name} API Key")

    content: list[dict[str, Any]] = [{"type": "text", "text": prompt.strip()}]
    for image in images:
        content.append({"type": "image_url", "image_url": {"url": _ensure_image_data_url(image.url)}})

    client = _get_http_client()
    response = await client.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model_name,
            "messages": [
                {"role": "system", "content": "你只输出合法 JSON。"},
                {"role": "user", "content": content},
            ],
            "temperature": 0.1,
            "max_tokens": 8192,
        },
    )
    if response.status_code >= 400:
        raise RuntimeError(response.text.strip() or f"{provider_name} 视觉识别失败")
    content_text = response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    if not isinstance(content_text, str) or not content_text.strip():
        raise RuntimeError(f"{provider_name} 没有返回识别结果")
    payload = content_text.strip()
    if payload.startswith("```"):
        payload = re.sub(r"^```[a-zA-Z]*\s*", "", payload)
        payload = re.sub(r"\s*```\s*$", "", payload)
    return json.loads(payload)


async def analyze_imported_question(question: ImportedQuestionDraft) -> QuestionImportAnalyzeResponse:
    prompt = f"""
你是一名中文题库教研助手。请分析下面这道题，输出 JSON。

题目类型：{question.type}
题目内容：{question.content_text}
选项：{json.dumps(question.options or {}, ensure_ascii=False)}
答案：{question.answer_text or ""}

请返回 JSON 对象，包含：
analysis: 对题目的简洁解析，适合展示给老师
difficulty: 1 到 5 的整数
difficulty_reason: 给出难度建议的理由
"""

    data = await _request_deepseek_json(prompt)
    return QuestionImportAnalyzeResponse(
        analysis=str(data.get("analysis", "")).strip(),
        difficulty=max(1, min(5, int(data.get("difficulty", 3)))),
        difficulty_reason=str(data.get("difficulty_reason", "")).strip(),
    )


_VALID_QUESTION_TYPES = {"choice", "true_false", "fill_in", "short_answer", "essay", "code"}


_TEMPLATE_PREFIXES = (
    "题型：",
    "题目内容：",
    "答案：",
    "分析：",
    "解析：",
    "难度：",
    "[题型]",
    "[题目内容]",
    "[答案]",
    "[分析]",
    "[解析]",
    "[难度]",
)
_QUESTION_START_PATTERNS = [
    # NOTE: question numbers must have an explicit delimiter (".", ")", "、",
    # bracket pair, etc.). Stripping bare "\d+(?=\s+)" used to wipe the leading
    # number out of stems like "26 岁初产妇" because it looked like a question
    # number followed by whitespace.
    re.compile(r"^\s*(\d+[\.．\)）、]|[\(\（]\d+[\)）]|\[\d+\]|【\d+】)\s*"),
    re.compile(r"^\s*([一二三四五六七八九十]+[、\.．])\s*"),
    re.compile(r"^\s*(单选题|单选|多选题|多选|选择题|判断题|判断|填空题|填空|简答题|简答|编程题|编程|论述题|论述)\b"),
]
_QUESTION_TYPE_KEYWORDS = (
    "单项选择题",
    "单项选择",
    "单选题",
    "单选",
    "多项选择题",
    "多项选择",
    "多选选择题",
    "多选选择",
    "多选题",
    "多选",
    "选择题",
    "选择",
    "填空题",
    "填空",
    "判断题",
    "判断",
    "是非题",
    "是非",
    "简答题",
    "简答",
    "论述题",
    "论述",
    "编程题",
    "编程",
    "代码题",
    "代码",
    "计算题",
    "计算",
)
_QUESTION_TYPE_KEYWORD_PATTERN = "|".join(re.escape(keyword) for keyword in _QUESTION_TYPE_KEYWORDS)


@dataclass(slots=True)
class SegmentedBlock:
    raw_text: str
    segment_source: str = "rule"
    boundary_confidence: str = "high"
    type_hint: str | None = None


@dataclass(slots=True)
class SegmentedParagraphBlock:
    text: str
    kind: str = "paragraph"


def detect_import_template_mode(raw_text: str) -> str:
    """Detect whether document text looks like the supported field template."""
    lines = [line.strip() for line in raw_text.replace("\r\n", "\n").split("\n") if line.strip()]
    prefix_hits = sum(
        1
        for line in lines[:30]
        if any(line.startswith(prefix) for prefix in _TEMPLATE_PREFIXES)
    )
    has_question_header = any(
        re.match(r"^(?:\[(题型|题目内容)\]|(题型|题目内容)[:：])", line)
        for line in lines[:50]
    )
    return (
        ImportRecognitionMode.TEMPLATE.value
        if has_question_header and prefix_hits >= 3
        else ImportRecognitionMode.SMART.value
    )


def _is_question_start(line: str) -> tuple[bool, str]:
    for index, pattern in enumerate(_QUESTION_START_PATTERNS):
        if pattern.search(line):
            return True, "high" if index == 0 else "medium"
    return False, "low"


def _is_numbered_question_start(line: str) -> bool:
    return bool(_QUESTION_START_PATTERNS[0].search(line))


def _is_attachment_line(line: str) -> bool:
    return bool(
        re.match(r"^([A-H])[\.．、\)]\s*(.+)$", line, re.IGNORECASE)
        or re.match(r"^(答案|参考答案|解析|分析|难度|难易度)[:：]", line)
        or re.match(r"^\[(答案|参考答案|解析|分析|难度)\]\s*", line)
        or line.startswith("```")
        or re.match(r"^\[IMAGE:[^\]]+\]$", line)
    )


def _is_question_tail_marker(line: str) -> bool:
    normalized = line.strip()
    return bool(
        re.match(r"^\[?(答案|参考答案|解析|分析|难度|预计时间|预期时间)\]\s*", normalized)
        or re.match(r"^\[?(答案|参考答案|解析|分析|难度|预计时间|预期时间)[:：]", normalized)
    )


def _get_tail_field_type(line: str) -> str | None:
    normalized = line.strip()
    match = re.match(r"^\[?(答案|参考答案|解析|分析|难度|预计时间|预期时间)(?:\]|[:：])?", normalized)
    if not match:
        return None
    label = match.group(1)
    if label in {"答案", "参考答案"}:
        return "answer"
    if label in {"解析", "分析"}:
        return "analysis"
    if label == "难度":
        return "difficulty"
    if label in {"预计时间", "预期时间"}:
        return "time"
    return None


def _split_block_when_question_restarts(block_text: str, *, split_numbered_restarts: bool = False) -> list[str]:
    lines = [line.strip() for line in block_text.splitlines() if line.strip()]
    if not lines:
        return []

    chunks: list[list[str]] = []
    current: list[str] = []
    seen_tail_marker = False

    for line in lines:
        is_start, _confidence = _is_question_start(line)
        should_split = (
            bool(current)
            and (seen_tail_marker or (split_numbered_restarts and _is_numbered_question_start(line)))
            and is_start
            and not _is_attachment_line(line)
        )
        if should_split:
            chunks.append(current)
            current = [line]
            seen_tail_marker = False
            continue

        current.append(line)
        if _is_question_tail_marker(line):
            seen_tail_marker = True

    if current:
        chunks.append(current)

    return ["\n".join(chunk).strip() for chunk in chunks if any(part.strip() for part in chunk)]


def _split_document_into_blocks(raw_text: str) -> list[SegmentedParagraphBlock]:
    lines = [line.rstrip() for line in raw_text.replace("\r\n", "\n").split("\n")]
    blocks: list[SegmentedParagraphBlock] = []
    current: list[str] = []

    def flush_current() -> None:
        if not current:
            return
        text = "\n".join(part for part in current if part.strip()).strip()
        current.clear()
        if text:
            blocks.append(SegmentedParagraphBlock(text=text))

    for line in lines:
        stripped = line.strip()
        if not stripped:
            flush_current()
            continue
        if stripped.startswith("```") or re.match(r"^\[IMAGE:[^\]]+\]$", stripped) or _parse_template_field_line(stripped):
            flush_current()
            kind = "field" if _parse_template_field_line(stripped) else "image" if stripped.startswith("[IMAGE:") else "code"
            blocks.append(SegmentedParagraphBlock(text=stripped, kind=kind))
            continue
        if stripped.startswith("[试卷题型说明]"):
            flush_current()
            blocks.append(SegmentedParagraphBlock(text=stripped, kind="section"))
            continue
        current.append(stripped)

    flush_current()
    return blocks


def _block_has_question_tail_marker(block_text: str) -> bool:
    return any(_is_question_tail_marker(line) for line in block_text.splitlines() if line.strip())


def _get_last_tail_field_type(block_text: str) -> str | None:
    detected: str | None = None
    for line in block_text.splitlines():
        field_type = _get_tail_field_type(line)
        if field_type:
            detected = field_type
    return detected


def _is_explicit_typed_question_start(line: str) -> bool:
    stripped = _strip_question_start_prefix(line)
    return bool(
        re.match(
            rf"^\[?({_QUESTION_TYPE_KEYWORD_PATTERN})\]?",
            stripped,
        )
    )


def _is_section_heading_only(block_text: str) -> bool:
    stripped = block_text.strip()
    return bool(
        re.match(
            rf"^[一二三四五六七八九十]+[、.．]?\s*(?:{_QUESTION_TYPE_KEYWORD_PATTERN})?"
            r"(?:\s*[（(][^）)]*[）)])?$",
            stripped,
        )
    )


def _extract_section_type_hint(block_text: str) -> str | None:
    stripped = block_text.strip()
    if stripped.startswith("[试卷题型说明]"):
        stripped = stripped.removeprefix("[试卷题型说明]").strip()
    if not re.match(r"^[一二三四五六七八九十]+[、.．]?", stripped):
        return None
    match = re.search(_QUESTION_TYPE_KEYWORD_PATTERN, stripped)
    if not match:
        return None
    return match.group(0)


def _block_looks_like_question_candidate(block_text: str) -> bool:
    lines = [line.strip() for line in block_text.splitlines() if line.strip()]
    options, _ = _extract_options(lines)
    return bool(_is_explicit_typed_question_start(block_text) or len(options) >= 2)


def segment_question_document(raw_text: str) -> list[SegmentedBlock]:
    """Segment non-template text into candidate question blocks."""
    paragraph_blocks = _split_document_into_blocks(raw_text)
    blocks: list[SegmentedBlock] = []
    current: list[str] = []
    current_confidence = "high"
    current_has_tail_marker = False
    current_tail_field_type: str | None = None
    current_type_hint: str | None = None

    for block in paragraph_blocks:
        section_hint = _extract_section_type_hint(block.text)
        if block.text.strip().startswith("[试卷题型说明]") or _is_section_heading_only(block.text):
            if current:
                text = "\n".join(part for part in current if part.strip()).strip()
                if text:
                    blocks.append(SegmentedBlock(raw_text=text, boundary_confidence=current_confidence))
                current = []
                current_confidence = "high"
                current_has_tail_marker = False
                current_tail_field_type = None
            if section_hint:
                current_type_hint = section_hint
            continue
        sub_blocks = _split_block_when_question_restarts(block.text, split_numbered_restarts=current_type_hint is not None)
        if not sub_blocks:
            sub_blocks = [block.text]

        for sub_block in sub_blocks:
            stripped = sub_block.strip()
            is_start, confidence = _is_question_start(stripped)
            is_answer_or_analysis_continuation = (
                current_tail_field_type in {"answer", "analysis"}
                and is_start
                and not _is_explicit_typed_question_start(stripped)
                and not _block_looks_like_question_candidate(stripped)
            )
            should_start_new = (
                is_start
                and current
                and not _is_attachment_line(stripped)
                and not is_answer_or_analysis_continuation
                and (
                    current_has_tail_marker
                    or _is_explicit_typed_question_start(stripped)
                    or (_is_numbered_question_start(stripped) and _block_looks_like_question_candidate(stripped))
                )
            )
            if should_start_new:
                text = "\n".join(part for part in current if part.strip()).strip()
                if text:
                    blocks.append(
                        SegmentedBlock(
                            raw_text=text,
                            boundary_confidence=current_confidence,
                            type_hint=current_type_hint,
                        )
                    )
                current = [stripped]
                current_confidence = confidence
                current_has_tail_marker = _block_has_question_tail_marker(stripped)
                current_tail_field_type = _get_last_tail_field_type(stripped)
            else:
                if not current:
                    current_confidence = confidence if is_start else "low"
                current.append(stripped)
                current_has_tail_marker = current_has_tail_marker or _block_has_question_tail_marker(stripped)
                current_tail_field_type = _get_last_tail_field_type(stripped) or current_tail_field_type

    if current:
        text = "\n".join(part for part in current if part.strip()).strip()
        if text:
            blocks.append(
                SegmentedBlock(
                    raw_text=text,
                    boundary_confidence=current_confidence,
                    type_hint=current_type_hint,
                )
            )

    return blocks


def _strip_question_start_prefix(text: str) -> str:
    next_text = text
    for pattern in _QUESTION_START_PATTERNS[:2]:
        next_text = pattern.sub("", next_text, count=1).strip()
    return next_text


def _insert_fill_in_blanks(content_text: str, answer_text: str) -> str:
    """Replace answer text occurrences in content with _____ blanks.

    When the AI fails to mark blanks, try to find answers in the content
    and substitute them.  Multi-answer strings are split on common
    separators and each fragment is replaced independently.
    """
    if not answer_text:
        return content_text

    # Split multi-answer strings: ；; ，,  、 /
    fragments = re.split(r"\s*[；;,，、/]\s*", answer_text.strip())
    fragments = [f for f in fragments if f]

    result = content_text
    has_blank = False
    for fragment in fragments:
        if fragment and fragment in result:
            result = result.replace(fragment, "_____", 1)
            has_blank = True

    if not has_blank and fragments:
        # Try the full (unsplit) answer if fragments didn't match
        full = answer_text.strip()
        if full and full in result:
            result = result.replace(full, "_____", 1)
            has_blank = True

    if not has_blank and fragments:
        # Last resort: try matching each word/character cluster of each fragment
        for fragment in fragments:
            for token in re.split(r"\s+", fragment):
                if len(token) >= 2 and token in result:
                    result = result.replace(token, "_____", 1)
                    has_blank = True
                    break

    return result


@dataclass(frozen=True)
class TaggedListLine:
    kind: str
    text: str


_TAGGED_LIST_LINE_RE = re.compile(r"^\[(OL|UL)\]\s*(.+)$", re.IGNORECASE)
_EXPLICIT_OPTION_LINE_RE = re.compile(r"^([A-H])[\.．、\)]\s*(.+)$", re.IGNORECASE)
_INLINE_OPTIONS_RE = re.compile(r"(?:^|\s)([A-H])[\.．、\)]\s*(.*?)(?=\s+[A-H][\.．、\)]\s*|$)", re.IGNORECASE)


def _parse_tagged_list_line(line: str) -> TaggedListLine | None:
    match = _TAGGED_LIST_LINE_RE.match(line.strip())
    if not match:
        return None
    return TaggedListLine(kind=match.group(1).upper(), text=match.group(2).strip())


def _looks_like_choice_prompt(text: str) -> bool:
    normalized = text.strip()
    return bool(
        re.search(
            r"(单项选择题|单项选择|单选题|单选|多项选择题|多项选择|多选选择题|多选选择|多选题|多选|选择题|选择)",
            normalized,
        )
        or re.search(r"(下列|以下|下面).*(正确|错误|不正确|不属于|属于|是)", normalized)
    )


def _extract_inline_options_from_line(line: str) -> dict[str, str]:
    matches = list(_INLINE_OPTIONS_RE.finditer(line))
    if len(matches) < 2:
        return {}
    options: dict[str, str] = {}
    for match in matches:
        key = match.group(1).upper()
        value = match.group(2).strip()
        if key not in options and value:
            options[key] = value
    return options


def _strip_inline_options_from_line(line: str) -> str:
    matches = list(_INLINE_OPTIONS_RE.finditer(line))
    if len(matches) < 2:
        return ""
    return line[: matches[0].start()].strip()


def _extract_options(
    lines: list[str],
    *,
    type_hint_text: str = "",
    answer_text: str = "",
) -> tuple[dict[str, str], set[int]]:
    options: dict[str, str] = {}
    consumed_indexes: set[int] = set()

    for index, line in enumerate(lines):
        inline_options = _extract_inline_options_from_line(line)
        if len(inline_options) >= 2:
            for key, value in inline_options.items():
                if key not in options:
                    options[key] = value
            consumed_indexes.add(index)

    if options:
        return options, consumed_indexes

    for index, line in enumerate(lines):
        match = _EXPLICIT_OPTION_LINE_RE.match(line)
        if match:
            options[match.group(1).upper()] = match.group(2).strip()
            consumed_indexes.add(index)

    if options:
        return options, consumed_indexes

    tagged_lines: list[tuple[int, TaggedListLine]] = []
    for index, line in enumerate(lines):
        tagged = _parse_tagged_list_line(line)
        if tagged and tagged.kind == "OL":
            tagged_lines.append((index, tagged))

    choice_context = _looks_like_choice_prompt("\n".join(part for part in [type_hint_text, *lines] if part)) or bool(
        re.fullmatch(r"[A-H]+", answer_text.strip(), re.IGNORECASE)
    )
    if not choice_context or len(tagged_lines) < 2:
        return {}, set()

    for offset, (index, tagged) in enumerate(tagged_lines[:8]):
        options[chr(65 + offset)] = tagged.text
        consumed_indexes.add(index)

    return options, consumed_indexes


def _normalize_difficulty(value: str | None) -> int:
    if not value:
        return 3
    number_match = re.search(r"[1-5]", value)
    if number_match:
        return int(number_match.group(0))
    labels = {
        "容易": 1,
        "简单": 1,
        "较易": 2,
        "中等": 3,
        "一般": 3,
        "较难": 4,
        "困难": 4,
        "很难": 5,
    }
    template_labels = {
        "很容易": 1,
        "容易": 1,
        "较易": 2,
        "中等": 3,
        "一般": 3,
        "较难": 4,
        "困难": 4,
        "很难": 5,
    }
    for label, difficulty in template_labels.items():
        if label in value:
            return difficulty
    for label, difficulty in labels.items():
        if label in value:
            return difficulty
    return 3


def _parse_template_field_line(line: str) -> tuple[str, str] | None:
    normalized = line.strip()
    bracket_match = re.match(r"^\[(题型|题目内容|答案|参考答案|分析|解析|难度)\]\s*(.*)$", normalized)
    if bracket_match:
        return bracket_match.group(1), bracket_match.group(2).strip()
    colon_match = re.match(r"^(题型|题目内容|答案|参考答案|分析|解析|难度)[:：]\s*(.*)$", normalized)
    if colon_match:
        return colon_match.group(1), colon_match.group(2).strip()
    return None


def _split_template_blocks(raw_text: str) -> list[list[str]]:
    lines = [line.rstrip() for line in raw_text.replace("\r\n", "\n").split("\n")]
    blocks: list[list[str]] = []
    current: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        field = _parse_template_field_line(stripped)
        starts_new_question = bool(field and field[0] == "题型" and current)
        if starts_new_question:
            blocks.append(current)
            current = [stripped]
            continue
        current.append(stripped)

    if current:
        blocks.append(current)
    return blocks


def _detect_question_type(raw_text: str, options: dict[str, str], answer_text: str) -> tuple[str, str]:
    if re.search(r"(判断题|判断|是非题|是非)", raw_text):
        return "true_false", "high"
    if re.search(r"(填空题|填空)", raw_text):
        return "fill_in", "high"
    if re.search(r"(简答题|简答|问答题)", raw_text):
        return "short_answer", "high"
    if re.search(r"(单项选择题|单项选择|单选题|单选|多项选择题|多项选择|多选选择题|多选选择|多选题|多选|选择题|选择)", raw_text) or len(options) >= 2:
        return "choice", "high"
    if re.search(r"(论述题|论述|阐述|分析并评价|结合实际谈谈)", raw_text):
        return "essay", "high"
    if re.search(r"(编程题|编程|代码题|代码|程序设计|实现函数|编写程序|示例输入|示例输出|```)", raw_text, re.IGNORECASE):
        return "code", "high"
    if re.search(r"(判断题|判断|是非题|是非)", raw_text) or re.fullmatch(
        r"(正确|错误|对|错|√|×|T|F|True|False)", answer_text.strip(), re.IGNORECASE
    ):
        return "true_false", "high"
    if re.search(r"(_{2,}|（\s*）|\(\s*\)|【\s*】|\[\s*\])", raw_text):
        return "fill_in", "high"
    return "short_answer", "medium"


def _is_standalone_question_type_line(line: str) -> bool:
    return bool(
        re.fullmatch(
            _QUESTION_TYPE_KEYWORD_PATTERN,
            line.strip(),
        )
    )


# Markdown 水平分隔线。不含下划线——填空题干里的连续下划线是空位，不是分隔线。
_MARKDOWN_RULE_RE = re.compile(r"^(?:\*{3,}|-{3,})$")


def _is_markdown_rule_line(line: str) -> bool:
    """``***`` / ``---`` 这类排版分隔线，不能当成题目内容。

    表格分隔行写的是 ``| --- | --- |``（带竖线），不会被这里命中。
    """
    return bool(_MARKDOWN_RULE_RE.match(line.strip()))


def _normalize_inline_tail_fields(raw_text: str) -> str:
    return re.sub(
        r"(?<!\n)\s*(\[(?:答案|参考答案|解析|分析|难度|难易度|预计时间|预期时间)\])",
        r"\n\1",
        raw_text,
    )


def build_import_draft_from_segment(
    raw_text: str,
    *,
    segment_source: str = "rule",
    boundary_confidence: str = "high",
    type_hint: str | None = None,
    images: list[QuestionImportImageInput] | None = None,
    comparison_flags: list[str] | None = None,
) -> QuestionImportDraft:
    normalized_raw_text = _normalize_inline_tail_fields(raw_text)
    lines = [line.strip() for line in normalized_raw_text.splitlines() if line.strip()]
    answer_text = ""
    analysis = ""
    difficulty_text = ""
    type_hint_text = type_hint or ""
    content_candidates: list[tuple[int, str]] = []
    collecting_field: str | None = None
    answer_lines: list[str] = []
    analysis_lines: list[str] = []

    def flush_collecting_field() -> None:
        nonlocal answer_text, analysis, collecting_field
        if collecting_field == "answer" and answer_lines:
            answer_text = "\n".join(answer_lines).strip()
        elif collecting_field == "analysis" and analysis_lines:
            analysis = "\n".join(analysis_lines).strip()
        collecting_field = None

    for index, line in enumerate(lines):
        answer_match = re.match(r"^(?:\[(答案|参考答案|正确答案)\]|(正确答案|答案|参考答案|answer))[:：]?\s*(.+)$", line, re.IGNORECASE)
        analysis_match = re.match(r"^(?:\[(解析|分析)\]|(解析|分析|analysis))[:：]?\s*(.+)$", line, re.IGNORECASE)
        difficulty_match = re.match(r"^(?:\[(难度|难易度)\]|(难度|难易度|difficulty))[:：]?\s*(.+)$", line, re.IGNORECASE)
        blank_answer_field = re.match(r"^(?:\[(答案|参考答案|正确答案)\]|(正确答案|答案|参考答案|answer))[:：]?\s*$", line, re.IGNORECASE)
        blank_analysis_field = re.match(r"^(?:\[(解析|分析)\]|(解析|分析|analysis))[:：]?\s*$", line, re.IGNORECASE)
        blank_difficulty_field = re.match(r"^(?:\[(难度|难易度)\]|(难度|难易度|difficulty))[:：]?\s*$", line, re.IGNORECASE)
        time_field = re.match(r"^(?:\[(预计时间|预期时间)\]|(预计时间|预期时间|expected.?time))[:：]?\s*(.*)$", line, re.IGNORECASE)
        type_field = re.match(r"^(?:\[题型\]|题型[:：])\s*(.+)$", line)
        if blank_answer_field:
            flush_collecting_field()
            answer_lines = []
            collecting_field = "answer"
        elif answer_match:
            flush_collecting_field()
            answer_text = answer_match.group(3).strip()
        elif blank_analysis_field:
            flush_collecting_field()
            analysis_lines = []
            collecting_field = "analysis"
        elif analysis_match:
            flush_collecting_field()
            analysis = analysis_match.group(3).strip()
        elif blank_difficulty_field:
            flush_collecting_field()
        elif difficulty_match:
            flush_collecting_field()
            difficulty_text = difficulty_match.group(3).strip()
        elif time_field:
            flush_collecting_field()
        elif type_field:
            flush_collecting_field()
            type_hint_text = type_field.group(1).strip()
        elif _is_standalone_question_type_line(line):
            flush_collecting_field()
            continue
        elif _is_markdown_rule_line(line):
            flush_collecting_field()
            continue
        elif collecting_field == "answer":
            answer_lines.append(line)
        elif collecting_field == "analysis":
            analysis_lines.append(line)
        else:
            content_candidates.append((index, line))

    flush_collecting_field()

    options, consumed_option_indexes = _extract_options(
        lines,
        type_hint_text=type_hint_text,
        answer_text=answer_text,
    )
    content_lines: list[str] = []
    for index, line in content_candidates:
        if index in consumed_option_indexes:
            inline_stem = _strip_inline_options_from_line(line)
            if inline_stem:
                content_lines.append(_strip_question_start_prefix(inline_stem))
            continue
        tagged_line = _parse_tagged_list_line(line)
        if tagged_line:
            content_lines.append(tagged_line.text)
            continue
        content_lines.append(_strip_question_start_prefix(line))

    content_text = "\n".join(line for line in content_lines if line).strip()
    question_type, type_confidence = _detect_question_type(
        "\n".join(part for part in [type_hint_text, content_text or raw_text] if part),
        options,
        answer_text,
    )
    issues: list[str] = []
    if not content_text:
        issues.append("题目内容为空")
    if question_type == "choice" and len(options) < 2:
        issues.append("选择题选项不完整")
    if not answer_text:
        issues.append("未识别到答案")
    if type_confidence == "low":
        issues.append("题型不确定")

    return QuestionImportDraft(
        draft_id=str(uuid.uuid4()),
        raw_text=raw_text,
        title=(content_text or raw_text).replace("\n", " ")[:120],
        type=question_type,  # type: ignore[arg-type]
        content_text=content_text,
        options=options or None,
        answer_text=answer_text or None,
        analysis=analysis or None,
        difficulty=_normalize_difficulty(difficulty_text),
        segment_source=segment_source,
        type_confidence=type_confidence,  # type: ignore[arg-type]
        boundary_confidence=boundary_confidence,  # type: ignore[arg-type]
        issues=issues,
        images=list(images or []),
        comparison_flags=list(comparison_flags or []),
        review_status=ImportReviewStatus.PENDING,
        review_required=True,
    )


def parse_template_document(raw_text: str) -> list[QuestionImportDraft]:
    drafts: list[QuestionImportDraft] = []
    for block_lines in _split_template_blocks(raw_text):
        fields: dict[str, str] = {}
        content_lines: list[str] = []
        for line in block_lines:
            field = _parse_template_field_line(line)
            if field:
                fields[field[0]] = field[1]
            else:
                content_lines.append(line)
        if not fields:
            continue
        content_text = fields.get("题目内容", "")
        if content_lines:
            content_text = "\n".join(part for part in [content_text, *content_lines] if part).strip()
        text = "\n".join(
            [
                # 必须带「题型：」标签。只给裸值（如 "判断题"）会被
                # build_import_draft_from_segment 当成「单独一行的题型词」丢掉，
                # 题型提示随之丢失；题干里若出现「选择」之类字样（例如
                # "K 值的选择对聚类结果…"）就会被误判成选择题。
                f"题型：{fields.get('题型', '')}",
                content_text,
                f"答案：{fields.get('答案') or fields.get('参考答案') or ''}",
                f"解析：{fields.get('分析') or fields.get('解析') or ''}",
                f"难度：{fields.get('难度') or '3'}",
            ]
        )
        draft = build_import_draft_from_segment(
            text,
            segment_source="template",
            boundary_confidence="high",
        )
        drafts.append(draft)
    return drafts


# 标准模板的必填字段：只有整篇文档的每一道题都带齐这些字段，才认定文档
# 「就是标准模板」，可以直接用正则解析而不调用大模型。缺字段的文档仍走
# 智能识别，避免规则解析静默丢题。
_STANDARD_TEMPLATE_REQUIRED_FIELDS: tuple[str, ...] = ("题型", "题目内容")
_STANDARD_TEMPLATE_ANSWER_FIELDS: tuple[str, ...] = ("答案", "参考答案")
# 允许极少数题目字段破损（复制粘贴残留、手改漏填）。否则 250 道里只要有 1 道
# 缺答案，整篇就会放弃规则解析、退回 AI 重新切题 —— 那种「一刀切」正是丢题的
# 根源。破损题目仍会生成草稿并带 issue，在审核页里可筛可改。
_STANDARD_TEMPLATE_MIN_BLOCK_RATIO = 0.9


def _template_block_field_names(block_lines: list[str]) -> set[str]:
    # 判定口径必须和 parse_template_document / build_import_draft_from_segment 一致：
    # 它们都会用 _normalize_inline_tail_fields 把行内的 `[答案]` 拆到独立一行。
    # 这里不做同样的归一化，`题目内容：xx [答案] A` 这类写法就会被判成「缺答案」，
    # 一道题的瑕疵会让整篇文档放弃规则解析、退回 AI。
    normalized = _normalize_inline_tail_fields("\n".join(block_lines))
    names: set[str] = set()
    for line in normalized.split("\n"):
        field = _parse_template_field_line(line)
        if field is not None:
            names.add(field[0])
    return names


def _is_complete_template_block(field_names: set[str]) -> bool:
    return all(
        field in field_names for field in _STANDARD_TEMPLATE_REQUIRED_FIELDS
    ) and any(field in field_names for field in _STANDARD_TEMPLATE_ANSWER_FIELDS)


def is_standard_template_document(raw_text: str) -> bool:
    """``raw_text`` 是否严格符合「题型 / 题目内容 / 答案」标准模板。

    只按字段前缀做正则判定，不调用大模型。块切分以「题型」字段为界，开头没有
    字段的说明性段落（标题、难度映射表等）会被忽略；带字段的块里至少有九成
    同时具备必填字段和答案，才认定整篇可以纯规则解析。低于这个比例说明排版和
    解析器预期不符，返回 ``False`` 让调用方回退到智能识别。
    """
    field_name_sets = [
        names
        for names in (
            _template_block_field_names(block) for block in _split_template_blocks(raw_text)
        )
        if names
    ]
    if not field_name_sets:
        return False
    complete_blocks = sum(1 for names in field_name_sets if _is_complete_template_block(names))
    return complete_blocks >= len(field_name_sets) * _STANDARD_TEMPLATE_MIN_BLOCK_RATIO


def _is_complete_template_draft(draft: QuestionImportDraft) -> bool:
    if not draft.content_text.strip() or not (draft.answer_text or "").strip():
        return False
    if draft.type.value == "choice" and len(draft.options or {}) < 2:
        return False
    return True


def build_standard_template_drafts(
    payload: QuestionImportDocumentRecognizeRequest,
) -> list[QuestionImportDraft] | None:
    """纯正则解析标准模板文档；结果不合格时返回 ``None`` 交给智能识别。

    返回 ``None`` 的情况：文档不是标准模板，或者虽然字段齐全但解析出来的题目
    大面积缺题干/答案/选项（说明字段位置和解析器预期不符）。宁可多调用一次大
    模型，也不要让规则解析把题目悄悄丢掉。
    """
    if not is_standard_template_document(payload.raw_text):
        return None
    drafts = _build_rule_based_drafts(payload, ImportRecognitionMode.TEMPLATE.value)
    if not drafts:
        return None
    complete_drafts = sum(1 for draft in drafts if _is_complete_template_draft(draft))
    if complete_drafts < len(drafts) * _STANDARD_TEMPLATE_MIN_BLOCK_RATIO:
        return None
    return drafts


def _collect_segment_images(raw_text: str, images: list[QuestionImportImageInput]) -> list[QuestionImportImageInput]:
    image_ids = re.findall(r"\[IMAGE:([^\]]+)\]", raw_text)
    if not image_ids:
        return []
    index = {image.image_id: image for image in images}
    return [index[image_id] for image_id in image_ids if image_id in index]


def _is_paper_import_context(payload: QuestionImportDocumentRecognizeRequest) -> bool:
    return payload.import_context == "paper"


_IMPORT_NAMED_ENTITIES: tuple[tuple[str, str], ...] = (
    ("&nbsp;", " "),
    ("&ensp;", " "),
    ("&emsp;", " "),
    ("&quot;", '"'),
    ("&apos;", "'"),
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&amp;", "&"),
)
_IMPORT_NUMERIC_ENTITY_RE = re.compile(r"&#(?:[xX]([0-9a-fA-F]+)|(\d+));")


def _decode_import_html_entities(text: str) -> str:
    """还原从网页 / Word 导出复制来的 HTML 实体。

    Markdown 题库里常见 `&#x20;`（空格的十六进制实体）残留。它有两种危害：
    一是把垃圾字符带进题干、选项和答案——判断题答案会变成 ``错误&#x20;``，
    判分时和标准答案对不上；二是 ``&#x20;[答案] BCD`` 这类行首带实体的字段
    整行都识别不到（行首不是 ``[``，字段正则匹配失败），进而丢掉一整道题的
    答案。
    """
    if "&" not in text:
        return text

    def replace_numeric(match: re.Match[str]) -> str:
        hexadecimal, decimal = match.group(1), match.group(2)
        try:
            return chr(int(hexadecimal, 16) if hexadecimal else int(decimal))
        except (ValueError, OverflowError):
            return match.group(0)

    decoded = _IMPORT_NUMERIC_ENTITY_RE.sub(replace_numeric, text)
    for entity, character in _IMPORT_NAMED_ENTITIES:
        if entity in decoded:
            decoded = decoded.replace(entity, character)
    return decoded


def _table_to_import_text(table: QuestionImportTableInput) -> str:
    rendered_rows = [
        "| " + " | ".join(cell.strip() for cell in row) + " |"
        for row in table.rows
        if any(cell.strip() for cell in row)
    ]
    if not rendered_rows:
        return f"[TABLE:{table.order}]"
    if len(rendered_rows) > 1:
        column_count = max(row.count("|") - 1 for row in rendered_rows)
        separator = "| " + " | ".join(["---"] * max(column_count, 1)) + " |"
        rendered_rows.insert(1, separator)
    return "\n".join([f"[TABLE:{table.order}]", *rendered_rows])


def _looks_like_paper_header_or_answer_sheet(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    normalized = re.sub(r"\s+", "", stripped)
    header_keywords = (
        "学年",
        "学期",
        "期末考试试卷",
        "期中考试试卷",
        "考试试卷",
        "答题时限",
        "考试形式",
        "闭卷笔试",
        "班级",
        "学号",
        "姓名",
        "得分",
        "得分统计表",
        "阅卷教师",
        "核查人签名",
    )
    if any(keyword in normalized for keyword in header_keywords):
        return True
    if re.fullmatch(r"(?:\d+[\.．]?\s*){3,}", stripped):
        return True
    if "选择题答案请填写" in normalized or "答案请填写下表" in normalized:
        return True
    return False


def _looks_like_answer_sheet_number_row(line: str) -> bool:
    return bool(re.fullmatch(r"(?:\d+[\.．]?\s*){3,}", line.strip()))


def _looks_like_paper_section_heading(line: str) -> bool:
    line = line.strip()
    return bool(
        re.match(
            rf"^(?:[一二三四五六七八九十]+[、.．\s]\s*)?({_QUESTION_TYPE_KEYWORD_PATTERN})",
            line,
        )
    )


def preprocess_paper_import_text(
    raw_text: str,
    tables: list[QuestionImportTableInput],
) -> str:
    lines = [line.strip() for line in raw_text.replace("\r\n", "\n").splitlines()]
    kept: list[str] = []
    section_context: str | None = None
    seen_question_section = False

    for line in lines:
        if not line:
            if kept and kept[-1] != "":
                kept.append("")
            continue
        if _looks_like_paper_section_heading(line):
            seen_question_section = True
            section_context = line
            kept.append(f"[试卷题型说明] {line}")
            continue
        if not seen_question_section:
            continue
        is_start, _confidence = _is_question_start(line)
        if _looks_like_paper_header_or_answer_sheet(line) and (
            _looks_like_answer_sheet_number_row(line) or not (is_start and len(line) > 12)
        ):
            continue
        if is_start and section_context and kept and kept[-1].startswith("[试卷题型说明]"):
            kept.append(line)
            continue
        kept.append(line)

    eligible_tables = {
        table.order: table
        for table in tables
        if table.rows and not any("得分统计表" in "".join(row) or "选择题答案" in "".join(row) for row in table.rows)
    }
    body = "\n".join(kept).strip()

    referenced_orders: set[int] = set()

    def replace_marker(match: re.Match[str]) -> str:
        order = int(match.group(1))
        referenced_orders.add(order)
        table = eligible_tables.get(order)
        if table is None:
            return ""
        return _table_to_import_text(table)

    body = re.sub(r"\[TABLE:(\d+)\]", replace_marker, body)

    leftover_table_texts = [
        _table_to_import_text(table)
        for order, table in eligible_tables.items()
        if order not in referenced_orders
    ]
    if leftover_table_texts:
        body = "\n\n".join(part for part in [body, *leftover_table_texts] if part)
    return body or raw_text


def _build_rule_based_drafts(payload: QuestionImportDocumentRecognizeRequest, mode: str) -> list[QuestionImportDraft]:
    if mode == ImportRecognitionMode.TEMPLATE.value:
        drafts = parse_template_document(payload.raw_text)
    else:
        drafts = [
            build_import_draft_from_segment(
                segment.raw_text,
                segment_source=segment.segment_source,
                boundary_confidence=segment.boundary_confidence,
                type_hint=segment.type_hint,
                images=_collect_segment_images(segment.raw_text, payload.images),
            )
            for segment in segment_question_document(payload.raw_text)
        ]

    if payload.images and mode == ImportRecognitionMode.TEMPLATE.value:
        return [
            draft.model_copy(update={"images": _collect_segment_images(draft.raw_text, payload.images)})
            for draft in drafts
        ]
    return drafts


def _needs_ai_completion(draft: QuestionImportDraft) -> bool:
    return (
        draft.boundary_confidence.value == "low"
        or draft.type_confidence.value == "low"
        or "选择题选项不完整" in draft.issues
        or "题型不确定" in draft.issues
    )


async def complete_import_draft_with_ai(draft: QuestionImportDraft) -> QuestionImportDraft:
    if not _needs_ai_completion(draft):
        return draft
    try:
        recognized = await recognize_imported_question(draft.raw_text)
    except Exception:
        return draft.model_copy(update={"issues": [*draft.issues, "AI 补全失败，请人工审核"]})

    merged = draft.model_copy(
        update={
            "type": recognized.type,
            "content_text": recognized.content_text or draft.content_text,
            "title": (recognized.content_text or draft.content_text or draft.title).replace("\n", " ")[:120],
            "options": recognized.options or draft.options,
            "answer_text": recognized.answer_text or draft.answer_text,
            "segment_source": f"{draft.segment_source}+ai" if "ai" not in draft.segment_source else draft.segment_source,
            "type_confidence": "medium" if draft.type_confidence.value == "low" else draft.type_confidence,
            "review_status": ImportReviewStatus.PENDING,
            "review_required": True,
        }
    )
    return merged


_PAPER_IMPORT_AI_RULES = """
试卷导入额外规则：
- 试卷封面/表头不是题目：学校名称、学年学期、课程名、试卷 A/B 卷、答题时限、考试形式、班级、学号、姓名、得分栏、得分统计表、阅卷教师/核查人签名均不要生成题目。
- 题型说明不是题目，例如"一、单项选择题（每小题 2 分，共 50 分）"只作为后续题型、分值和题量上下文。
- 答题卡/答案填写表不是题目，例如只包含 1. 2. 3...25. 的编号表格不要生成空题；它只能作为题量线索。
- 不要因为答题卡编号臆造空题。只输出实际看到完整题干的题目。
- 填空题（fill_in）的 content_text 必须用 "_____"（至少 4 个连续下划线）替代原文中需要学生填写的内容。例如原文"大数据的4V特征是海量（Volume）、高速（Velocity）"，应输出 content_text 为"大数据的4V特征是_____（_____）、_____（_____）"或类似形式。重点：用 "_____" 替换掉答案文字本身，不要保留答案在题干中，也不要只在末尾追加空位。
- 选择题可能把选项写在题干同一行内（如"题目内容 A. 选项1 B. 选项2 C. 选项3 D. 选项4"），需要提取到 options 字段中并把选项文本从 content_text 移除。
- 若同一段落中出现了两道题（格式异常），尝试拆分为两条独立题目。
- 文本中可能出现表格块，格式为：第一行 [TABLE:N] 标记，紧跟若干行 Markdown 风格的表格行（"| 单元格1 | 单元格2 | ... |"），其中可能含一行 "| --- | --- | --- |" 分隔行。表格属于其紧邻上文（同一道题题干）的一部分，必须把整张表完整保留在该题的 content_text 中（保留 Markdown 表格语法即可，去掉 [TABLE:N] 标记本身）。绝不可丢弃表格、不可把表格行单独成题、不可把表格当作多个题目；即使表格行以数字（如 "128.96.39.0"）开头也不是新题的起点。
"""

# 部分由 PDF 转换来的 DOCX 会把「答案：X 知识点：… 难度层次：… 」和下一题的
# 「12. 题干」塞进同一个段落（没有换行符），导致题号不在行首、边界扫描漏题。
_GLUED_QUESTION_AFTER_ANSWER_RE = re.compile(
    r"(?P<answer>答\s*案\s*[：:][^\n]*?)[ \t]+"
    r"(?=\d{1,3}\s*[.、．]\s*[\u4e00-\u9fffA-Za-z(（])"
)


def split_questions_glued_after_answers(text: str) -> str:
    """Break before a question number that shares a line with the previous answer.

    ``答案：B 知识点：… 难度层次：易 29. 语义分割…`` becomes two lines so the
    question-boundary scanner sees ``29.`` at the start of a line. Numbers that
    are followed by another digit (e.g. IP ``128.96.39.0``) are left untouched.
    """
    return _GLUED_QUESTION_AFTER_ANSWER_RE.sub(lambda match: f"{match.group('answer')}\n", text)


def _build_document_ai_prompt(
    raw_text: str,
    images: list[QuestionImportImageInput],
    *,
    import_context: str | None = None,
    recognition_prompt: str | None = None,
) -> str:
    image_lines = "\n".join(
        f"- {image.image_id}: {image.url} (order={image.order}, page={image.page or 'unknown'}, alt={image.alt or ''})"
        for image in images
    )
    paper_rules = _PAPER_IMPORT_AI_RULES if import_context == "paper" else ""
    custom_rules = ""
    if recognition_prompt and recognition_prompt.strip():
        custom_rules = f"""
用户补充识别要求：
{recognition_prompt.strip()}
"""
    # Allow up to 120K characters to support large papers (40+ questions).
    # Schema already validates max_length=1000000 upstream.
    truncated = raw_text[:120000]
    return f"""分析题目文本，只输出JSON: {{"questions":[{{"type":"choice|true_false|fill_in|short_answer|essay|code","content_text":"题干","options":{{"A":"..."}}|null,"answer_text":"答案或空","analysis":"解析或空","difficulty":1-5,"raw_text":"原文","images":[]}}]}}
{paper_rules}{custom_rules}
文本:
{truncated}"""


_DIFFICULTY_LABEL_LEVELS: tuple[tuple[str, int], ...] = (
    ("很容易", 1),
    ("非常容易", 1),
    ("很简单", 1),
    ("很难", 5),
    ("非常难", 5),
    ("较难", 4),
    ("困难", 4),
    ("难", 4),
    ("较易", 2),
    ("容易", 2),
    ("简单", 2),
    ("易", 2),
    ("中等", 3),
    ("一般", 3),
    ("中", 3),
)
_MAX_RECOGNIZED_KNOWLEDGE_POINTS = 3


def _difficulty_from_label(label: Any) -> int | None:
    """把题目原文标注的难度层次（易/中/难…）折算成 1-5 档。

    题库只有 1-5 的整数难度，三档标注按 易=2、中=3、难=4 折算，更细的标注
    （很容易/较易/中等/较难/很难）按对应档位折算。
    """
    text = str(label or "").strip()
    if not text:
        return None
    compact = re.sub(r"[\s:：;；,，.。、()（）\[\]【】|｜]", "", text)
    # "难度层次/难度等级" 本身含 "难"，先去掉标签词再匹配档位。
    compact = re.sub(r"(难度层次|难度等级|难度|级别|层次|程度)", "", compact)
    for token, level in _DIFFICULTY_LABEL_LEVELS:
        if token in compact:
            return level
    return None


def _recognized_knowledge_points(value: Any) -> list[str]:
    """规范化模型输出的知识点名称：去重、去空白、限制数量。"""
    if isinstance(value, str):
        raw_items: list[Any] = re.split(r"[、,，;；/|｜\n]", value)
    elif isinstance(value, list):
        raw_items = list(value)
    else:
        return []
    names: list[str] = []
    for raw in raw_items:
        name = str(raw).strip(" \t\r\n：:;；,，、|｜")
        if name and name not in names:
            names.append(name)
    return names[:_MAX_RECOGNIZED_KNOWLEDGE_POINTS]


def _recognized_question_number(value: Any) -> int | None:
    """原文印刷的题号；用于校验识别是否漏题（题号在同一题型内连续）。"""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    text = str(value).strip()
    if not text:
        return None
    digits = re.sub(r"\D", "", text)
    if not digits:
        return None
    number = int(digits)
    return number if number > 0 else None


def _missing_question_number_count(drafts: list[QuestionImportDraft]) -> int:
    """统计同一批内题号断档数（题号变小视为进入下一题型分段，不算断档）。"""
    numbers = [draft.question_number for draft in drafts if draft.question_number is not None]
    return sum(
        1
        for previous, current in zip(numbers, numbers[1:])
        for _ in range(max(0, current - previous - 1))
    )


def _incomplete_choice_count(drafts: list[QuestionImportDraft]) -> int:
    """选择题选项少于 2 个基本可以断定是识别漏了选项（原卷都印了 A/B/C/D）。"""
    return sum(1 for draft in drafts if draft.type.value == "choice" and len(draft.options or {}) < 2)


def _vision_result_score(drafts: list[QuestionImportDraft]) -> tuple[int, int]:
    """识别结果打分：先比题目数，再比选择题选项缺失数（越少越好）。"""
    return len(drafts), -_incomplete_choice_count(drafts)


def _validate_ai_document_questions(data: dict) -> list[dict]:
    questions = data.get("questions")
    if not isinstance(questions, list):
        raise RuntimeError("AI 分析结果格式异常，请重试")
    # 空列表是合法结果：文档里确实没有可识别的题目（如只有答题卡/封面的试卷页）。
    validated: list[dict] = []
    for item in questions:
        if not isinstance(item, dict):
            continue
        raw_type = str(item.get("type", "")).strip()
        if raw_type not in _VALID_QUESTION_TYPES:
            raw_type = "short_answer"
        difficulty = item.get("difficulty", 3)
        # 题目原文通常标注 "难度层次：易/中/难"，标签比模型换算的数字更可靠。
        safe_difficulty = _difficulty_from_label(item.get("difficulty_label")) or _difficulty_from_label(
            difficulty
        )
        if safe_difficulty is None:
            try:
                safe_difficulty = max(1, min(5, int(difficulty)))
            except (TypeError, ValueError):
                safe_difficulty = 3
        options = item.get("options")
        content_text = _strip_question_start_prefix(str(item.get("content_text", "")).strip())
        if raw_type == "fill_in" and content_text and not re.search(r"_{3,}|（\s*）|\(\s*\)|【\s*】", content_text):
            answer_text = str(item.get("answer_text", "")).strip()
            content_text = _insert_fill_in_blanks(content_text, answer_text)
        validated.append(
            {
                "type": raw_type,
                "content_text": content_text,
                "options": options if isinstance(options, dict) else None,
                "answer_text": str(item.get("answer_text", "")).strip(),
                "analysis": str(item.get("analysis", "")).strip(),
                "difficulty": safe_difficulty,
                "knowledge_points": _recognized_knowledge_points(item.get("knowledge_points")),
                "question_number": _recognized_question_number(item.get("question_number")),
                "raw_text": str(item.get("raw_text", "")).strip(),
                "images": item.get("images") if isinstance(item.get("images"), list) else [],
            }
        )
    return validated


def _build_ai_import_draft(
    question: dict,
    images: list[QuestionImportImageInput],
) -> QuestionImportDraft:
    image_index = {image.image_id: image for image in images}
    linked_images = [image_index[image_id] for image_id in question["images"] if image_id in image_index]
    answer_text = question["answer_text"] or None
    issues: list[str] = []
    if not question["content_text"]:
        issues.append("题目内容为空")
    if question["type"] == "choice" and len(question["options"] or {}) < 2:
        issues.append("选择题选项不完整")
    if not answer_text:
        issues.append("未识别到答案")
    return QuestionImportDraft(
        draft_id=str(uuid.uuid4()),
        raw_text=question["raw_text"] or question["content_text"],
        title=(question["content_text"] or question["raw_text"]).replace("\n", " ")[:120],
        type=question["type"],
        content_text=question["content_text"],
        options={str(key): str(value).strip() for key, value in (question["options"] or {}).items()} or None,
        answer_text=answer_text,
        analysis=question["analysis"] or None,
        difficulty=question["difficulty"],
        segment_source="ai_full",
        type_confidence="high",
        boundary_confidence="medium",
        issues=issues,
        images=linked_images,
        comparison_flags=[],
        recognized_knowledge_points=question.get("knowledge_points") or [],
        question_number=question.get("question_number"),
        review_status=ImportReviewStatus.PENDING,
        review_required=True,
    )


def _build_ai_import_draft_with_images(
    question: dict,
    image_urls: dict[str, str],
) -> QuestionImportDraft:
    """Build a draft with image filenames from LLM resolved to URLs.

    LLM outputs image filenames in the `images` field (via compact key `imgs`).
    This function resolves each filename to its full URL from `image_urls`.
    Unmatched filenames generate a warning issue.
    """
    image_filenames: list[str] = question.get("images") or []
    linked_images: list[QuestionImportImageInput] = []
    issues: list[str] = []
    for order, filename in enumerate(image_filenames):
        url = image_urls.get(filename)
        if url:
            linked_images.append(
                QuestionImportImageInput(
                    image_id=filename,
                    url=url,
                    order=order + 1,
                )
            )
        else:
            issues.append(f"图片未匹配：{filename}")

    answer_text = question["answer_text"] or None
    if not question["content_text"]:
        issues.append("题目内容为空")
    if question["type"] == "choice" and len(question["options"] or {}) < 2:
        issues.append("选择题选项不完整")
    if not answer_text:
        issues.append("未识别到答案")

    return QuestionImportDraft(
        draft_id=str(uuid.uuid4()),
        raw_text=question["raw_text"] or question["content_text"],
        title=(question["content_text"] or question["raw_text"]).replace("\n", " ")[:120],
        type=question["type"],
        content_text=question["content_text"],
        options={str(key): str(value).strip() for key, value in (question["options"] or {}).items()} or None,
        answer_text=answer_text,
        analysis=question["analysis"] or None,
        difficulty=question["difficulty"],
        segment_source="ai_full",
        type_confidence="high",
        boundary_confidence="medium",
        issues=issues,
        images=linked_images,
        comparison_flags=[],
        recognized_knowledge_points=question.get("knowledge_points") or [],
        question_number=question.get("question_number"),
        review_status=ImportReviewStatus.PENDING,
        review_required=True,
    )


def merge_ai_and_rule_recognition(
    ai_drafts: list[QuestionImportDraft],
    baseline: list[QuestionImportDraft],
) -> list[QuestionImportDraft]:
    comparison_flags: list[str] = []
    baseline_count = len(baseline)
    ai_count = len(ai_drafts)
    if baseline_count != ai_count:
        comparison_flags.append("count_mismatch")

    merged: list[QuestionImportDraft] = []
    for index, draft in enumerate(ai_drafts):
        baseline_draft = baseline[index] if index < baseline_count else None
        next_flags = list(comparison_flags)
        next_issues = list(draft.issues)
        if baseline_draft and baseline_draft.type != draft.type:
            next_flags.append("type_mismatch")
        merged.append(
            draft.model_copy(
                update={
                    "segment_source": "ai_full+rule",
                    "comparison_flags": next_flags,
                    "issues": next_issues,
                    "boundary_confidence": ImportConfidence.MEDIUM if next_flags else draft.boundary_confidence,
                }
            )
        )

    # When AI returns fewer questions than the rule-based baseline (e.g. input
    # truncation or token limits), fall back to the baseline drafts for the
    # remaining questions so they aren't silently lost.
    for index in range(len(ai_drafts), baseline_count):
        fallback = baseline[index]
        merged.append(
            fallback.model_copy(
                update={
                    "segment_source": "rule",
                    "comparison_flags": ["ai_missed"],
                }
            )
        )

    return merged


async def recognize_question_document_with_ai(
    payload: QuestionImportDocumentRecognizeRequest,
    baseline: list[QuestionImportDraft],
) -> list[QuestionImportDraft]:
    prompt = _build_document_ai_prompt(
        payload.raw_text,
        payload.images,
        import_context=payload.import_context,
        recognition_prompt=payload.recognition_prompt,
    )
    if _is_paper_import_context(payload) and payload.images:
        last_error: Exception | None = None
        for provider_name, api_key, base_url, model_name in (
            ("DeepSeek", settings.deepseek_api_key, settings.deepseek_base_url, settings.deepseek_model_name),
            ("Qwen", settings.qwen_api_key, settings.qwen_base_url, settings.qwen_vl_model_name),
        ):
            try:
                data = await _request_vision_json(
                    provider_name=provider_name,
                    api_key=api_key,
                    base_url=base_url,
                    model_name=model_name,
                    prompt=prompt,
                    images=payload.images,
                )
                break
            except (RuntimeError, httpx.HTTPError, json.JSONDecodeError) as exc:
                last_error = exc
        else:
            raise RuntimeError("试卷视觉识别服务暂不可用，请联系管理员处理。") from last_error
    else:
        data = await _request_deepseek_json(prompt)
    questions = _validate_ai_document_questions(data)
    ai_drafts = [_build_ai_import_draft(question, payload.images) for question in questions]
    # 试卷导入场景下 AI 是权威（已被告知跳过封面/答题卡/得分栏）。它找不到题目即
    # 文档确实没有真题，不要回退到由答题卡编号臆造出的规则草稿。
    if _is_paper_import_context(payload) and not ai_drafts:
        return []
    return merge_ai_and_rule_recognition(ai_drafts, baseline)


def _draft_dedup_key(draft: QuestionImportDraft) -> str:
    """Build a dedup key from normalized content_text + sorted options + answer.

    Including the answer prevents collapsing questions that share an identical
    stem and option set but legitimately have different correct answers (e.g.
    K-type stem reused with shuffled options or twin questions in case series).
    """
    text = " ".join(draft.content_text.split()).strip().lower()
    answer = " ".join((draft.answer_text or "").split()).strip().lower()
    if draft.options:
        opts = "|".join(f"{k}={' '.join(v.split()).strip().lower()}" for k, v in sorted(draft.options.items()))
        return f"{text}||{opts}||{answer}"
    return f"{text}||{answer}"


def deduplicate_drafts(
    drafts: list[QuestionImportDraft],
) -> tuple[list[QuestionImportDraft], int]:
    """Remove duplicate drafts based on content_text + options. Returns (unique_drafts, removed_count)."""
    seen: set[str] = set()
    unique: list[QuestionImportDraft] = []
    for draft in drafts:
        key = _draft_dedup_key(draft)
        if key in seen:
            continue
        seen.add(key)
        unique.append(draft)
    return unique, len(drafts) - len(unique)


def build_import_document_summary(
    drafts: list[QuestionImportDraft],
    duplicates_removed: int = 0,
    visual_retry_recommended: bool = False,
    incomplete_choice_count: int | None = None,
) -> QuestionImportDocumentSummary:
    if incomplete_choice_count is None:
        incomplete_choice_count = sum(
            1
            for draft in drafts
            if draft.type.value == "choice" and "选择题选项不完整" in draft.issues
        )
    return QuestionImportDocumentSummary(
        total=len(drafts),
        duplicates_removed=duplicates_removed,
        high_confidence=sum(
            1
            for draft in drafts
            if draft.type_confidence.value == "high" and draft.boundary_confidence.value == "high"
        ),
        medium_confidence=sum(
            1
            for draft in drafts
            if "medium" in {draft.type_confidence.value, draft.boundary_confidence.value}
        ),
        low_confidence=sum(
            1
            for draft in drafts
            if "low" in {draft.type_confidence.value, draft.boundary_confidence.value}
        ),
        issue_count=sum(1 for draft in drafts if draft.issues),
        pending_review=sum(1 for draft in drafts if draft.review_status == ImportReviewStatus.PENDING),
        approved=sum(1 for draft in drafts if draft.review_status == ImportReviewStatus.APPROVED),
        skipped=sum(1 for draft in drafts if draft.review_status == ImportReviewStatus.SKIPPED),
        incomplete_choice_count=incomplete_choice_count,
        visual_retry_recommended=visual_retry_recommended,
    )


_DEEPSEEK_DOC_PROMPT_TEMPLATE = """以下文本已用 `[Q]` 标记分隔每道题目。请逐题输出一行紧凑 JSON（JSONL；不要数组包裹，不要 markdown 围栏，不要说明文字）：
{{"t":"choice|true_false|fill_in|short_answer|essay|code","c":"...","o":{{"A":"","B":""}}|null,"a":"...","an":"...","d":1-5,"dl":"易|中|难","kps":["..."],"imgs":["..."]|[]}}

字段说明：
- t: 题型
- c: 题干。从 `[Q]` 之后到第一个选项（A. / A、/ A:）或解析段之前的所有字符，**完整原样保留**，不要删除任何字符。**不要输出 `[Q]` 标记本身**。文本中出现的 `[IMG:xxx.png]` 指该处有配图，保留在c字段中
- o: 选择题选项，键为 A/B/C/D/E，值为不含字母前缀的纯文本；非选择题为 null
- a: 答案。选择题填字母（如 "A" 或 "ABC"），其他题型填答案文本
- an: 解析。原文出现"解析"/"分析"/"答案解析"/"参考解析"/"详解"等段落，必须完整提取到该字段；题目后跟随的 "●A:" "•B:" 等逐项点评也并入该字段。没有解析填空字符串
- d: 难度（1-5 的整数）。按题目原文标注的难度文字折算：易=2、中=3、难=4；标注更细时（很容易=1、较易=2、中等=3、较难=4、很难=5）按细档折算；原文没有标注难度时给 3
- dl: 题目原文标注的难度文字，**原样抄录**（如 "易"、"中"、"难"）；原文没有标注填空字符串
- kps: 题目原文标注的知识点名称数组，**原样抄录**（如 ["人工智能信息技术基础"]）；原文没有标注时按题目内容概括 1-2 个，最多 3 个
- imgs: 该题所配图片的文件名数组。从题干中出现的 [IMG:xxx] 标记提取 xxx 填入（如 ["a1b2c3.png"]）。题干无标记则为空数组 []

规则：
- 每个 `[Q]` 块对应一道题，独立输出一行 JSON
- 行间不要空行、不要逗号、不要数组括号
- 不要省略、概括或改写任何字段内容
- 答案行里常见的 "知识点：xxx"、"难度层次：易" 属于题目元数据，分别写入 kps / dl / d，不要混进 c 或 a
{extra_rules}

文本：
{text}"""


_QUESTION_NUMBER_PREFIX_RE = re.compile(
    r"^\s*(?:第\s*\d+\s*题\s*[:：.、]?\s*|题\s*\d+\s*[:：.、]?\s*|\d+\s*[.、]\s*|[(（]\s*\d+\s*[)）]\s*)",
)

_QUESTION_NUMBER_BOUNDARY_RE = re.compile(
    r"(?m)^\s*(?:第\s*\d+\s*题\s*[:：.、]?|题\s*\d+\s*[:：.、]?|\d+\s*[.、]|[(（]\s*\d+\s*[)）])\s*",
)

# 标准模板文档的题号写在「题目内容：18. …」这一行里面，行首是字段名而不是数字，
# 上面的题号正则一首都匹配不到。分块若仍按字符硬切，就会把题目拦腰切断，同时
# 让「返回题数不足就拆半重试」的完整性校验（它数的是 [Q] 标记）完全失效，题目
# 被静默丢掉。所以模板字段头也必须算作题目边界。
_TEMPLATE_BLOCK_START_RE = re.compile(r"(?m)^\s*(?:\[题型\]|题型[:：])")

# 分块专用边界 = 题号形式 ∪ 模板字段头。注意 `_normalize_question_boundaries`
# 仍然只替换题号：模板字段头要原样留给模型，「选择题」这类题型词是模型判断题型
# 的依据，替换掉就丢了信息。
_DOC_QUESTION_BOUNDARY_RE = re.compile(
    r"(?m)^\s*(?:第\s*\d+\s*题\s*[:：.、]?|题\s*\d+\s*[:：.、]?|\d+\s*[.、]|"
    r"[(（]\s*\d+\s*[)）]|\[题型\]|题型[:：])\s*",
)


def _strip_question_number_prefix(text: str) -> str:
    """Remove leading '第 N 题：' / '1.' / '(1)' style prefix from a question stem."""
    return _QUESTION_NUMBER_PREFIX_RE.sub("", text, count=1).lstrip()


def _normalize_question_boundaries(text: str) -> str:
    """Replace Chinese question-number prefixes with an unambiguous English marker.

    Without this, DeepSeek conflates the leading number of the next question
    (e.g. "26" in "第 1 题：26 岁初产妇") with the question label and silently
    drops it. Replacing the label up front removes that failure mode entirely.
    """
    return _QUESTION_NUMBER_BOUNDARY_RE.sub("\n[Q]\n", text)


_COMPACT_KEY_MAP = {
    "n": "question_number",
    "t": "type",
    "c": "content_text",
    "o": "options",
    "a": "answer_text",
    "an": "analysis",
    "d": "difficulty",
    "dl": "difficulty_label",
    "kps": "knowledge_points",
    "imgs": "images",
}


def _parse_doc_recognition_jsonl(content: str) -> list[dict]:
    """Parse the model's JSONL output and expand compact keys back to full names."""
    questions: list[dict] = []
    for line in content.splitlines():
        line = line.strip().rstrip(",")
        if not line or line in ("[", "]", "{", "}"):
            continue
        if line.startswith("```"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        expanded = {_COMPACT_KEY_MAP.get(k, k): v for k, v in obj.items()}
        expanded.setdefault("difficulty", 3)
        expanded.setdefault("analysis", "")
        content_text = expanded.get("content_text")
        if isinstance(content_text, str):
            expanded["content_text"] = _strip_question_number_prefix(content_text)
        questions.append(expanded)
    return questions


_DOC_RECOGNITION_CHUNK_SIZE = 6000
_DOC_RECOGNITION_CONCURRENCY = 50
# 分块返回题数低于 [Q] 标记数时判定为漏题并拆分重试（1.0 = 少一题也要补）。
_DOC_RECOGNITION_MIN_COMPLETENESS = 1.0
_DOC_RECOGNITION_SPLIT_MIN_QUESTIONS = 4
_DOC_RECOGNITION_SPLIT_MAX_DEPTH = 3


def _split_text_at_question_boundaries(full_text: str, chunk_size: int = _DOC_RECOGNITION_CHUNK_SIZE) -> list[str]:
    """Pack the document into chunks that always end on a question boundary.

    Boundary detection uses the same regex that the prompt-side normalizer uses
    (`第 N 题：`, `1.`, `(1)`, etc.) plus the standard-template field header
    (`[题型]` / `题型：`). Splitting only at boundaries guarantees that no
    question is cut in half, which was the main source of missing questions in
    the previous page/paragraph-packed chunker.
    """
    boundaries = [m.start() for m in _DOC_QUESTION_BOUNDARY_RE.finditer(full_text)]
    if len(boundaries) < 2:
        # No detectable structure — fall back to size splitting. Cuts are snapped
        # back to the previous line break so a chunk never starts mid-line.
        chunks: list[str] = []
        start = 0
        while start < len(full_text):
            end = min(start + chunk_size, len(full_text))
            if end < len(full_text):
                line_break = full_text.rfind("\n", start, end)
                if line_break > start:
                    end = line_break
            chunks.append(full_text[start:end])
            start = end
        return [chunk for chunk in chunks if chunk.strip()] or [full_text]

    boundaries.append(len(full_text))  # sentinel for the tail block
    chunks: list[str] = []
    chunk_start = boundaries[0]
    last_emitted_end = boundaries[0]
    for next_boundary in boundaries[1:]:
        if next_boundary - chunk_start > chunk_size and last_emitted_end > chunk_start:
            chunks.append(full_text[chunk_start:last_emitted_end])
            chunk_start = last_emitted_end
        last_emitted_end = next_boundary
    if last_emitted_end > chunk_start:
        chunks.append(full_text[chunk_start:last_emitted_end])
    return [c for c in chunks if c.strip()]


_MAX_EXTRACTED_IMAGES = 300
_IMG_UPLOAD_DIR = Path(__file__).resolve().parents[3] / "uploads"
_UPLOAD_URL_PREFIX = "/api/uploads/files/"
# 扫描件/图片版 PDF 的文本层通常是空的，只能整页渲染后交给视觉模型识别。
_PDF_VISUAL_MIN_TEXT_CHARS = 50
_PDF_VISUAL_RENDER_RESOLUTION = 110
_PDF_VISUAL_MAX_EDGE_PX = 2000
# 一页约 6 题；3 页一批（约 1000 输出 token）留足余量，输出被截断时再二分。
_PDF_VISUAL_BATCH_PAGES = 3
_PDF_VISUAL_SPLIT_MAX_DEPTH = 3
_PDF_VISUAL_MAX_PAGES = 60
_PDF_VISUAL_CONCURRENCY = 3
_IMAGE_MARKER_RE = re.compile(r"\[(?:IMG|IMAGE):[^\]]+\]")


def _pdf_text_without_image_markers(text: str) -> str:
    """去掉图片占位符后的 PDF 文本，用于判断是否存在可读文本层。"""
    return _IMAGE_MARKER_RE.sub(" ", text).strip()


def _render_pdf_pages_to_images(file_bytes: bytes) -> list[QuestionImportImageInput]:
    """Rasterize PDF pages for visual recognition.

    Scanned/photographed papers have no text layer, and their embedded images
    are not always decodable as standalone images (JBIG2/CCITT and inline
    images). Rendering the page itself always yields something the vision model
    can read. Individual page failures are skipped instead of failing the file.
    """
    import io
    import pdfplumber

    images: list[QuestionImportImageInput] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page_number, page in enumerate(pdf.pages[:_PDF_VISUAL_MAX_PAGES], start=1):
            try:
                long_edge = max(page.width or 0, page.height or 0)
                resolution = _PDF_VISUAL_RENDER_RESOLUTION
                if long_edge > 0:
                    resolution = min(resolution, max(72, int(_PDF_VISUAL_MAX_EDGE_PX * 72 / long_edge)))
                rendered = page.to_image(resolution=resolution).original
                buffer = io.BytesIO()
                rendered.convert("RGB").save(buffer, format="JPEG", quality=80)
            except Exception:  # noqa: BLE001 - 单页渲染失败不应中断整份文件
                continue
            _filename, url = _save_image_bytes(buffer.getvalue(), "jpg")
            images.append(
                QuestionImportImageInput(
                    image_id=f"page-{page_number}",
                    url=url,
                    order=page_number,
                    page=page_number,
                    alt=f"第 {page_number} 页",
                )
            )
    return images


def _save_image_bytes(data: bytes, ext: str) -> tuple[str, str]:
    """Save image bytes to UPLOAD_DIR, return (filename, url)."""
    _IMG_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    (_IMG_UPLOAD_DIR / filename).write_bytes(data)
    return filename, f"{_UPLOAD_URL_PREFIX}{filename}"


def _extract_pdf_text_and_images(
    file_bytes: bytes,
) -> tuple[str, dict[str, str], int]:
    """Extract text + unique images from PDF.

    Returns (full_text, filename_to_url_map, total_images_found).
    Text contains `[IMG:filename]` markers inline where images appear.
    Images are deduplicated by content hash; same image on multiple pages is saved once.
    """
    import io
    import pdfplumber
    from PIL import Image

    filename_to_url: dict[str, str] = {}
    image_hash_to_filename: dict[str, str] = {}
    total_images = 0
    img_count = 0

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        page_texts: list[str] = []
        for page in pdf.pages:
            text = page.extract_text() or ""

            image_markers: list[str] = []
            for image in page.images:
                total_images += 1
                if img_count >= _MAX_EXTRACTED_IMAGES:
                    break

                stream = image.get("stream")
                if stream is None:
                    continue
                try:
                    data = stream.get_rawdata()
                except Exception:
                    try:
                        data = stream.get_data()
                    except Exception:
                        continue

                width, height = image.get("srcsize") or (image.get("width"), image.get("height"))
                if len(data) < 2000 or not width or not height or width < 100 or height < 100:
                    continue

                try:
                    image_file = Image.open(io.BytesIO(data))
                    image_file.verify()
                except Exception:
                    continue

                image_hash = hashlib.sha256(data).hexdigest()
                if image_hash not in image_hash_to_filename:
                    img_count += 1
                    ext = _guess_image_ext(data[:16])
                    filename, url = _save_image_bytes(data, ext)
                    image_hash_to_filename[image_hash] = filename
                    filename_to_url[filename] = url

                image_markers.append(f"[IMG:{image_hash_to_filename[image_hash]}]")

            if image_markers:
                text = " ".join(image_markers) + "\n" + text
            page_texts.append(text)

    return "\n".join(page_texts), filename_to_url, total_images


def _extract_docx_ordered_text(file_bytes: bytes) -> str:
    """Extract DOCX text with paragraphs and tables interleaved in document order.

    Used only as a position reference: recognition still runs on the flat
    extraction above (which the model handles best), and the recognized drafts
    are sorted back into this order afterwards.
    """
    import io
    from docx import Document
    from docx.table import Table as DocxTable
    from docx.text.paragraph import Paragraph as DocxParagraph

    document = Document(io.BytesIO(file_bytes))
    lines: list[str] = []
    for child in document.element.body.iterchildren():
        if child.tag.endswith("}tbl"):
            table = DocxTable(child, document)
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if cells:
                    lines.append(" | ".join(cells))
        elif child.tag.endswith("}p"):
            text = DocxParagraph(child, document).text.strip()
            if text:
                lines.append(text)
    return split_questions_glued_after_answers("\n".join(lines))


_ORDER_MATCH_MIN_CHARS = 6


def _order_match_key(text: str) -> str:
    """Normalize text for position matching (drop whitespace / common punctuation)."""
    return re.sub(r"[\s\u3000,，.。、;；:：!！?？\"'“”‘’()（）\[\]【】《》<>/\\|·\-—_]+", "", text)


def reorder_drafts_by_document_position(
    drafts: list[QuestionImportDraft],
    reference_text: str,
) -> list[QuestionImportDraft]:
    """Sort recognized drafts back into the document's original order.

    Tables are appended after the body paragraphs during extraction, so the
    model sees those questions at the end. Recognition order alone therefore
    does not match the source document; match each draft's stem against a
    document-order reference text and sort by the matched position. Drafts that
    cannot be located keep their previous relative position (appended last).
    """
    if len(drafts) < 2:
        return drafts
    haystack = _order_match_key(reference_text)
    if not haystack:
        return drafts

    matched: list[tuple[int, int, QuestionImportDraft]] = []
    last_position_by_prefix: dict[str, int] = {}
    for index, draft in enumerate(drafts):
        candidates = [draft.content_text, draft.raw_text, draft.title]
        position: int | None = None
        for candidate in candidates:
            key = _order_match_key(candidate or "")
            if len(key) < _ORDER_MATCH_MIN_CHARS:
                continue
            for length in (24, 16, 12, _ORDER_MATCH_MIN_CHARS):
                if len(key) < length:
                    continue
                prefix = key[:length]
                found = haystack.find(prefix, last_position_by_prefix.get(prefix, 0))
                if found != -1:
                    position = found
                    last_position_by_prefix[prefix] = found + 1
                    break
            if position is not None:
                break
        matched.append((position if position is not None else len(haystack) + index, index, draft))

    matched.sort(key=lambda item: (item[0], item[1]))
    return [draft for _, _, draft in matched]


def _extract_docx_text_and_images(
    file_bytes: bytes,
) -> tuple[str, dict[str, str], int]:
    """Extract text + images from DOCX.

    Returns (full_text, filename_to_url_map, total_images_found).
    Images are saved alongside `[IMG:filename]` inline markers.
    """
    import io
    from docx import Document
    from docx.opc.constants import RELATIONSHIP_TYPE as RT

    document = Document(io.BytesIO(file_bytes))
    filename_to_url: dict[str, str] = {}
    img_count = 0
    lines: list[str] = []

    # Collect image parts
    image_parts: dict[str, bytes] = {}
    for rel in document.part.rels.values():
        if "image" in rel.reltype:
            try:
                image_parts[rel.rId] = rel.target_part.blob
            except Exception:
                continue

    # Find all blip (image reference) elements scoped to each paragraph
    para_blips: dict[int, list[str]] = {}  # paragraph index → [rId, ...]
    for i, paragraph in enumerate(document.paragraphs):
        for blip in paragraph._element.findall(
            ".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip",
        ):
            rId = blip.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
            )
            if rId and rId in image_parts:
                para_blips.setdefault(i, []).append(rId)

    for i, paragraph in enumerate(document.paragraphs):
        text = paragraph.text.strip()

        image_markers: list[str] = []
        if i in para_blips:
            for rId in para_blips[i]:
                img_count += 1
                if img_count > _MAX_EXTRACTED_IMAGES:
                    break
                ext = _guess_image_ext(image_parts[rId][:16])
                filename, url = _save_image_bytes(image_parts[rId], ext)
                filename_to_url[filename] = url
                image_markers.append(f"[IMG:{filename}]")

        if image_markers:
            text = " ".join(image_markers) + ("\n" + text if text else "")
        if text:
            lines.append(text)

    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                lines.append(" | ".join(cells))

    return split_questions_glued_after_answers("\n".join(lines)), filename_to_url, img_count


def _inline_pdf_images(raw_text: str, image_urls: dict[str, str]) -> list[QuestionImportImageInput]:
    filenames = list(dict.fromkeys(re.findall(r"\[IMG:([^\]\s]+)\]", raw_text)))
    return [
        QuestionImportImageInput(image_id=filename, url=url, order=index + 1)
        for index, filename in enumerate(filenames)
        if (url := image_urls.get(filename))
    ]


def _looks_like_pdf_image_marker_line(line: str) -> bool:
    return bool(re.fullmatch(r"(?:\[IMG:[^\]\s]+\]\s*)+", line.strip()))


def _standard_paper_image_should_be_answer(
    draft: QuestionImportDraft,
    *,
    type_hint: str | None,
) -> bool:
    if not draft.images or draft.answer_text:
        return False
    hint = type_hint or ""
    if not re.search(r"(简答|问答|论述|分析)", hint):
        return False
    return draft.type.value in {"short_answer", "essay"}


def _build_standard_paper_drafts_from_text(
    full_text: str,
    image_urls: dict[str, str],
) -> list[QuestionImportDraft]:
    """Deterministically split common Chinese exam papers by section heading + question number."""
    prepared = preprocess_paper_import_text(full_text, [])
    lines = [line.strip() for line in prepared.splitlines() if line.strip()]
    drafts: list[QuestionImportDraft] = []
    current_type_hint: str | None = None
    current_question_type_hint: str | None = None
    current_lines: list[str] = []
    pending_image_lines: list[str] = []
    current_question_number = 0

    def flush() -> None:
        nonlocal current_lines, current_question_type_hint
        if not current_lines or not current_question_type_hint:
            current_lines = []
            current_question_type_hint = None
            return
        raw_text = "\n".join(current_lines).strip()
        if raw_text:
            draft = build_import_draft_from_segment(
                raw_text,
                segment_source="paper_rule",
                boundary_confidence="high",
                type_hint=current_question_type_hint,
                images=_inline_pdf_images(raw_text, image_urls),
            )
            if _standard_paper_image_should_be_answer(draft, type_hint=current_question_type_hint):
                draft = draft.model_copy(
                    update={
                        "images": [],
                        "answer_images": draft.images,
                        "issues": [issue for issue in draft.issues if issue != "未识别到答案"],
                    }
                )
            drafts.append(draft)
        current_lines = []
        current_question_type_hint = None

    for line in lines:
        if line.startswith("[试卷题型说明]"):
            section_hint = _extract_section_type_hint(line)
            if section_hint:
                flush()
                current_type_hint = section_hint
                current_question_number = 0
            continue

        if not current_type_hint:
            continue

        if _looks_like_pdf_image_marker_line(line):
            pending_image_lines.append(line)
            continue

        question_number_match = re.match(r"^(\d+)\s*[.．、]\s*", line)
        if question_number_match:
            question_number = int(question_number_match.group(1))
            starts_expected_question = question_number == current_question_number + 1
            if not starts_expected_question:
                if current_lines:
                    current_lines.append(line)
                continue
            flush()
            current_question_type_hint = current_type_hint
            current_question_number = question_number
            current_lines = [line, *pending_image_lines]
            pending_image_lines = []
            continue

        if current_lines:
            current_lines.append(line)

    flush()
    return drafts


def _guess_image_ext(header_bytes: bytes) -> str:
    if header_bytes[:4] == b"\x89PNG":
        return "png"
    if header_bytes[:2] == b"\xff\xd8":
        return "jpg"
    if header_bytes[:4] == b"GIF8":
        return "gif"
    if header_bytes[:4] == b"RIFF":
        return "webp"
    return "png"


async def _recognize_full_text_with_ai(
    full_text: str,
    image_urls: dict[str, str],
    file_name: str,
    source_format: str,
    empty_text_error: str,
    no_drafts_error: str,
    recognition_prompt: str | None = None,
) -> "QuestionImportDocumentRecognizeResponse":
    """Split the document at question boundaries, dispatch LLM calls in parallel, merge results.

    Boundary-aware chunking ensures no question gets cut in half between two
    chunks. Each chunk's per-call output cap is high enough to accommodate
    reasoning-model traces (e.g. DeepSeek reasoning models).

    Image URL map is passed through to draft building so LLM-referenced images
    get full URLs.
    """
    import pathlib

    if not full_text.strip():
        raise ValueError(empty_text_error)

    chunks = _split_text_at_question_boundaries(full_text)

    semaphore = asyncio.Semaphore(_DOC_RECOGNITION_CONCURRENCY)
    chunk_diag: list[dict] = []

    async def recognize_one(idx: int, chunk: str, depth: int = 0) -> list[QuestionImportDraft]:
        normalized = _normalize_question_boundaries(chunk)
        # 题号式的文档靠 [Q] 标记计数；标准模板文档没有 [Q]（字段头原样保留给
        # 模型），改数模板字段头。两者取大，任何一种排版都能触发漏题拆半重试。
        expected_questions = max(
            normalized.count("[Q]"),
            len(_TEMPLATE_BLOCK_START_RE.findall(chunk)),
        )
        extra_rules = ""
        if recognition_prompt and recognition_prompt.strip():
            extra_rules = f"\n用户补充识别要求：\n{recognition_prompt.strip()}"
        prompt = _DEEPSEEK_DOC_PROMPT_TEMPLATE.format(text=normalized, extra_rules=extra_rules)
        async with semaphore:
            last_error: Exception | None = None
            drafts: list[QuestionImportDraft] | None = None
            for _attempt in range(2):
                try:
                    questions = await _request_doc_recognition_questions(prompt)
                    validated = _validate_ai_document_questions({"questions": questions})
                    drafts = [_build_ai_import_draft_with_images(q, image_urls) for q in validated]
                    break
                except Exception as exc:
                    last_error = exc
            if drafts is None:
                chunk_diag.append(
                    {
                        "idx": idx,
                        "chars": len(chunk),
                        "questions": 0,
                        "status": f"error:{type(last_error).__name__}:{str(last_error)[:100]}",
                    }
                )
                return []

        # 完整度校验：模型偶尔对信息密集的分块只返回一部分题目（同一个分块
        # 可能这次返回 72 题、下次只返回 21 题）。发现明显少返回时按题目边界
        # 拆半重识别，宁可多花调用，也不静默丢题。
        if (
            depth < _DOC_RECOGNITION_SPLIT_MAX_DEPTH
            and expected_questions >= _DOC_RECOGNITION_SPLIT_MIN_QUESTIONS
            and len(drafts) < expected_questions * _DOC_RECOGNITION_MIN_COMPLETENESS
        ):
            sub_chunks = _split_text_at_question_boundaries(
                chunk, chunk_size=max(400, len(chunk) // 2)
            )
            if len(sub_chunks) > 1:
                chunk_diag.append(
                    {
                        "idx": idx,
                        "chars": len(chunk),
                        "questions": len(drafts),
                        "status": f"split:{len(drafts)}/{expected_questions}",
                    }
                )
                split_results = await asyncio.gather(
                    *(recognize_one(idx, sub_chunk, depth + 1) for sub_chunk in sub_chunks)
                )
                return [draft for part in split_results for draft in part]

        chunk_diag.append(
            {"idx": idx, "chars": len(chunk), "questions": len(drafts), "status": "ok" if depth == 0 else "ok:split"}
        )
        return drafts

    chunk_results = await asyncio.gather(
        *(recognize_one(i, chunk) for i, chunk in enumerate(chunks))
    )
    all_drafts: list[QuestionImportDraft] = [
        draft for chunk_drafts in chunk_results for draft in chunk_drafts
    ]

    if not all_drafts:
        failed_chunks = [diag for diag in chunk_diag if str(diag["status"]).startswith("error")]
        succeeded_chunks = [diag for diag in chunk_diag if str(diag["status"]).startswith("ok")]
        if failed_chunks and not succeeded_chunks:
            # 所有分块都调用失败（如密钥缺失/服务不可用）：必须报服务错误，
            # 否则会被当成“文档里没有题目”，试卷导入也失去回退到规则解析的机会。
            raise RuntimeError(f"AI 题目识别失败：{failed_chunks[0]['status']}")
        raise RuntimeError(no_drafts_error)

    unique_drafts, duplicates_removed = deduplicate_drafts(all_drafts)

    _debug_dir = pathlib.Path("/tmp/question_import_debug")
    _debug_dir.mkdir(parents=True, exist_ok=True)
    _debug_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    _debug_path = _debug_dir / f"{source_format}_recognize_{_debug_ts}.json"
    _debug_path.write_text(
        json.dumps(
            {
                "file_name": file_name,
                "source_format": source_format,
                "total_chars": len(full_text),
                "chunks_count": len(chunks),
                "images_found": len(image_urls),
                "drafts_before_dedup": len(all_drafts),
                "duplicates_removed": duplicates_removed,
                "drafts_count": len(unique_drafts),
                "chunk_diagnostics": sorted(chunk_diag, key=lambda d: d["idx"]),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    summary = build_import_document_summary(unique_drafts, duplicates_removed)
    return QuestionImportDocumentRecognizeResponse(
        mode=ImportRecognitionMode.SMART,
        summary=summary,
        drafts=unique_drafts,
    )


async def _recognize_paper_document_with_ai(
    payload: QuestionImportDocumentRecognizeRequest,
) -> list[QuestionImportDraft]:
    """Recognize a whole text paper through the shared chunked JSONL pipeline.

    Sending the entire paper in one LLM call truncates the output for large
    papers (a 250-question paper came back with ~11 questions). Paper imports
    therefore reuse the exact same pipeline as the question-bank import;
    paper-specific handling stays outside the model prompt (deterministic
    ``preprocess_paper_import_text`` trimming + rule-based fallback).
    """
    image_urls = {image.image_id: image.url for image in payload.images}
    response = await _recognize_full_text_with_ai(
        full_text=payload.raw_text,
        image_urls=image_urls,
        file_name=payload.file_name,
        source_format=payload.source_format,
        empty_text_error="文件中未提取到题目文本",
        no_drafts_error="AI 未能从试卷中识别出任何题目，请检查文件内容",
        recognition_prompt=payload.recognition_prompt,
    )
    return response.drafts


_VISION_JSONL_PROMPT_TEMPLATE = """下面是试卷页面的图像（共 {page_count} 页）。请从上到下、从左到右识别图像中的**所有**题目，每题输出一行紧凑 JSON（JSONL；不要数组包裹，不要 markdown 围栏，不要说明文字）：
{{"n":题号,"t":"choice|true_false|fill_in|short_answer|essay|code","c":"...","o":{{"A":"","B":""}}|null,"a":"...","an":"...","d":1-5,"dl":"易|中|难","kps":["..."],"imgs":[]}}

字段说明：
- n: 题目在图像上印刷的题号（整数，按原样抄录；没有题号给 null）。题号必须连续，不能跳号
- t: 题型。单选/多选都是 choice；判断题 true_false；填空 fill_in；简答 short_answer；论述 essay；编程 code
- c: 题干。完整抄录（保留括号空位），不要包含选项、答案、知识点、难度、题型标题
- o: 选择题选项，键为 A/B/C/D/E，值为不含字母前缀的纯文本；非选择题为 null
- a: 答案。选择题填字母（多选题如 "ABC"），判断题填 "正确"/"错误"，其他题型填答案文本；图像里没有答案就填空字符串
- an: 解析。没有填空字符串
- d: 难度（1-5 的整数）。按题目原文标注的难度文字折算：易=2、中=3、难=4；标注更细时（很容易=1、较易=2、中等=3、较难=4、很难=5）按细档折算；没有标注给 3
- dl: 题目原文标注的难度文字，**原样抄录**（如 "易"、"中"、"难"）；没有标注填空字符串
- kps: 题目原文标注的知识点名称数组，**原样抄录**（如 ["人工智能信息技术基础"]）；原文没有标注时按题目内容概括 1-2 个，最多 3 个
- imgs: 题干依赖的图表所在页面的 image_id 数组；纯文字题给 []

规则：
- 每道题一行 JSON，行间不要空行、不要逗号、不要数组括号
- **逐题核对图像上的题号，从第一题到最后一题不得遗漏、不得跳号**；不要合并相邻题目，不要臆造原文没有的题目
- 题干带（ ）且图像中印有 A/B/C/D 选项的，一律按 choice 输出，并**把该题所有选项完整抄录**（不能只给 A）；只有确实没有选项的填空才用 fill_in
- 页眉、页脚、页码、题型标题（如 "一、单选题(共100题)"）、得分栏、答题卡不是题目
- c / a / an / kps / dl 必须忠实于原文，不要改写或翻译
{extra_rules}

本批图像 image_id：{page_ids}"""

_VISION_MAX_TOKENS = 8192
_VISION_ATTEMPTS = 2


def _build_vision_jsonl_prompt(
    page_images: list[QuestionImportImageInput],
    recognition_prompt: str | None = None,
) -> str:
    extra_rules = ""
    if recognition_prompt and recognition_prompt.strip():
        extra_rules = f"\n用户补充识别要求：\n{recognition_prompt.strip()}"
    return _VISION_JSONL_PROMPT_TEMPLATE.format(
        page_count=len(page_images),
        page_ids=", ".join(image.image_id for image in page_images),
        extra_rules=extra_rules,
    )


async def _request_vision_jsonl(
    *,
    images: list[QuestionImportImageInput],
    prompt: str,
) -> tuple[list[dict], str]:
    """Vision JSONL call: returns (parsed questions, finish_reason).

    Qwen-VL is the dedicated vision model here and its ``max_tokens`` cap is
    8192, so batches must stay small; ``finish_reason == "length"`` tells the
    caller the output was truncated and must be split.
    """
    providers = (
        ("Qwen", settings.qwen_api_key, settings.qwen_base_url, settings.qwen_vl_model_name),
        ("DeepSeek", settings.deepseek_api_key, settings.deepseek_base_url, settings.deepseek_model_name),
    )
    last_exc: Exception | None = None
    for provider_name, api_key, base_url, model_name in providers:
        if not api_key:
            continue
        try:
            content, finish_reason = await _request_openai_compatible_vision_text(
                provider_name=provider_name,
                api_key=api_key,
                base_url=base_url,
                model_name=model_name,
                prompt=prompt,
                images=images,
                max_tokens=_VISION_MAX_TOKENS,
            )
            return _parse_doc_recognition_jsonl(content), finish_reason
        except Exception as exc:  # noqa: BLE001 - 逐个 provider 回退
            last_exc = exc
            continue
    if last_exc is None:
        raise RuntimeError("未配置任何 AI 识别服务的 API Key")
    raise RuntimeError("试卷视觉识别服务暂不可用，请联系管理员处理。") from last_exc


async def _recognize_vision_batch(
    page_images: list[QuestionImportImageInput],
    *,
    recognition_prompt: str | None = None,
    depth: int = 0,
) -> list[QuestionImportDraft]:
    """Recognize one batch of rendered pages, retrying when the result is incomplete.

    Two failure modes silently drop questions: the output is cut off by
    ``max_tokens`` (``finish_reason == "length"``) and the model skips questions
    (detected from gaps in the printed question numbers). In both cases the
    batch is halved and re-recognized; a single page gets one plain retry.
    """
    image_urls = {image.image_id: image.url for image in page_images}
    prompt = _build_vision_jsonl_prompt(page_images, recognition_prompt)
    best: list[QuestionImportDraft] = []
    for _attempt in range(_VISION_ATTEMPTS):
        questions, finish_reason = await _request_vision_jsonl(images=page_images, prompt=prompt)
        validated = _validate_ai_document_questions({"questions": questions})
        drafts = [_build_ai_import_draft_with_images(question, image_urls) for question in validated]
        if not best or _vision_result_score(drafts) > _vision_result_score(best):
            best = drafts
        incomplete = (
            finish_reason == "length"
            or _missing_question_number_count(drafts) > 0
            or _incomplete_choice_count(drafts) > 0
        )
        if not incomplete:
            return drafts
        if len(page_images) > 1 and depth < _PDF_VISUAL_SPLIT_MAX_DEPTH:
            break
    if len(page_images) > 1 and depth < _PDF_VISUAL_SPLIT_MAX_DEPTH:
        middle = len(page_images) // 2
        halves = await asyncio.gather(
            _recognize_vision_batch(page_images[:middle], recognition_prompt=recognition_prompt, depth=depth + 1),
            _recognize_vision_batch(page_images[middle:], recognition_prompt=recognition_prompt, depth=depth + 1),
        )
        return [draft for half in halves for draft in half]
    return best


def _insert_drafts_before(
    drafts: list[QuestionImportDraft],
    additions: list[QuestionImportDraft],
    anchor: QuestionImportDraft,
) -> None:
    """把补识别到的题目按题号插入到 anchor 之前，保持原文顺序。"""
    ordered = sorted(additions, key=lambda draft: draft.question_number or 0)
    position = drafts.index(anchor) if anchor in drafts else len(drafts)
    drafts[position:position] = ordered


async def _repair_vision_batch_boundaries(
    batches: list[list[QuestionImportImageInput]],
    batch_results: list[list[QuestionImportDraft]],
    *,
    recognition_prompt: str | None,
    recognize_batch,
) -> None:
    """Repair question-number gaps that fall between two batches.

    Batches are recognized independently, so a question dropped at the end of
    one batch (or the start of the next) is invisible to per-batch checks. The
    printed question numbers still reveal the gap; re-recognize the two pages
    around that boundary and slot the missing questions back into place.
    """
    for index in range(len(batches) - 1):
        current_numbers = [draft.question_number for draft in batch_results[index] if draft.question_number is not None]
        following_numbers = [
            draft.question_number for draft in batch_results[index + 1] if draft.question_number is not None
        ]
        if not current_numbers or not following_numbers or following_numbers[0] <= current_numbers[-1] + 1:
            continue
        missing_numbers = range(current_numbers[-1] + 1, following_numbers[0])
        window: list[QuestionImportImageInput] = []
        for page in (*batches[index][-1:], *batches[index + 1][:1]):
            if page not in window:
                window.append(page)
        recovered = await recognize_batch(window)
        additions = [
            draft
            for draft in recovered
            if draft.question_number is not None and draft.question_number in missing_numbers
        ]
        if additions:
            _insert_drafts_before(batch_results[index + 1], additions, batch_results[index + 1][0])


async def _recognize_pdf_pages_with_ai(
    page_images: list[QuestionImportImageInput],
    *,
    file_name: str,
    recognition_prompt: str | None = None,
) -> "QuestionImportDocumentRecognizeResponse":
    """Recognize a scanned PDF from its rendered pages through the vision model.

    Pages are batched so a long scan does not overflow a single vision request
    (which would silently drop the tail questions); each batch is chunked with
    the compact JSONL prompt and split further when the model truncates or skips
    a question. Question-number gaps between neighbouring batches are repaired
    by re-recognizing the two pages around the boundary.
    """
    batches = [
        page_images[index : index + _PDF_VISUAL_BATCH_PAGES]
        for index in range(0, len(page_images), _PDF_VISUAL_BATCH_PAGES)
    ]
    semaphore = asyncio.Semaphore(_PDF_VISUAL_CONCURRENCY)

    async def recognize_batch(batch: list[QuestionImportImageInput]) -> list[QuestionImportDraft]:
        async with semaphore:
            return await _recognize_vision_batch(batch, recognition_prompt=recognition_prompt)

    batch_results = list(await asyncio.gather(*(recognize_batch(batch) for batch in batches)))
    await _repair_vision_batch_boundaries(
        batches,
        batch_results,
        recognition_prompt=recognition_prompt,
        recognize_batch=recognize_batch,
    )
    drafts = [draft for batch_drafts in batch_results for draft in batch_drafts]
    unique_drafts, duplicates_removed = deduplicate_drafts(drafts)
    return QuestionImportDocumentRecognizeResponse(
        mode=ImportRecognitionMode.VISUAL,
        summary=build_import_document_summary(
            unique_drafts,
            duplicates_removed,
            visual_retry_recommended=True,
        ),
        drafts=unique_drafts,
    )


async def recognize_pdf_with_ai(
    file_bytes: bytes,
    file_name: str,
    recognition_prompt: str | None = None,
) -> "QuestionImportDocumentRecognizeResponse":
    """Extract text + images from PDF, split at question boundaries, call AI in parallel.

    Text contains inline `[IMG:filename]` markers that the LLM will reference
    in its JSONL output, producing per-question image lists with resolved URLs.
    Scanned/image-only PDFs have no usable text layer; those pages are rendered
    and recognized by the vision model instead of failing the import.
    """
    full_text, image_urls, img_count = await asyncio.to_thread(_extract_pdf_text_and_images, file_bytes)
    deterministic_drafts = _build_standard_paper_drafts_from_text(full_text, image_urls)
    if deterministic_drafts:
        summary = build_import_document_summary(
            deterministic_drafts,
            duplicates_removed=0,
            visual_retry_recommended=img_count > 0,
        )
        return QuestionImportDocumentRecognizeResponse(
            mode=ImportRecognitionMode.SMART,
            summary=summary,
            drafts=deterministic_drafts,
        )
    if len(_pdf_text_without_image_markers(full_text)) < _PDF_VISUAL_MIN_TEXT_CHARS:
        page_images = await asyncio.to_thread(_render_pdf_pages_to_images, file_bytes)
        if page_images:
            return await _recognize_pdf_pages_with_ai(
                page_images,
                file_name=file_name,
                recognition_prompt=recognition_prompt,
            )
    result = await _recognize_full_text_with_ai(
        full_text=full_text,
        image_urls=image_urls,
        file_name=file_name,
        source_format="pdf",
        empty_text_error="PDF 文件中未提取到文本内容",
        no_drafts_error="AI 未能从 PDF 中识别出任何题目，请检查文件内容",
        recognition_prompt=recognition_prompt,
    )
    # Inject image count into summary for diagnostics
    result.summary = result.summary.model_copy(update={"visual_retry_recommended": img_count > 0})
    return result


async def recognize_docx_with_ai(
    file_bytes: bytes,
    file_name: str,
    *,
    import_context: str | None = None,
    recognition_prompt: str | None = None,
) -> "QuestionImportDocumentRecognizeResponse":
    """Extract text + images from DOCX, split at question boundaries, call AI in parallel.

    This is the single DOCX recognition entry point shared by the question-bank
    import and the paper import, so both pages see identical recognition
    behaviour. Paper imports only add deterministic pre-cleaning (cover /
    answer-sheet trimming) and never a different model prompt.
    """
    full_text, image_urls, img_count = await asyncio.to_thread(_extract_docx_text_and_images, file_bytes)
    if import_context == "paper":
        full_text = preprocess_paper_import_text(full_text, [])
    result = await _recognize_full_text_with_ai(
        full_text=full_text,
        image_urls=image_urls,
        file_name=file_name,
        source_format="docx",
        empty_text_error="DOCX 文件中未提取到文本内容",
        no_drafts_error="AI 未能从 DOCX 中识别出任何题目，请检查文件内容",
        recognition_prompt=recognition_prompt,
    )

    # 提取时表格内容排在正文之后，识别顺序因此会和原卷不一致；识别完成后按
    # 文档顺序参考文本把草稿排回原位（不影响识别本身，避免丢题）。
    ordered_reference = await asyncio.to_thread(_extract_docx_ordered_text, file_bytes)
    if import_context == "paper":
        ordered_reference = preprocess_paper_import_text(ordered_reference, [])
    result.drafts = reorder_drafts_by_document_position(result.drafts, ordered_reference)

    result.summary = result.summary.model_copy(update={"visual_retry_recommended": img_count > 0})
    return result


def _prepare_rule_based_drafts(
    payload: QuestionImportDocumentRecognizeRequest,
) -> tuple[QuestionImportDocumentRecognizeRequest, str, list[QuestionImportDraft]]:
    raw_text = _decode_import_html_entities(payload.raw_text)
    if _is_paper_import_context(payload):
        raw_text = preprocess_paper_import_text(raw_text, payload.tables)
    payload = payload.model_copy(update={"raw_text": raw_text})
    mode = (
        ImportRecognitionMode.TEMPLATE.value
        if payload.prefer_template
        else detect_import_template_mode(payload.raw_text)
    )
    return payload, mode, _build_rule_based_drafts(payload, mode)


def recognize_document_rule_based(
    payload: QuestionImportDocumentRecognizeRequest,
) -> QuestionImportDocumentRecognizeResponse:
    """Rule-only recognition (no AI calls), used as the outage fallback for papers."""
    _, mode, drafts = _prepare_rule_based_drafts(payload)
    unique_drafts, duplicates_removed = deduplicate_drafts(drafts)
    return QuestionImportDocumentRecognizeResponse(
        mode=mode,  # type: ignore[arg-type]
        summary=build_import_document_summary(unique_drafts, duplicates_removed),
        drafts=unique_drafts,
    )


def _strip_json_fences(content: str) -> str:
    payload = content.strip()
    if "```" in payload:
        start = payload.find("```")
        end = payload.rfind("```")
        if start != -1 and end != -1 and end > start:
            payload = payload[start + 3 : end].strip()
            if payload.startswith("json"):
                payload = payload[4:].strip()
    return payload


async def _request_openai_compatible_text(
    *,
    provider_name: str,
    api_key: str | None,
    base_url: str,
    model_name: str,
    prompt: str,
    system_prompt: str,
    max_tokens: int,
    timeout: float,
) -> str:
    """OpenAI-compatible chat-completion call returning raw content string."""
    if not api_key:
        raise RuntimeError(f"未配置 {provider_name} API Key")

    client = _get_http_client()
    response = await client.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt.strip()},
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens,
        },
        timeout=timeout,
    )

    if response.status_code >= 400:
        raise RuntimeError(response.text.strip() or f"{provider_name} 分析失败")

    content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError(f"{provider_name} 没有返回分析结果")
    return content


async def _request_openai_compatible_vision_text(
    *,
    provider_name: str,
    api_key: str | None,
    base_url: str,
    model_name: str,
    prompt: str,
    images: list[QuestionImportImageInput],
    max_tokens: int,
) -> tuple[str, str]:
    """Vision chat-completion call returning (raw content, finish_reason)."""
    if not api_key:
        raise RuntimeError(f"未配置 {provider_name} API Key")

    content: list[dict[str, Any]] = [{"type": "text", "text": prompt.strip()}]
    for image in images:
        content.append({"type": "image_url", "image_url": {"url": _ensure_image_data_url(image.url)}})

    client = _get_http_client()
    response = await client.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model_name,
            "messages": [
                {"role": "system", "content": "你只输出 JSONL，每行一个紧凑 JSON 对象，不要数组包裹，不要 markdown 围栏。"},
                {"role": "user", "content": content},
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens,
        },
        timeout=300.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(response.text.strip() or f"{provider_name} 视觉识别失败")
    choice = response.json().get("choices", [{}])[0]
    raw_content = choice.get("message", {}).get("content", "")
    if not isinstance(raw_content, str) or not raw_content.strip():
        raise RuntimeError(f"{provider_name} 没有返回识别结果")
    finish_reason = choice.get("finish_reason") or ""
    return raw_content, str(finish_reason)


async def _request_openai_compatible_json_large(
    *,
    provider_name: str,
    api_key: str | None,
    base_url: str,
    model_name: str,
    prompt: str,
) -> dict:
    """OpenAI-compatible chat-completion call that returns parsed JSON. Used by callers expecting a top-level JSON object."""
    content = await _request_openai_compatible_text(
        provider_name=provider_name,
        api_key=api_key,
        base_url=base_url,
        model_name=model_name,
        prompt=prompt,
        system_prompt="你只输出合法 JSON。不要输出任何其他内容。",
        max_tokens=6000,
        timeout=120.0,
    )
    return json.loads(_strip_json_fences(content))


async def _request_openai_compatible_jsonl(
    *,
    provider_name: str,
    api_key: str | None,
    base_url: str,
    model_name: str,
    prompt: str,
) -> list[dict]:
    """OpenAI-compatible chat-completion call returning parsed JSONL (one JSON object per line).

    max_tokens=16000 leaves headroom for reasoning models (e.g. DeepSeek reasoning models)
    that consume thousands of tokens in `reasoning_content` before the final answer.
    """
    content = await _request_openai_compatible_text(
        provider_name=provider_name,
        api_key=api_key,
        base_url=base_url,
        model_name=model_name,
        prompt=prompt,
        system_prompt="你只输出 JSONL，每行一个紧凑 JSON 对象，不要数组包裹，不要 markdown 围栏。",
        max_tokens=16000,
        timeout=180.0,
    )
    return _parse_doc_recognition_jsonl(content)


async def _request_deepseek_json_large(prompt: str) -> dict:
    return await _request_openai_compatible_json_large(
        provider_name="DeepSeek",
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        model_name=settings.deepseek_model_name,
        prompt=prompt,
    )


async def _request_qwen_json_large(prompt: str) -> dict:
    return await _request_openai_compatible_json_large(
        provider_name="Qwen",
        api_key=settings.qwen_api_key,
        base_url=settings.qwen_base_url,
        model_name=settings.qwen_model_name,
        prompt=prompt,
    )


async def _request_doc_recognition_json(prompt: str) -> dict:
    """Try DeepSeek first (fastest in benchmark for this prompt size), fall back to Qwen on failure."""
    providers = (
        ("DeepSeek", _request_deepseek_json_large, bool(settings.deepseek_api_key)),
        ("Qwen", _request_qwen_json_large, bool(settings.qwen_api_key)),
    )
    last_exc: Exception | None = None
    for name, fn, available in providers:
        if not available:
            continue
        try:
            return await fn(prompt)
        except Exception as exc:
            last_exc = exc
            continue
    if last_exc is None:
        raise RuntimeError("未配置任何 AI 识别服务的 API Key")
    raise RuntimeError(f"AI 题目识别失败：{last_exc}") from last_exc


async def _request_doc_recognition_questions(prompt: str) -> list[dict]:
    """Compact JSONL recognition path: returns a list of question dicts directly.

    Halves output tokens vs the verbose `{"questions":[...]}` envelope, which is
    the wall-time bottleneck under concurrent DeepSeek load.
    """
    providers = (
        (
            "DeepSeek",
            settings.deepseek_api_key,
            settings.deepseek_base_url,
            settings.deepseek_model_name,
        ),
        (
            "Qwen",
            settings.qwen_api_key,
            settings.qwen_base_url,
            settings.qwen_model_name,
        ),
    )
    last_exc: Exception | None = None
    for name, api_key, base_url, model_name in providers:
        if not api_key:
            continue
        try:
            return await _request_openai_compatible_jsonl(
                provider_name=name,
                api_key=api_key,
                base_url=base_url,
                model_name=model_name,
                prompt=prompt,
            )
        except Exception as exc:
            last_exc = exc
            continue
    if last_exc is None:
        raise RuntimeError("未配置任何 AI 识别服务的 API Key")
    raise RuntimeError(f"AI 题目识别失败：{last_exc}") from last_exc


async def recognize_question_document(
    payload: QuestionImportDocumentRecognizeRequest,
) -> QuestionImportDocumentRecognizeResponse:
    payload, mode, drafts = _prepare_rule_based_drafts(payload)

    # 标准模板（题型/题目内容/答案/解析/难度）只要字段齐全，纯正则就能稳定还原
    # 题干、选项、答案和解析，因此直接短路返回，不调用大模型。题目导入（fast）
    # 与试卷导入（ai_full，见 papers.service.create_import_session_from_recognition）
    # 共用这里，所以两个入口都能省掉这次调用；用户在页面上手动点「AI 重新识别」
    # 时会带 force_ai，仍然走下面的智能识别。
    template_drafts = None if payload.force_ai else build_standard_template_drafts(payload)
    if template_drafts is not None:
        mode = ImportRecognitionMode.TEMPLATE.value
        completed = template_drafts
    elif payload.analysis_mode == QuestionImportAnalysisMode.AI_FULL:
        try:
            # 纯文本试卷走分块 JSONL 管线（整卷单次调用会截断大试卷的输出）；
            # 带页面图片的试卷仍走视觉识别分支。
            if _is_paper_import_context(payload) and not payload.images:
                completed = await _recognize_paper_document_with_ai(payload)
            else:
                completed = await recognize_question_document_with_ai(payload, drafts)
        except (RuntimeError, httpx.HTTPError) as exc:
            if _is_paper_import_context(payload) and payload.raw_text.strip() and _is_ai_service_unavailable_error(exc):
                completed = drafts
            else:
                raise
    else:
        completed = [await complete_import_draft_with_ai(draft) for draft in drafts]
    unique_drafts, duplicates_removed = deduplicate_drafts(completed)
    incomplete_choice_count = sum(
        1
        for draft in unique_drafts
        if draft.type.value == "choice" and "选择题选项不完整" in draft.issues
    )
    visual_retry_recommended = payload.source_format == "docx" and incomplete_choice_count >= 2

    # DEBUG: save recognition result to file for inspection
    import pathlib
    _debug_dir = pathlib.Path("/tmp/question_import_debug")
    _debug_dir.mkdir(parents=True, exist_ok=True)
    _debug_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    _debug_path = _debug_dir / f"recognize_{_debug_ts}.json"
    _debug_path.write_text(
        json.dumps(
            {
                "file_name": payload.file_name,
                "raw_text_length": len(payload.raw_text),
                "raw_text_preview": payload.raw_text[:2000],
                "images_count": len(payload.images),
                "mode": mode,
                "drafts_count": len(unique_drafts),
                "drafts": [d.model_dump(mode="json") for d in unique_drafts],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return QuestionImportDocumentRecognizeResponse(
        mode=mode,  # type: ignore[arg-type]
        summary=build_import_document_summary(
            unique_drafts,
            duplicates_removed,
            visual_retry_recommended=visual_retry_recommended,
            incomplete_choice_count=incomplete_choice_count,
        ),
        drafts=unique_drafts,
    )


async def recognize_imported_question(raw_text: str) -> QuestionImportRecognizeResponse:
    prompt = f"""识别题目为 JSON: {{"type":"choice|true_false|fill_in|short_answer|essay|code","content_text":"...","options":{{"A":"..."}}|null,"answer_text":"..."}}
填空题（fill_in）必须用 "_____"（至少 3 个下划线）替换掉原文中的答案文字，不要把答案原文留在题干中。
文本:
{raw_text}"""

    data = await _request_deepseek_json(prompt)
    raw_options = data.get("options")
    options = raw_options if isinstance(raw_options, dict) else None

    raw_type = str(data.get("type", "short_answer")).strip()
    safe_type = raw_type if raw_type in _VALID_QUESTION_TYPES else "short_answer"

    content_text = str(data.get("content_text", "")).strip()
    if safe_type == "fill_in" and content_text and not re.search(r"_{3,}|（\s*）|\(\s*\)|【\s*】", content_text):
        answer_text = str(data.get("answer_text", "")).strip()
        content_text = _insert_fill_in_blanks(content_text, answer_text)

    return QuestionImportRecognizeResponse(
        type=safe_type,  # type: ignore[arg-type]
        content_text=content_text,
        options={str(key): str(value).strip() for key, value in options.items()} if options else None,
        answer_text=str(data.get("answer_text", "")).strip() or None,
    )


def _normalize_question_signature_text(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip().lower()


def _question_duplicate_signature(data: QuestionCreate | Question) -> str:
    content = data.content if isinstance(data.content, dict) else {}
    content_text = content.get("text") or content.get("html") or json.dumps(content, ensure_ascii=False, sort_keys=True)
    options = data.options or {}
    normalized_options = json.dumps(options, ensure_ascii=False, sort_keys=True)
    return "|".join(
        [
            data.type.value if hasattr(data.type, "value") else str(data.type),
            _normalize_question_signature_text(content_text),
            _normalize_question_signature_text(normalized_options),
        ]
    )


async def _existing_question_signatures(db: AsyncSession, user_id: uuid.UUID) -> dict[str, uuid.UUID]:
    rows = await db.execute(
        select(Question).where(
            Question.owner_id == user_id,
            Question.deleted_at.is_(None),
        )
    )
    return {
        _question_duplicate_signature(question): question.id
        for question in rows.scalars().all()
    }


async def _merge_question_knowledge_points(
    db: AsyncSession, question_id: uuid.UUID, knowledge_point_ids: list[uuid.UUID]
) -> None:
    """把给定知识点合并进已有题目（去重）；用于重复导入时补充题目的知识点关联，
    例如从课程导入时带上课程根知识点，使重复题目也出现在该课程的题目列表中。"""
    if not knowledge_point_ids:
        return
    question = (
        await db.execute(
            select(Question)
            .where(Question.id == question_id, Question.deleted_at.is_(None))
            .options(selectinload(Question.knowledge_points))
        )
    ).scalar_one_or_none()
    if question is None:
        return
    existing_ids = {kp.id for kp in question.knowledge_points}
    missing_ids = [kp_id for kp_id in knowledge_point_ids if kp_id not in existing_ids]
    if not missing_ids:
        return
    new_kps = list(
        (await db.execute(select(KnowledgePoint).where(KnowledgePoint.id.in_(missing_ids)))).scalars().all()
    )
    if new_kps:
        question.knowledge_points = [*question.knowledge_points, *new_kps]


async def bulk_create_questions(
    db: AsyncSession, questions: list[QuestionCreate], user_id: uuid.UUID
) -> BulkCreateQuestionsResult:
    """Create questions while skipping items already present in the user's database."""
    existing_map = await _existing_question_signatures(db, user_id)
    created_question_ids: list[uuid.UUID] = []
    created_questions: list[QuestionCreate] = []
    existing_question_ids: list[uuid.UUID] = []
    existing = 0

    for data in questions:
        signature = _question_duplicate_signature(data)
        existing_id = existing_map.get(signature)
        if existing_id is not None:
            existing += 1
            existing_question_ids.append(existing_id)
            # 重复题目：把本次携带的知识点合并进已有题目，使其出现在对应课程/知识点列表中。
            await _merge_question_knowledge_points(db, existing_id, data.knowledge_point_ids)
            continue
        question = await create_question(db, data, user_id)
        created_question_ids.append(question.id)
        created_questions.append(data)
        existing_map[signature] = question.id

    return BulkCreateQuestionsResult(
        created_question_ids=created_question_ids,
        created_questions=created_questions,
        existing=existing,
        existing_question_ids=existing_question_ids,
    )


async def bulk_create_questions_fast(
    db: AsyncSession, questions: list[QuestionCreate], user_id: uuid.UUID
) -> BulkCreateQuestionsResult:
    """Create many questions in batched flushes to avoid one giant transaction.

    A single `db.add_all(2000+)` + `db.flush()` can exhaust the PostgreSQL
    statement timeout or OOM uvicorn under heavy load. Splitting into batches
    of 500 keeps each flush small and predictable.
    """
    BATCH_SIZE = 500
    existing_signatures = await _existing_question_signatures(db, user_id)
    tag_ids = {tag_id for data in questions for tag_id in data.tag_ids}
    knowledge_point_ids = {
        knowledge_point_id for data in questions for knowledge_point_id in data.knowledge_point_ids
    }

    tags_by_id: dict[uuid.UUID, Tag] = {}
    knowledge_points_by_id: dict[uuid.UUID, KnowledgePoint] = {}

    if tag_ids:
        tag_rows = await db.execute(select(Tag).where(Tag.id.in_(tag_ids)))
        tags_by_id = {tag.id: tag for tag in tag_rows.scalars().all()}
    if knowledge_point_ids:
        kp_rows = await db.execute(select(KnowledgePoint).where(KnowledgePoint.id.in_(knowledge_point_ids)))
        knowledge_points_by_id = {kp.id: kp for kp in kp_rows.scalars().all()}

    all_created_ids: list[uuid.UUID] = []
    all_created_inputs: list[QuestionCreate] = []
    all_existing = 0
    all_existing_ids: list[uuid.UUID] = []

    batch_questions: list[Question] = []
    batch_inputs: list[QuestionCreate] = []

    async def _flush_batch() -> None:
        nonlocal all_created_ids, all_created_inputs
        if not batch_questions:
            return
        db.add_all(batch_questions)
        await db.flush()
        all_created_ids.extend(q.id for q in batch_questions)
        all_created_inputs.extend(batch_inputs)
        batch_questions.clear()
        batch_inputs.clear()

    for data in questions:
        signature = _question_duplicate_signature(data)

        # Skip duplicates (already in DB or in current batch)
        existing_id = existing_signatures.get(signature)
        if existing_id is not None:
            all_existing += 1
            all_existing_ids.append(existing_id)
            continue

        question = Question(
            type=data.type,
            title=data.title,
            content=data.content,
            options=data.options,
            answer=data.answer,
            analysis=data.analysis,
            difficulty=data.difficulty,
            score=data.score,
            source=_question_source_value(data.source),
            created_by=user_id,
            owner_id=user_id,
            question_bank_id=data.question_bank_id,
        )
        if data.tag_ids:
            question.tags = [tags_by_id[tag_id] for tag_id in data.tag_ids if tag_id in tags_by_id]
        if data.knowledge_point_ids:
            question.knowledge_points = [
                knowledge_points_by_id[knowledge_point_id]
                for knowledge_point_id in data.knowledge_point_ids
                if knowledge_point_id in knowledge_points_by_id
            ]

        batch_questions.append(question)
        batch_inputs.append(data)
        existing_signatures[signature] = question.id  # id assigned at flush

        if len(batch_questions) >= BATCH_SIZE:
            await _flush_batch()

    await _flush_batch()  # flush remainder

    return BulkCreateQuestionsResult(
        created_question_ids=all_created_ids,
        created_questions=all_created_inputs,
        existing=all_existing,
        existing_question_ids=all_existing_ids,
    )


async def create_question_import_job(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    total_count: int,
) -> QuestionImportJob:
    job = QuestionImportJob(
        user_id=user_id,
        status=QuestionImportJobStatus.PENDING,
        total_count=total_count,
        processed_count=0,
        matched_count=0,
        unmatched_count=0,
        failed_count=0,
        created_question_ids=[],
        error_message=None,
        completed_at=None,
    )
    db.add(job)
    await db.flush()
    return job


async def get_question_import_job_by_id(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    user_id: uuid.UUID,
) -> QuestionImportJob | None:
    result = await db.execute(
        select(QuestionImportJob).where(
            QuestionImportJob.id == job_id,
            QuestionImportJob.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def _load_questions_for_import_job(
    db: AsyncSession,
    question_ids: list[uuid.UUID],
) -> dict[uuid.UUID, Question]:
    if not question_ids:
        return {}
    result = await db.execute(
        select(Question)
        .options(selectinload(Question.knowledge_points), selectinload(Question.tags))
        .where(Question.id.in_(question_ids))
    )
    return {question.id: question for question in result.scalars().all()}


async def _send_question_import_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    total_count: int,
    matched_count: int,
    unmatched_count: int,
    failed_count: int,
) -> None:
    try:
        from app.notifications.service import create_notification
    except ImportError:
        return

    content = (
        f"共导入 {total_count} 道题，"
        f"成功匹配 {matched_count} 道，"
        f"未匹配 {unmatched_count} 道，"
        f"失败 {failed_count} 道。"
    )
    await create_notification(
        db,
        user_id,
        "question_import_completed",
        "题目知识点识别完成",
        content=content,
        link_url=f"/questions?import_job_id={job_id}",
        payload={
            "job_id": str(job_id),
            "total_count": total_count,
            "matched_count": matched_count,
            "unmatched_count": unmatched_count,
            "failed_count": failed_count,
        },
    )


async def process_question_import_job(
    *,
    job_id: uuid.UUID,
    user_id: uuid.UUID,
    root_knowledge_point_id: uuid.UUID,
    questions: list[dict],
) -> None:
    async with async_session() as db:
        job = await get_question_import_job_by_id(db, job_id, user_id=user_id)
        if job is None:
            return

        job.status = QuestionImportJobStatus.RUNNING
        await db.commit()

        processed_count = 0
        matched_count = 0
        unmatched_count = 0
        failed_count = 0
        final_status = QuestionImportJobStatus.COMPLETED
        error_message: str | None = None

        try:
            question_payloads = [QuestionCreate.model_validate(question) for question in questions]
            question_ids = [uuid.UUID(question_id) for question_id in job.created_question_ids]
            questions_by_id = await _load_questions_for_import_job(db, question_ids)
            candidates = await _load_root_descendant_knowledge_points(db, root_knowledge_point_id)
            if not candidates:
                candidates = await _suggest_course_child_knowledge_points_from_questions(
                    db,
                    root_knowledge_point_id=root_knowledge_point_id,
                    user_id=user_id,
                    questions=list(questions_by_id.values()),
                )

            for question_id, question_data in zip(question_ids, question_payloads):
                question = questions_by_id.get(question_id)
                if question is None:
                    failed_count += 1
                    processed_count += 1
                    error_message = error_message or f"question {question_id} not found"
                    continue

                try:
                    try:
                        matched = await _set_question_matched_course_knowledge_points(
                            db,
                            question=question,
                            question_data=question_data,
                            candidates=candidates,
                            root_knowledge_point_id=root_knowledge_point_id,
                        )
                    except Exception as exc:  # noqa: BLE001 - AI 匹配失败不应让题目丢失，记录后走兜底
                        matched = False
                        error_message = str(exc)
                    if matched:
                        matched_count += 1
                    else:
                        unmatched_count += 1
                except Exception as exc:  # noqa: BLE001
                    failed_count += 1
                    error_message = str(exc)
                finally:
                    processed_count += 1
                    job.processed_count = processed_count
                    job.matched_count = matched_count
                    job.unmatched_count = unmatched_count
                    job.failed_count = failed_count
                    job.created_question_ids = [str(question_id) for question_id in question_ids]
                    await db.commit()

            if failed_count > 0:
                final_status = (
                    QuestionImportJobStatus.PARTIAL_FAILED if processed_count > failed_count else QuestionImportJobStatus.FAILED
                )
        except Exception as exc:  # noqa: BLE001
            final_status = QuestionImportJobStatus.FAILED if processed_count == 0 else QuestionImportJobStatus.PARTIAL_FAILED
            error_message = str(exc)
        finally:
            job.status = final_status
            job.processed_count = processed_count
            job.matched_count = matched_count
            job.unmatched_count = unmatched_count
            job.failed_count = failed_count
            job.error_message = error_message
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()

            try:
                await _send_question_import_notification(
                    db,
                    user_id=user_id,
                    job_id=job_id,
                    total_count=job.total_count,
                    matched_count=matched_count,
                    unmatched_count=unmatched_count,
                    failed_count=failed_count,
                )
                await db.commit()
            except Exception:  # noqa: BLE001
                pass


def _question_create_from_existing(question: Question) -> QuestionCreate:
    return QuestionCreate(
        type=question.type,
        title=question.title,
        content=question.content or {},
        options=question.options,
        answer=question.answer or {},
        analysis=question.analysis,
        difficulty=question.difficulty,
        score=float(question.score),
        source=question.source or QuestionSource.IMPORTED,
        tag_ids=[tag.id for tag in question.tags],
        knowledge_point_ids=[knowledge_point.id for knowledge_point in question.knowledge_points],
        question_bank_id=question.question_bank_id,
    )


def _question_summary_for_knowledge_completion(question: Question) -> dict[str, Any]:
    question_data = _question_create_from_existing(question)
    content_text = ""
    if isinstance(question_data.content, dict):
        content_text = str(
            question_data.content.get("text") or question_data.content.get("html") or ""
        ).strip()
    return {
        "id": str(question.id),
        "type": (
            question_data.type.value
            if hasattr(question_data.type, "value")
            else str(question_data.type)
        ),
        "title": question_data.title,
        "content": content_text[:800],
        "options": question_data.options or {},
    }


async def _suggest_course_child_knowledge_points_from_questions(
    db: AsyncSession,
    *,
    root_knowledge_point_id: uuid.UUID,
    user_id: uuid.UUID,
    questions: list[Question],
) -> list[KnowledgePoint]:
    """Create direct child knowledge points inferred from course questions.

    This is only used when the course has no child knowledge points yet. It avoids
    treating the course root itself as the answer for every question.
    """
    if not questions:
        return []
    root = await db.get(KnowledgePoint, root_knowledge_point_id)
    if root is None:
        return []

    question_payload = [
        _question_summary_for_knowledge_completion(question)
        for question in questions[:100]
    ]
    prompt = f"""
你是课程知识目录设计助手。当前课程还没有任何子知识点，请根据题目内容为课程补全可用于归类题目的直接子知识点。

课程名称：{root.name}
题目样本（JSON 列表，最多 100 题）：
{json.dumps(question_payload, ensure_ascii=False)}

要求：
1. 只生成直接挂在课程下的子知识点，数量 3 到 12 个；题目很少时可少于 3 个。
2. 子知识点必须来自题目实际考查内容，不能把课程名称本身作为通用知识点。
3. 名称要具体、可复用，避免“综合应用”“课程基础”这类过宽泛表达。
4. 如果题目之间没有可归纳的明确知识点，可以返回空数组。
5. 只返回合法 JSON，字段为 knowledge_points: [{{"name":"...", "description":"..."}}]。
""".strip()

    try:
        data = await _request_deepseek_json(prompt)
    except Exception:
        return []

    raw_items = data.get("knowledge_points") if isinstance(data, dict) else None
    if not isinstance(raw_items, list):
        return []

    created: list[KnowledgePoint] = []
    seen_names: set[str] = set()
    root_name = root.name.strip()
    for raw in raw_items[:12]:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name or name == root_name or name in seen_names:
            continue
        seen_names.add(name)
        existing = (
            await db.execute(
                select(KnowledgePoint).where(
                    KnowledgePoint.parent_id == root_knowledge_point_id,
                    KnowledgePoint.name == name,
                    KnowledgePoint.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            created.append(existing)
            continue
        description = str(raw.get("description") or "").strip() or None
        kp = await create_knowledge_point(
            db,
            KnowledgePointCreate(
                name=name,
                parent_id=root_knowledge_point_id,
                description=description,
            ),
            user_id,
        )
        created.append(kp)
    return created


async def _set_question_matched_course_knowledge_points(
    db: AsyncSession,
    *,
    question: Question,
    question_data: QuestionCreate,
    candidates: list[KnowledgePoint],
    root_knowledge_point_id: uuid.UUID,
) -> bool:
    matched_ids = await match_knowledge_points_with_ai(question_data, candidates)
    existing_ids = [
        kp.id for kp in question.knowledge_points if kp.id != root_knowledge_point_id
    ]
    merged_ids = list(dict.fromkeys([*existing_ids, *matched_ids]))
    if merged_ids:
        matched_kps_result = await db.execute(
            select(KnowledgePoint).where(KnowledgePoint.id.in_(merged_ids))
        )
        question.knowledge_points = list(matched_kps_result.scalars().all())
    else:
        question.knowledge_points = []
    return bool(matched_ids)


async def process_existing_question_knowledge_match_job(
    *,
    job_id: uuid.UUID,
    user_id: uuid.UUID,
    root_knowledge_point_id: uuid.UUID,
    question_ids: list[uuid.UUID],
) -> None:
    async with async_session() as db:
        job = await get_question_import_job_by_id(db, job_id, user_id=user_id)
        if job is None:
            return

        job.status = QuestionImportJobStatus.RUNNING
        await db.commit()

        processed_count = 0
        matched_count = 0
        unmatched_count = 0
        failed_count = 0
        final_status = QuestionImportJobStatus.COMPLETED
        error_message: str | None = None

        try:
            questions_by_id = await _load_questions_for_import_job(db, question_ids)
            candidates = await _load_root_descendant_knowledge_points(db, root_knowledge_point_id)
            if not candidates:
                candidates = await _suggest_course_child_knowledge_points_from_questions(
                    db,
                    root_knowledge_point_id=root_knowledge_point_id,
                    user_id=user_id,
                    questions=list(questions_by_id.values()),
                )

            for question_id in question_ids:
                question = questions_by_id.get(question_id)
                if question is None:
                    failed_count += 1
                    processed_count += 1
                    error_message = error_message or f"question {question_id} not found"
                    continue

                try:
                    question_data = _question_create_from_existing(question)
                    matched = await _set_question_matched_course_knowledge_points(
                        db,
                        question=question,
                        question_data=question_data,
                        candidates=candidates,
                        root_knowledge_point_id=root_knowledge_point_id,
                    )
                    if matched:
                        matched_count += 1
                    else:
                        unmatched_count += 1
                except Exception as exc:  # noqa: BLE001
                    failed_count += 1
                    error_message = str(exc)
                finally:
                    processed_count += 1
                    job.processed_count = processed_count
                    job.matched_count = matched_count
                    job.unmatched_count = unmatched_count
                    job.failed_count = failed_count
                    job.created_question_ids = [str(question_id) for question_id in question_ids]
                    await db.commit()

            if failed_count > 0:
                final_status = (
                    QuestionImportJobStatus.PARTIAL_FAILED
                    if processed_count > failed_count
                    else QuestionImportJobStatus.FAILED
                )
        except Exception as exc:  # noqa: BLE001
            final_status = (
                QuestionImportJobStatus.FAILED
                if processed_count == 0
                else QuestionImportJobStatus.PARTIAL_FAILED
            )
            error_message = str(exc)
        finally:
            job.status = final_status
            job.processed_count = processed_count
            job.matched_count = matched_count
            job.unmatched_count = unmatched_count
            job.failed_count = failed_count
            job.error_message = error_message
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()


async def link_existing_questions_to_course(
    db: AsyncSession,
    question_ids: list[uuid.UUID],
    root_knowledge_point: KnowledgePoint,
) -> int:
    """重复导入时，把已存在的题目重新关联到课程根知识点。

    课程题目列表按「课程根知识点及其子树」聚合，所以已在课程子树内的题目无需再关联，
    其余（例如之前导入到题库但没挂到本课程的）补挂到课程根，使其出现在课程题目列表中。
    返回新关联的题目数。
    """
    if not question_ids:
        return 0
    descendants = await _load_root_descendant_knowledge_points(db, root_knowledge_point.id)
    subtree_ids = {root_knowledge_point.id, *(kp.id for kp in descendants)}
    rows = await db.execute(
        select(Question)
        .where(Question.id.in_(question_ids), Question.deleted_at.is_(None))
        .options(selectinload(Question.knowledge_points))
    )
    linked = 0
    for question in rows.scalars().unique().all():
        if any(kp.id in subtree_ids for kp in question.knowledge_points):
            continue  # 已在课程下，无需重复关联
        question.knowledge_points = [*question.knowledge_points, root_knowledge_point]
        linked += 1
    return linked


async def _load_root_descendant_knowledge_points(
    db: AsyncSession, root_knowledge_point_id: uuid.UUID
) -> list[KnowledgePoint]:
    """Return all descendants of a root knowledge point (non-recursive BFS)."""
    result: list[KnowledgePoint] = []
    frontier: list[uuid.UUID] = [root_knowledge_point_id]
    visited: set[uuid.UUID] = {root_knowledge_point_id}
    while frontier:
        rows = await db.execute(
            select(KnowledgePoint).where(KnowledgePoint.parent_id.in_(frontier))
        )
        children = list(rows.scalars().all())
        if not children:
            break
        next_frontier: list[uuid.UUID] = []
        for child in children:
            if child.id in visited:
                continue
            visited.add(child.id)
            result.append(child)
            next_frontier.append(child.id)
        frontier = next_frontier
    return result


def _keyword_score(text: str, keywords: set[str]) -> int:
    """Count how many normalized keywords appear in the given text."""
    if not text or not keywords:
        return 0
    normalized = text.lower()
    return sum(1 for kw in keywords if kw in normalized)


def _extract_question_keywords(question: QuestionCreate) -> set[str]:
    """Extract meaningful keyword tokens from a question for pre-filtering."""
    content_text = ""
    if isinstance(question.content, dict):
        content_text = str(question.content.get("text") or question.content.get("html") or "").strip()
    source = f"{question.title} {content_text}"
    # Keep Chinese character runs (2+ chars) and alphanumeric tokens (3+ chars)
    tokens: set[str] = set()
    for match in re.finditer(r"[一-鿿]{2,}|[a-zA-Z0-9]{3,}", source):
        tokens.add(match.group(0).lower())
    return tokens


async def match_knowledge_points_with_ai(
    question: QuestionCreate, candidates: list[KnowledgePoint]
) -> list[uuid.UUID]:
    """Use AI to pick the most relevant knowledge points; returns ids (possibly empty)."""
    if not candidates:
        return []

    content_text = ""
    if isinstance(question.content, dict):
        content_text = str(question.content.get("text") or question.content.get("html") or "").strip()

    # Pre-filter: score candidates by keyword overlap, keep top N to
    # reduce noise in the AI prompt and improve match accuracy.
    keywords = _extract_question_keywords(question)
    MAX_CANDIDATES_FOR_AI = 25
    if len(candidates) > MAX_CANDIDATES_FOR_AI and keywords:
        scored = [
            (
                _keyword_score(kp.name, keywords) + _keyword_score(kp.description or "", keywords),
                kp,
            )
            for kp in candidates
        ]
        scored.sort(key=lambda pair: pair[0], reverse=True)
        filtered = [kp for _, kp in scored[:MAX_CANDIDATES_FOR_AI]]
    else:
        filtered = list(candidates)

    candidates_payload = [
        {
            "id": str(kp.id),
            "name": kp.name,
            "description": (kp.description or "").strip()[:200],
        }
        for kp in filtered
    ]

    prompt = f"""
你是教研知识点匹配助手。给你一道题目和一组候选知识点，请选出与题目内容最相关的知识点。

题目类型：{question.type}
题目标题：{question.title}
题目内容：{content_text[:1500]}
选项：{json.dumps(question.options or {}, ensure_ascii=False)}
候选知识点（JSON 列表）：
{json.dumps(candidates_payload, ensure_ascii=False)}

要求：
1. 从候选中选出 0 到 3 个最相关的知识点；若没有明显相关的，返回空数组。
2. 只能使用候选 id，不要编造新 id。
3. 只返回合法 JSON，字段为 matched_ids: string[]。
""".strip()

    try:
        data = await _request_deepseek_json(prompt)
    except Exception:
        return []
    raw_ids = data.get("matched_ids") if isinstance(data, dict) else None
    if not isinstance(raw_ids, list):
        return []
    valid_ids = {kp.id for kp in candidates}
    matched: list[uuid.UUID] = []
    for raw in raw_ids:
        try:
            kp_id = uuid.UUID(str(raw))
        except (TypeError, ValueError):
            continue
        if kp_id in valid_ids and kp_id not in matched:
            matched.append(kp_id)
    return matched


async def match_and_create_import_question(
    db: AsyncSession,
    question_data: QuestionCreate,
    root_knowledge_point_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[Question, list[KnowledgePoint]]:
    """Match knowledge points under the root knowledge point via AI, then create the question."""
    candidates = await _load_root_descendant_knowledge_points(db, root_knowledge_point_id)
    matched_ids = await match_knowledge_points_with_ai(question_data, candidates)
    question_payload = question_data.model_copy(
        update={
            "knowledge_point_ids": list({*question_data.knowledge_point_ids, *matched_ids}),
            "source": QuestionSource.IMPORTED,
        }
    )
    question = await create_question(db, question_payload, user_id)
    matched_kps = [kp for kp in candidates if kp.id in matched_ids]
    return question, matched_kps


async def get_or_create_named_private_question_bank(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    name: str,
    description: str,
) -> QuestionBank:
    result = await db.execute(
        select(QuestionBank).where(
            QuestionBank.name == name,
            QuestionBank.owner_id == user_id,
            QuestionBank.deleted_at.is_(None),
        )
    )
    bank = result.scalar_one_or_none()
    if bank:
        return bank
    bank = QuestionBank(
        name=name,
        description=description,
        owner_id=user_id,
        visibility=VisibilityScope.PRIVATE,
    )
    db.add(bank)
    await db.flush()
    return bank


def root_knowledge_question_bank_name(root_name: str) -> str:
    suffix = "-题库"
    normalized = root_name.strip() or "主知识"
    return f"{normalized[: 200 - len(suffix)]}{suffix}"


async def get_root_knowledge_point(
    db: AsyncSession,
    knowledge_point_id: uuid.UUID,
) -> KnowledgePoint | None:
    current = await db.get(KnowledgePoint, knowledge_point_id)
    if current is None or current.deleted_at is not None:
        return None
    while current.parent_id is not None:
        parent = await db.get(KnowledgePoint, current.parent_id)
        if parent is None or parent.deleted_at is not None:
            break
        current = parent
    return current


async def get_root_knowledge_point_for_questions(
    db: AsyncSession,
    questions: list[QuestionCreate],
) -> KnowledgePoint | None:
    for question in questions:
        for knowledge_point_id in question.knowledge_point_ids:
            root = await get_root_knowledge_point(db, knowledge_point_id)
            if root is not None:
                return root
    return None


async def get_or_create_root_knowledge_question_bank(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    root_knowledge_point: KnowledgePoint,
) -> QuestionBank:
    root_name = root_knowledge_point.name.strip()
    return await get_or_create_named_private_question_bank(
        db,
        user_id=user_id,
        name=root_knowledge_question_bank_name(root_name),
        description=f"「{root_name}」主知识关联的智能出题结果",
    )


async def save_generated_questions_to_default_course_bank(
    db: AsyncSession,
    questions: list[QuestionCreate],
    user_id: uuid.UUID,
) -> BulkCreateQuestionsResult:
    root_knowledge_point = await get_root_knowledge_point_for_questions(db, questions)
    if root_knowledge_point is None:
        bank = await get_or_create_named_private_question_bank(
            db,
            user_id=user_id,
            name="课程题库",
            description="课程学习资料关联的智能出题结果",
        )
    else:
        bank = await get_or_create_root_knowledge_question_bank(
            db,
            user_id=user_id,
            root_knowledge_point=root_knowledge_point,
        )
    scoped_questions = [
        question.model_copy(
            update={"question_bank_id": bank.id, "source": QuestionSource.AI_GENERATED}
        )
        for question in questions
    ]
    return await bulk_create_questions(db, scoped_questions, user_id)


# --- Import Enhancement ---


def _build_enhance_kp_candidates(
    all_candidates: list[KnowledgePoint],
    keywords: set[str],
) -> list[dict]:
    """Pre-filter and format KP candidates for the enhance AI prompt."""
    MAX_CANDIDATES = 25
    if len(all_candidates) > MAX_CANDIDATES and keywords:
        scored = [
            (
                _keyword_score(kp.name, keywords) + _keyword_score(kp.description or "", keywords),
                kp,
            )
            for kp in all_candidates
        ]
        scored.sort(key=lambda pair: pair[0], reverse=True)
        filtered = [kp for _, kp in scored[:MAX_CANDIDATES]]
    else:
        filtered = list(all_candidates)

    return [
        {
            "id": str(kp.id),
            "name": kp.name,
            "description": (kp.description or "").strip()[:200],
        }
        for kp in filtered
    ]


async def _enhance_single_draft(
    draft: EnhanceDraftInput,
    candidates_json: list[dict],
    candidates_map: dict[uuid.UUID, str],
    mode: str = "both",
) -> EnhancedDraft:
    """Run one draft's enhancement through AI, scoped by ``mode``.

    - ``answers``：补全/校验答案与解析（附带存疑标记）
    - ``analysis``：只补全/校验解析，不动答案，也不匹配知识点
    - ``knowledge``：只匹配知识点
    - ``both``：答案 + 解析 + 知识点
    """
    options_str = ""
    if draft.options:
        options_str = json.dumps(draft.options, ensure_ascii=False)

    if mode == "answers":
        prompt = f"""你是教研助手。给你一道题目，请完成答案与解析处理：

- 如果题目没有提供答案，请为这道题生成标准答案。
- 如果题目已有答案，请检查答案是否正确。如果答案有疑问（如明显错误、不完整、或与题目内容矛盾），标记 doubt=true 并说明原因。
- answer_text 只返回答案本身，不要包含解析或说明。
- 如果题目没有提供解析，请生成一段简明、可用于教学讲解的解析。
- 如果题目已有解析，请检查是否与题目和答案一致；若解析为空、过短或明显不完整，请补全。
- analysis 只返回解析内容本身，不要重复题干。

题目类型：{draft.type}
题目内容：{draft.content_text[:2000]}
选项：{options_str or "（无）"}
当前答案：{draft.answer_text or "（无）"}
当前解析：{draft.analysis or "（无）"}

只返回合法 JSON：
{{"answer_text":"...", "analysis":"...", "doubt":true/false, "doubt_reason":"..."|null, "matched_kp_ids":[]}}""".strip()
    elif mode == "analysis":
        prompt = f"""你是教研助手。给你一道题目，请只完善解析：

- 如果题目没有提供解析，请生成一段简明、可用于教学讲解的解析。
- 如果题目已有解析，请检查是否与题目和答案一致；若解析为空、过短、明显不完整或与答案矛盾，请重写补全。
- analysis 只返回解析内容本身，不要重复题干。
- 不要改动答案，也不要匹配知识点。

题目类型：{draft.type}
题目内容：{draft.content_text[:2000]}
选项：{options_str or "（无）"}
当前答案：{draft.answer_text or "（无）"}
当前解析：{draft.analysis or "（无）"}

只返回合法 JSON：
{{"answer_text":null, "analysis":"...", "doubt":false, "doubt_reason":null, "matched_kp_ids":[]}}""".strip()
    elif mode == "knowledge":
        prompt = f"""你是教研助手。给你一道题目和候选知识点，请只完成知识点匹配：

- 从候选知识点列表中选择与题目内容最相关的 0-3 个知识点。
- 只能使用候选 id，不要编造。
- 若没有明显相关的，返回空数组。
- 不要补全或修改答案、解析。

题目类型：{draft.type}
题目内容：{draft.content_text[:2000]}
选项：{options_str or "（无）"}
当前答案：{draft.answer_text or "（无）"}
当前解析：{draft.analysis or "（无）"}
候选知识点（JSON 列表）：
{json.dumps(candidates_json, ensure_ascii=False)}

只返回合法 JSON：
{{"answer_text":null, "analysis":null, "doubt":false, "doubt_reason":null, "matched_kp_ids":["uuid1","uuid2"]}}""".strip()
    else:
        prompt = f"""你是教研助手。给你一道题目和候选知识点，请同时完成三项任务：

任务1 — 答案处理：
- 如果题目没有提供答案，请为这道题生成标准答案。
- 如果题目已有答案，请检查答案是否正确。如果答案有疑问（如明显错误、不完整、或与题目内容矛盾），标记 doubt=true 并说明原因。
- answer_text 只返回答案本身，不要包含解析或说明。

任务2 — 解析处理：
- 如果题目没有提供解析，请生成一段简明、可用于教学讲解的解析。
- 如果题目已有解析，请检查是否与题目和答案一致；若解析为空、过短或明显不完整，请补全。
- analysis 只返回解析内容本身，不要重复题干。

任务3 — 知识点匹配：
- 从候选知识点列表中选择与题目内容最相关的 0-3 个知识点。
- 题目如果标注了原文知识点，优先匹配名称与原文知识点一致或最接近的候选知识点。
- 只能使用候选 id，不要编造。
- 若没有明显相关的，返回空数组。

题目类型：{draft.type}
题目内容：{draft.content_text[:2000]}
选项：{options_str or "（无）"}
当前答案：{draft.answer_text or "（无）"}
当前解析：{draft.analysis or "（无）"}
原文标注知识点：{"、".join(draft.recognized_knowledge_points) or "（无）"}
候选知识点（JSON 列表）：
{json.dumps(candidates_json, ensure_ascii=False)}

只返回合法 JSON：
{{"answer_text":"...", "analysis":"...", "doubt":true/false, "doubt_reason":"..."|null, "matched_kp_ids":["uuid1","uuid2"]}}""".strip()

    try:
        data = await _request_deepseek_json(prompt)
    except Exception:
        return EnhancedDraft(draft_id=draft.draft_id)

    if not isinstance(data, dict):
        return EnhancedDraft(draft_id=draft.draft_id)

    def optional_text(value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    if mode == "knowledge":
        answer_text = None
        analysis = None
        doubt = False
        doubt_reason = None
    elif mode == "analysis":
        # 只完善解析：答案与存疑标记保持原样，由前端沿用草稿已有内容。
        answer_text = None
        analysis = optional_text(data.get("analysis"))
        doubt = False
        doubt_reason = None
    else:
        answer_text = optional_text(data.get("answer_text"))
        analysis = optional_text(data.get("analysis"))
        doubt = bool(data.get("doubt", False))
        doubt_reason = optional_text(data.get("doubt_reason"))

    matched_kp_ids = data.get("matched_kp_ids") if mode in {"knowledge", "both"} else None
    suggested: list[KnowledgePointSuggestion] = []
    if isinstance(matched_kp_ids, list):
        for raw in matched_kp_ids:
            try:
                kp_id = uuid.UUID(str(raw))
            except (TypeError, ValueError):
                continue
            name = candidates_map.get(kp_id)
            if name:
                suggested.append(KnowledgePointSuggestion(id=kp_id, name=name))

    return EnhancedDraft(
        draft_id=draft.draft_id,
        answer_text=answer_text,
        analysis=analysis,
        doubt=doubt,
        doubt_reason=doubt_reason,
        suggested_knowledge_points=suggested,
    )


def _extract_question_content_text(question: Question) -> str:
    content = question.content
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
        html = content.get("html")
        if isinstance(html, str) and html.strip():
            return re.sub(r"<[^>]+>", " ", html).strip()
    if isinstance(content, str) and content.strip():
        return content.strip()
    return question.title or ""


def _question_answer_is_empty(question: Question) -> bool:
    answer = question.answer if isinstance(question.answer, dict) else {}
    qtype = question.type.value if hasattr(question.type, "value") else str(question.type)
    if qtype == "choice":
        return not answer.get("correct")
    if qtype == "true_false":
        return answer.get("correct") is None
    if qtype == "fill_in":
        correct = answer.get("correct")
        if isinstance(correct, list):
            return not any(str(item).strip() for item in correct)
        return not (correct and str(correct).strip())
    if qtype in ("short_answer", "essay"):
        text = answer.get("text")
        return not (
            answer.get("points")
            or answer.get("key_points")
            or (isinstance(text, str) and text.strip())
        )
    if qtype == "code":
        return not (answer.get("code") or answer.get("text"))
    return not answer


async def complete_question_answer_analysis(db: AsyncSession, question: Question) -> Question:
    """若题目缺少答案或解析，调用 AI 补全并持久化；已完整则原样返回。"""
    qtype = question.type.value if hasattr(question.type, "value") else str(question.type)
    answer_empty = _question_answer_is_empty(question)
    analysis_empty = not (question.analysis or "").strip()
    if not answer_empty and not analysis_empty:
        return question

    content_text = _extract_question_content_text(question)
    options_str = (
        json.dumps(question.options, ensure_ascii=False) if question.options else "（无）"
    )
    prompt = f"""你是教研助手。请为下面的题目补全标准答案和解析。

题目类型：{qtype}
题目内容：{content_text[:2000]}
选项：{options_str}

只返回合法 JSON：{{"answer": <答案对象>, "analysis": "解析文本"}}
其中 answer 的格式必须依据题型：
- 单选题(choice)：{{"correct":"A"}}
- 多选题(choice)：{{"correct":["A","B"]}}
- 判断题(true_false)：{{"correct":true}} 或 {{"correct":false}}
- 填空题(fill_in)：{{"correct":["答案1","答案2"]}}
- 简答题/论述题(short_answer/essay)：{{"points":["要点1","要点2"]}}
- 编程题(code)：{{"code":"参考代码"}}
解析要简明、可用于教学讲解，不要重复题干。"""

    try:
        data = await _request_deepseek_json(prompt)
    except Exception as exc:  # noqa: BLE001 - surface as a clean error to the caller
        raise RuntimeError(f"AI 补全答案/解析失败：{exc}") from exc

    changed = False
    if answer_empty:
        ai_answer = data.get("answer")
        if isinstance(ai_answer, dict) and ai_answer:
            question.answer = ai_answer
            changed = True
    if analysis_empty:
        ai_analysis = str(data.get("analysis", "")).strip()
        if ai_analysis:
            question.analysis = ai_analysis
            changed = True

    if changed:
        question.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(question)

    return question


_SEED_QTYPE_LABEL = {
    "choice": "选择题",
    "true_false": "判断题",
    "fill_in": "填空题",
    "short_answer": "简答题",
    "essay": "论述题",
    "code": "编程题",
}


async def complete_seed_answer_analysis(qtype: str, content_text: str) -> dict[str, str]:
    """为一道"种子题"（教师已选题型 + 粘贴题干）补全可读的参考答案与解析。

    返回纯文本字符串，供出题技能作为风格样本展示与存储（不落库）。
    """
    label = _SEED_QTYPE_LABEL.get(qtype, qtype)
    prompt = f"""你是教研助手。下面是一道{label}的题干，请补全参考答案和解析。

题型：{qtype}
题干：{content_text[:2000]}

只返回合法 JSON：{{"answer":"参考答案（纯文本，可读）","analysis":"解析（纯文本）"}}
答案要简明直接：选择题给出正确选项字母及其内容；判断题给出"正确"或"错误"；填空题按顺序给出每空答案；简答题/论述题给出关键要点；编程题给出参考代码。
解析简明、可用于课堂讲解，不要重复题干。"""

    try:
        data = await _request_deepseek_json(prompt)
    except Exception as exc:  # noqa: BLE001 - surface as a clean error to the caller
        raise RuntimeError(f"AI 补全答案/解析失败：{exc}") from exc

    return {
        "answer": str(data.get("answer", "")).strip(),
        "analysis": str(data.get("analysis", "")).strip(),
    }


async def enhance_import_drafts(
    db: AsyncSession,
    drafts: list[EnhanceDraftInput],
    root_knowledge_point_id: uuid.UUID | None,
    mode: str = "both",
) -> list[EnhancedDraft]:
    """Batch-enhance import drafts: answer/analysis completion + KP matching."""
    candidates = (
        await _load_root_descendant_knowledge_points(db, root_knowledge_point_id)
        if root_knowledge_point_id is not None and mode in {"knowledge", "both"}
        else []
    )
    candidates_map = {kp.id: kp.name for kp in candidates}

    semaphore = asyncio.Semaphore(5)

    async def process_one(draft: EnhanceDraftInput) -> EnhancedDraft:
        async with semaphore:
            keywords = _extract_keywords_from_text(
                f"{draft.content_text} {' '.join(draft.options.values()) if draft.options else ''}"
            )
            kp_candidates = _build_enhance_kp_candidates(candidates, keywords)
            return await _enhance_single_draft(draft, kp_candidates, candidates_map, mode=mode)

    return await asyncio.gather(*(process_one(d) for d in drafts))


async def enhance_import_drafts_stream(
    db: AsyncSession,
    drafts: list[EnhanceDraftInput],
    root_knowledge_point_id: uuid.UUID | None,
    mode: str = "both",
):
    """Stream-enhanced version: yields (index, EnhancedDraft) as each draft completes."""
    candidates = (
        await _load_root_descendant_knowledge_points(db, root_knowledge_point_id)
        if root_knowledge_point_id is not None and mode in {"knowledge", "both"}
        else []
    )
    candidates_map = {kp.id: kp.name for kp in candidates}

    semaphore = asyncio.Semaphore(5)

    async def process_one(index: int, draft: EnhanceDraftInput) -> tuple[int, EnhancedDraft]:
        async with semaphore:
            keywords = _extract_keywords_from_text(
                f"{draft.content_text} {' '.join(draft.options.values()) if draft.options else ''}"
            )
            kp_candidates = _build_enhance_kp_candidates(candidates, keywords)
            result = await _enhance_single_draft(draft, kp_candidates, candidates_map, mode=mode)
            return index, result

    tasks = [process_one(i, d) for i, d in enumerate(drafts)]
    for coro in asyncio.as_completed(tasks):
        index, result = await coro
        yield index, result


def _extract_keywords_from_text(source: str) -> set[str]:
    """Extract meaningful keyword tokens for KP pre-filtering from raw text."""
    tokens: set[str] = set()
    for match in re.finditer(r"[一-鿿]{2,}|[a-zA-Z0-9]{3,}", source):
        tokens.add(match.group(0).lower())
    return tokens

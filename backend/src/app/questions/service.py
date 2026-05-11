"""CRUD service functions for Question, Tag, and KnowledgePoint."""

import json
import re
import uuid
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
from app.exams.models import Exam, ExamQuestion, StudentExamAnswer, StudentExamSubmissionAnswer, StudentQuestionProgress
from app.questions.models import KnowledgePoint, Question, QuestionBank, QuestionImportJob, QuestionImportJobStatus, Tag, question_tags
from app.questions.schemas import (
    ImportConfidence,
    ImportRecognitionMode,
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
    failed: int = 0

    @property
    def created(self) -> int:
        return len(self.created_question_ids)


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
        select(QuestionBank, func.coalesce(count_subq.c.cnt, 0).label("question_count"))
        .outerjoin(count_subq, QuestionBank.id == count_subq.c.question_bank_id)
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

    return [{"bank": row[0], "question_count": row[1]} for row in rows], no_bank_count


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


async def create_question(db: AsyncSession, data: QuestionCreate, user_id: uuid.UUID) -> Question:
    question = Question(
        type=data.type,
        title=data.title,
        content=data.content,
        options=data.options,
        answer=data.answer,
        analysis=data.analysis,
        difficulty=data.difficulty,
        score=data.score,
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


async def update_question(db: AsyncSession, question: Question, data: QuestionUpdate) -> Question:
    update_data = data.model_dump(exclude_unset=True, exclude={"tag_ids", "knowledge_point_ids"})
    for field, value in update_data.items():
        setattr(question, field, value)

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
        _http_client = httpx.AsyncClient(timeout=120.0)
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
    )


def _ensure_image_data_url(image: str) -> str:
    if image.strip().lower().startswith("data:"):
        return image
    return f"data:image/jpeg;base64,{image}"


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
    re.compile(r"^\s*(\d+(?:[\.．\)）、]|(?=\s+))|[\(\（]\d+[\)）]|\[\d+\]|【\d+】)\s*"),
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


@dataclass(frozen=True)
class TaggedListLine:
    kind: str
    text: str


_TAGGED_LIST_LINE_RE = re.compile(r"^\[(OL|UL)\]\s*(.+)$", re.IGNORECASE)
_EXPLICIT_OPTION_LINE_RE = re.compile(r"^([A-H])[\.．、\)]\s*(.+)$", re.IGNORECASE)


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


def _extract_options(
    lines: list[str],
    *,
    type_hint_text: str = "",
    answer_text: str = "",
) -> tuple[dict[str, str], set[int]]:
    options: dict[str, str] = {}
    consumed_indexes: set[int] = set()

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
        "一般": 3,
        "中等": 3,
        "较难": 4,
        "困难": 5,
        "很难": 5,
    }
    template_labels = {
        "很容易": 1,
        "容易": 2,
        "一般": 3,
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
    if re.search(r"(单项选择题|单项选择|单选题|单选|多项选择题|多项选择|多选选择题|多选选择|多选题|多选|选择题|选择)", raw_text) or len(options) >= 2:
        return "choice", "high"
    if re.search(r"(判断题|判断|是非题|是非)", raw_text) or re.fullmatch(
        r"(正确|错误|对|错|√|×|T|F|True|False)", answer_text.strip(), re.IGNORECASE
    ):
        return "true_false", "high"
    if re.search(r"(_{2,}|（\s*）|\(\s*\)|【\s*】|\[\s*\])", raw_text):
        return "fill_in", "high"
    if re.search(r"(编程题|编程|代码题|代码|程序设计|实现函数|编写程序|示例输入|示例输出|```)", raw_text, re.IGNORECASE):
        return "code", "high"
    if re.search(r"(论述题|论述|阐述|分析并评价|结合实际谈谈)", raw_text):
        return "essay", "medium"
    return "short_answer", "medium"


def _is_standalone_question_type_line(line: str) -> bool:
    return bool(
        re.fullmatch(
            _QUESTION_TYPE_KEYWORD_PATTERN,
            line.strip(),
        )
    )


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
        answer_match = re.match(r"^(?:\[(答案|参考答案)\]|(答案|参考答案|answer))[:：]?\s*(.+)$", line, re.IGNORECASE)
        analysis_match = re.match(r"^(?:\[(解析|分析)\]|(解析|分析|analysis))[:：]?\s*(.+)$", line, re.IGNORECASE)
        difficulty_match = re.match(r"^(?:\[(难度|难易度)\]|(难度|难易度|difficulty))[:：]?\s*(.+)$", line, re.IGNORECASE)
        blank_answer_field = re.match(r"^(?:\[(答案|参考答案)\]|(答案|参考答案|answer))[:：]?\s*$", line, re.IGNORECASE)
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
                fields.get("题型", ""),
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


def _collect_segment_images(raw_text: str, images: list[QuestionImportImageInput]) -> list[QuestionImportImageInput]:
    image_ids = re.findall(r"\[IMAGE:([^\]]+)\]", raw_text)
    if not image_ids:
        return []
    index = {image.image_id: image for image in images}
    return [index[image_id] for image_id in image_ids if image_id in index]


def _is_paper_import_context(payload: QuestionImportDocumentRecognizeRequest) -> bool:
    return payload.import_context == "paper"


def _table_to_import_text(table: QuestionImportTableInput) -> str:
    lines = [f"[TABLE:{table.order}]"]
    lines.extend(" | ".join(cell.strip() for cell in row) for row in table.rows if any(cell.strip() for cell in row))
    return "\n".join(lines)


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
    return bool(
        re.match(
            rf"^[一二三四五六七八九十]+[、.．\s]\s*({_QUESTION_TYPE_KEYWORD_PATTERN})",
            line.strip(),
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

    table_texts = [
        _table_to_import_text(table)
        for table in tables
        if table.rows and not any("得分统计表" in "".join(row) or "选择题答案" in "".join(row) for row in table.rows)
    ]
    body = "\n".join(kept).strip()
    if table_texts:
        body = "\n\n".join(part for part in [body, *table_texts] if part)
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
    paper_rules = ""
    if import_context == "paper":
        paper_rules = """
试卷导入额外规则：
- 试卷封面/表头不是题目：学校名称、学年学期、课程名、试卷 A/B 卷、答题时限、考试形式、班级、学号、姓名、得分栏、得分统计表、阅卷教师/核查人签名均不要生成题目。
- 题型说明不是题目，例如“一、单项选择题（每小题 2 分，共 50 分）”只作为后续题型、分值和题量上下文。
- 答题卡/答案填写表不是题目，例如只包含 1. 2. 3...25. 的编号表格不要生成空题；它只能作为题量线索。
- 不要因为答题卡编号臆造空题。只输出实际看到完整题干的题目。
"""
    custom_rules = ""
    if recognition_prompt and recognition_prompt.strip():
        custom_rules = f"""
用户补充识别要求：
{recognition_prompt.strip()}
"""
    truncated = raw_text[:8000]
    return f"""分析题目文本，只输出JSON: {{"questions":[{{"type":"choice|true_false|fill_in|short_answer|essay|code","content_text":"题干","options":{{"A":"..."}}|null,"answer_text":"答案或空","analysis":"解析或空","difficulty":1-5,"raw_text":"原文","images":[]}}]}}
{paper_rules}{custom_rules}
文本:
{truncated}"""


def _validate_ai_document_questions(data: dict) -> list[dict]:
    questions = data.get("questions")
    if not isinstance(questions, list) or not questions:
        raise RuntimeError("AI 分析结果格式异常，请重试")
    validated: list[dict] = []
    for item in questions:
        if not isinstance(item, dict):
            continue
        raw_type = str(item.get("type", "")).strip()
        if raw_type not in _VALID_QUESTION_TYPES:
            raw_type = "short_answer"
        difficulty = item.get("difficulty", 3)
        try:
            safe_difficulty = max(1, min(5, int(difficulty)))
        except (TypeError, ValueError):
            safe_difficulty = 3
        options = item.get("options")
        validated.append(
            {
                "type": raw_type,
                "content_text": str(item.get("content_text", "")).strip(),
                "options": options if isinstance(options, dict) else None,
                "answer_text": str(item.get("answer_text", "")).strip(),
                "analysis": str(item.get("analysis", "")).strip(),
                "difficulty": safe_difficulty,
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
    return merge_ai_and_rule_recognition(ai_drafts, baseline)


def _draft_dedup_key(draft: QuestionImportDraft) -> str:
    """Build a dedup key from normalized content_text + sorted options."""
    text = " ".join(draft.content_text.split()).strip().lower()
    if draft.options:
        opts = "|".join(f"{k}={' '.join(v.split()).strip().lower()}" for k, v in sorted(draft.options.items()))
        return f"{text}||{opts}"
    return text


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


async def recognize_question_document(
    payload: QuestionImportDocumentRecognizeRequest,
) -> QuestionImportDocumentRecognizeResponse:
    if _is_paper_import_context(payload):
        payload = payload.model_copy(update={"raw_text": preprocess_paper_import_text(payload.raw_text, payload.tables)})
    mode = (
        ImportRecognitionMode.TEMPLATE.value
        if payload.prefer_template
        else detect_import_template_mode(payload.raw_text)
    )
    drafts = _build_rule_based_drafts(payload, mode)
    if payload.analysis_mode == QuestionImportAnalysisMode.AI_FULL:
        try:
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
文本:
{raw_text}"""

    data = await _request_deepseek_json(prompt)
    raw_options = data.get("options")
    options = raw_options if isinstance(raw_options, dict) else None

    raw_type = str(data.get("type", "short_answer")).strip()
    safe_type = raw_type if raw_type in _VALID_QUESTION_TYPES else "short_answer"

    return QuestionImportRecognizeResponse(
        type=safe_type,  # type: ignore[arg-type]
        content_text=str(data.get("content_text", "")).strip(),
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


async def _existing_question_signatures(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    rows = await db.execute(
        select(Question).where(
            Question.owner_id == user_id,
            Question.deleted_at.is_(None),
        )
    )
    return {_question_duplicate_signature(question) for question in rows.scalars().all()}


async def bulk_create_questions(
    db: AsyncSession, questions: list[QuestionCreate], user_id: uuid.UUID
) -> BulkCreateQuestionsResult:
    """Create questions while skipping items already present in the user's database."""
    existing_signatures = await _existing_question_signatures(db, user_id)
    created_question_ids: list[uuid.UUID] = []
    created_questions: list[QuestionCreate] = []
    existing = 0

    for data in questions:
        signature = _question_duplicate_signature(data)
        if signature in existing_signatures:
            existing += 1
            continue
        question = await create_question(db, data, user_id)
        created_question_ids.append(question.id)
        created_questions.append(data)
        existing_signatures.add(signature)

    return BulkCreateQuestionsResult(
        created_question_ids=created_question_ids,
        created_questions=created_questions,
        existing=existing,
    )


async def bulk_create_questions_fast(
    db: AsyncSession, questions: list[QuestionCreate], user_id: uuid.UUID
) -> BulkCreateQuestionsResult:
    """Create many questions in one flush while preserving provided relations."""
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

    created_questions: list[Question] = []
    created_question_inputs: list[QuestionCreate] = []
    existing = 0
    for data in questions:
        signature = _question_duplicate_signature(data)
        if signature in existing_signatures:
            existing += 1
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
        created_questions.append(question)
        created_question_inputs.append(data)
        existing_signatures.add(signature)

    db.add_all(created_questions)
    await db.flush()
    return BulkCreateQuestionsResult(
        created_question_ids=[question.id for question in created_questions],
        created_questions=created_question_inputs,
        existing=existing,
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
        .options(selectinload(Question.knowledge_points))
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
            candidates = await _load_root_descendant_knowledge_points(db, root_knowledge_point_id)
            question_payloads = [QuestionCreate.model_validate(question) for question in questions]
            question_ids = [uuid.UUID(question_id) for question_id in job.created_question_ids]
            questions_by_id = await _load_questions_for_import_job(db, question_ids)

            for question_id, question_data in zip(question_ids, question_payloads):
                question = questions_by_id.get(question_id)
                if question is None:
                    failed_count += 1
                    processed_count += 1
                    error_message = error_message or f"question {question_id} not found"
                    continue

                try:
                    matched_ids = await match_knowledge_points_with_ai(question_data, candidates)
                    existing_ids = {kp.id for kp in question.knowledge_points}
                    merged_ids = list(dict.fromkeys([*existing_ids, *matched_ids]))
                    if merged_ids:
                        matched_kps_result = await db.execute(
                            select(KnowledgePoint).where(KnowledgePoint.id.in_(merged_ids))
                        )
                        question.knowledge_points = list(matched_kps_result.scalars().all())
                    if matched_ids:
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


async def match_knowledge_points_with_ai(
    question: QuestionCreate, candidates: list[KnowledgePoint]
) -> list[uuid.UUID]:
    """Use AI to pick the most relevant knowledge points; returns ids (possibly empty)."""
    if not candidates:
        return []
    candidates_payload = [
        {
            "id": str(kp.id),
            "name": kp.name,
            "description": (kp.description or "").strip()[:200],
        }
        for kp in candidates
    ]
    content_text = ""
    if isinstance(question.content, dict):
        content_text = str(question.content.get("text") or question.content.get("html") or "").strip()
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
        update={"knowledge_point_ids": list({*question_data.knowledge_point_ids, *matched_ids})}
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


async def save_generated_questions_to_default_course_bank(
    db: AsyncSession,
    questions: list[QuestionCreate],
    user_id: uuid.UUID,
) -> BulkCreateQuestionsResult:
    bank = await get_or_create_named_private_question_bank(
        db,
        user_id=user_id,
        name="课程题库",
        description="课程学习资料关联的智能出题结果",
    )
    scoped_questions = [
        question.model_copy(update={"question_bank_id": bank.id})
        for question in questions
    ]
    return await bulk_create_questions(db, scoped_questions, user_id)

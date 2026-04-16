"""CRUD service functions for Question, Tag, and KnowledgePoint."""

import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.auth.models import User
from app.common.data_visibility import VisibilityScope
from app.common.resource_access import teacher_owned_resource_filter, teacher_visible_resource_filter
from app.config import settings
from app.questions.models import KnowledgePoint, Question, QuestionBank, Tag, question_tags
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
    QuestionImportRecognizeResponse,
    QuestionCreate,
    QuestionImportAnalyzeResponse,
    QuestionUpdate,
    TagCreate,
    TagUpdate,
)


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


# --- Question ---

def _question_scope_query(*, user: User | None, is_platform_admin: bool) -> Select:
    query = select(Question).where(Question.deleted_at.is_(None))
    if not is_platform_admin and user is not None:
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


_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
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
                "temperature": 0.4,
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
    re.compile(r"^\s*(\d+[\.．\)）]|[\(\（]\d+[\)）]|\[\d+\]|【\d+】|\d+、)\s*"),
    re.compile(r"^\s*([一二三四五六七八九十]+[、\.．])\s*"),
    re.compile(r"^\s*(单选题|单选|多选题|多选|选择题|判断题|判断|填空题|填空|简答题|简答|编程题|编程|论述题|论述)\b"),
]


@dataclass(slots=True)
class SegmentedBlock:
    raw_text: str
    segment_source: str = "rule"
    boundary_confidence: str = "high"


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


def _split_block_when_question_restarts(block_text: str) -> list[str]:
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
            and seen_tail_marker
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
            r"^\[?(单选题|单选|多选题|多选|选择题|判断题|判断|填空题|填空|简答题|简答|编程题|编程|论述题|论述)\]?",
            stripped,
        )
    )


def _block_looks_like_question_candidate(block_text: str) -> bool:
    lines = [line.strip() for line in block_text.splitlines() if line.strip()]
    return bool(_is_explicit_typed_question_start(block_text) or len(_extract_options(lines)) >= 2)


def segment_question_document(raw_text: str) -> list[SegmentedBlock]:
    """Segment non-template text into candidate question blocks."""
    paragraph_blocks = _split_document_into_blocks(raw_text)
    blocks: list[SegmentedBlock] = []
    current: list[str] = []
    current_confidence = "high"
    current_has_tail_marker = False
    current_tail_field_type: str | None = None

    for block in paragraph_blocks:
        sub_blocks = _split_block_when_question_restarts(block.text)
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
                and (current_has_tail_marker or _is_explicit_typed_question_start(stripped))
            )
            if should_start_new:
                text = "\n".join(part for part in current if part.strip()).strip()
                if text:
                    blocks.append(SegmentedBlock(raw_text=text, boundary_confidence=current_confidence))
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
            blocks.append(SegmentedBlock(raw_text=text, boundary_confidence=current_confidence))

    return blocks


def _strip_question_start_prefix(text: str) -> str:
    next_text = text
    for pattern in _QUESTION_START_PATTERNS[:2]:
        next_text = pattern.sub("", next_text, count=1).strip()
    return next_text


def _extract_options(lines: list[str]) -> dict[str, str]:
    options: dict[str, str] = {}
    for line in lines:
        match = re.match(r"^([A-H])[\.．、\)]\s*(.+)$", line, re.IGNORECASE)
        if match:
            options[match.group(1).upper()] = match.group(2).strip()
    return options


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
    if re.search(r"(单选题|单选|多选题|多选|选择题)", raw_text):
        return "choice", "high"
    if re.search(r"(判断题|判断)", raw_text) or re.fullmatch(
        r"(正确|错误|对|错|√|×|T|F|True|False)", answer_text.strip(), re.IGNORECASE
    ):
        return "true_false", "high"
    if re.search(r"(_{2,}|（\s*）|\(\s*\)|【\s*】|\[\s*\])", raw_text):
        return "fill_in", "high"
    if re.search(r"(编程题|程序设计|实现函数|编写程序|示例输入|示例输出|```)", raw_text, re.IGNORECASE):
        return "code", "high"
    if re.search(r"(论述题|论述|阐述|分析并评价|结合实际谈谈)", raw_text):
        return "essay", "medium"
    if len(options) >= 2:
        return "choice", "medium"
    return "short_answer", "medium"


def _is_standalone_question_type_line(line: str) -> bool:
    return bool(
        re.fullmatch(
            r"(单选题|单选|多选题|多选|选择题|判断题|判断|填空题|填空|简答题|简答|编程题|编程|论述题|论述)",
            line.strip(),
        )
    )


def build_import_draft_from_segment(
    raw_text: str,
    *,
    segment_source: str = "rule",
    boundary_confidence: str = "high",
    images: list[QuestionImportImageInput] | None = None,
    comparison_flags: list[str] | None = None,
) -> QuestionImportDraft:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    options = _extract_options(lines)
    answer_text = ""
    analysis = ""
    difficulty_text = ""
    content_lines: list[str] = []

    for line in lines:
        answer_match = re.match(r"^(?:\[(答案|参考答案)\]|(答案|参考答案|answer))[:：]?\s*(.+)$", line, re.IGNORECASE)
        analysis_match = re.match(r"^(?:\[(解析|分析)\]|(解析|分析|analysis))[:：]?\s*(.+)$", line, re.IGNORECASE)
        difficulty_match = re.match(r"^(?:\[(难度|难易度)\]|(难度|难易度|difficulty))[:：]?\s*(.+)$", line, re.IGNORECASE)
        option_match = re.match(r"^([A-H])[\.．、\)]\s*(.+)$", line, re.IGNORECASE)
        if answer_match:
            answer_text = answer_match.group(3).strip()
        elif analysis_match:
            analysis = analysis_match.group(3).strip()
        elif difficulty_match:
            difficulty_text = difficulty_match.group(3).strip()
        elif _is_standalone_question_type_line(line):
            continue
        elif not option_match:
            content_lines.append(_strip_question_start_prefix(line))

    content_text = "\n".join(line for line in content_lines if line).strip()
    question_type, type_confidence = _detect_question_type(content_text or raw_text, options, answer_text)
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


def _build_rule_based_drafts(payload: QuestionImportDocumentRecognizeRequest, mode: str) -> list[QuestionImportDraft]:
    if mode == ImportRecognitionMode.TEMPLATE.value:
        drafts = parse_template_document(payload.raw_text)
    else:
        drafts = [
            build_import_draft_from_segment(
                segment.raw_text,
                segment_source=segment.segment_source,
                boundary_confidence=segment.boundary_confidence,
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


def _build_document_ai_prompt(raw_text: str, images: list[QuestionImportImageInput]) -> str:
    image_lines = "\n".join(
        f"- {image.image_id}: {image.url} (order={image.order}, page={image.page or 'unknown'}, alt={image.alt or ''})"
        for image in images
    )
    return f"""
你是一名中文题库导入助手。请分析整份导入文档，并只输出合法 JSON。

要求：
1. 你会收到整份题目文本与图片列表。
2. 必须按题目拆分 questions 数组。
3. 每道题输出 type、content_text、options、answer_text、analysis、difficulty、raw_text、images。
4. answer_text 没有时返回空字符串，不要臆造。
5. difficulty 必须是 1 到 5 的整数。
6. images 字段填写与题目相关的 image_id 数组。
7. 不要输出解释、Markdown 或代码块。

图片列表：
{image_lines or "无"}

原始文本：
{raw_text}
"""


def _validate_ai_document_questions(data: dict) -> list[dict]:
    questions = data.get("questions")
    if not isinstance(questions, list) or not questions:
        raise RuntimeError("AI 分析结果格式异常，请重试")
    validated: list[dict] = []
    for item in questions:
        if not isinstance(item, dict):
            raise RuntimeError("AI 分析结果格式异常，请重试")
        raw_type = str(item.get("type", "")).strip()
        if raw_type not in _VALID_QUESTION_TYPES:
            raise RuntimeError("AI 分析结果格式异常，请重试")
        difficulty = item.get("difficulty", 3)
        try:
            safe_difficulty = max(1, min(5, int(difficulty)))
        except (TypeError, ValueError) as exc:
            raise RuntimeError("AI 分析结果格式异常，请重试") from exc
        validated.append(
            {
                "type": raw_type,
                "content_text": str(item.get("content_text", "")).strip(),
                "options": item.get("options") if isinstance(item.get("options"), dict) else None,
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
        if "count_mismatch" in next_flags and "AI识别题目数量与规则识别不一致" not in next_issues:
            next_issues.append("AI识别题目数量与规则识别不一致")
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
    prompt = _build_document_ai_prompt(payload.raw_text, payload.images)
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
) -> QuestionImportDocumentSummary:
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
    )


async def recognize_question_document(
    payload: QuestionImportDocumentRecognizeRequest,
) -> QuestionImportDocumentRecognizeResponse:
    mode = (
        ImportRecognitionMode.TEMPLATE.value
        if payload.prefer_template
        else detect_import_template_mode(payload.raw_text)
    )
    drafts = _build_rule_based_drafts(payload, mode)
    if payload.analysis_mode == QuestionImportAnalysisMode.AI_FULL:
        completed = await recognize_question_document_with_ai(payload, drafts)
    else:
        completed = [await complete_import_draft_with_ai(draft) for draft in drafts]
    unique_drafts, duplicates_removed = deduplicate_drafts(completed)
    return QuestionImportDocumentRecognizeResponse(
        mode=mode,  # type: ignore[arg-type]
        summary=build_import_document_summary(unique_drafts, duplicates_removed),
        drafts=unique_drafts,
    )


async def recognize_imported_question(raw_text: str) -> QuestionImportRecognizeResponse:
    prompt = f"""
你是一名中文题库导入助手。请把下面原始题目文本识别为结构化 JSON。

识别规则：
1. 判断题：通常是一段文本，后面可能出现打勾/打叉、T/F、True/False、正确/错误、对/错。
2. 选择题：通常有 4 个选项，但可能少一个或多一个；答案如果存在，通常是文末的英文字母。
3. 填空题：题干中通常有一个或多个下划线、括号空位（如 ____、（ ）、()）。
4. 简答题：一般就是一段题目文本，没有明确选项和填空结构。
5. 论述题：要求考生展开论述、分析或评价某一主题，篇幅较长。
6. 编程题：要求编写代码，通常含有代码块或编程相关描述。
7. 如果答案没有给出，answer_text 返回空字符串即可，不要臆造答案。
8. 必须只输出合法 JSON，不要输出解释。

请返回 JSON 对象，字段如下：
type: choice | true_false | fill_in | short_answer | essay | code
content_text: 完整题目内容
options: 仅选择题返回对象，如 {{"A":"选项1","B":"选项2"}}
answer_text: 识别到的答案，没有就返回空字符串

原始文本：
{raw_text}
"""

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


async def bulk_create_questions(
    db: AsyncSession, questions: list[QuestionCreate], user_id: uuid.UUID
) -> int:
    """Atomically create multiple questions; rolls back all on any failure."""
    for data in questions:
        await create_question(db, data, user_id)
    return len(questions)


async def get_or_create_ai_question_bank(
    db: AsyncSession, user_id: uuid.UUID
) -> uuid.UUID:
    """Get or create the 'AI题库' question bank for the user."""
    result = await db.execute(
        select(QuestionBank).where(
            QuestionBank.name == "AI题库", QuestionBank.owner_id == user_id
        )
    )
    bank = result.scalar_one_or_none()
    if bank:
        return bank.id
    bank = QuestionBank(
        name="AI题库",
        description="AI自动生成的题目",
        owner_id=user_id,
        visibility=VisibilityScope.PRIVATE,
    )
    db.add(bank)
    await db.flush()
    return bank.id

"""CRUD service functions for Question, Tag, and KnowledgePoint."""

import json
import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import settings
from app.questions.models import KnowledgePoint, Question, QuestionBank, Tag, question_tags
from app.questions.schemas import (
    ImportedQuestionDraft,
    KnowledgePointCreate,
    QuestionBankCreate,
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

async def list_knowledge_points(db: AsyncSession) -> list[KnowledgePoint]:
    result = await db.execute(
        select(KnowledgePoint).where(KnowledgePoint.deleted_at.is_(None)).order_by(KnowledgePoint.name)
    )
    return list(result.scalars().all())


async def create_knowledge_point(db: AsyncSession, data: KnowledgePointCreate) -> KnowledgePoint:
    kp = KnowledgePoint(name=data.name, parent_id=data.parent_id, description=data.description)
    db.add(kp)
    await db.flush()
    await db.refresh(kp)
    return kp


# --- QuestionBank ---

async def list_question_banks(db: AsyncSession) -> tuple[list[dict], int]:
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
        .order_by(QuestionBank.name)
    )
    result = await db.execute(stmt)
    rows = result.all()

    no_bank_result = await db.execute(
        select(func.count()).select_from(Question).where(
            Question.deleted_at.is_(None), Question.question_bank_id.is_(None)
        )
    )
    no_bank_count = no_bank_result.scalar_one()

    return [{"bank": row[0], "question_count": row[1]} for row in rows], no_bank_count


async def create_question_bank(db: AsyncSession, data: QuestionBankCreate) -> QuestionBank:
    qb = QuestionBank(name=data.name, description=data.description)
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

def _question_base_query() -> select:
    return (
        select(Question)
        .where(Question.deleted_at.is_(None))
        .options(
            joinedload(Question.creator),
            joinedload(Question.question_bank),
            joinedload(Question.tags),
            joinedload(Question.knowledge_points),
        )
    )


async def get_question_by_id(db: AsyncSession, question_id: uuid.UUID) -> Question | None:
    result = await db.execute(_question_base_query().where(Question.id == question_id))
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

    return await get_question_by_id(db, question.id)  # type: ignore[return-value]


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
    return await get_question_by_id(db, question.id)  # type: ignore[return-value]


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

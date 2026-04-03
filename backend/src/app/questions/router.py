"""Question, Tag, and KnowledgePoint API routers."""

import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles, user_has_role
from app.auth.models import User
from app.common.pagination import PaginationParams, apply_filters, apply_pagination, get_total_count, parse_filters, parse_pagination
from app.database import get_db
from app.questions.models import Question
from app.questions.models import question_tags
from app.questions.schemas import (
    KnowledgePointCreate,
    KnowledgePointResponse,
    QuestionBankCreate,
    QuestionBankResponse,
    QuestionBulkCreateRequest,
    QuestionBulkCreateResponse,
    QuestionImportRecognizeRequest,
    QuestionImportRecognizeResponse,
    QuestionCreate,
    QuestionImportAnalyzeRequest,
    QuestionImportAnalyzeResponse,
    QuestionResponse,
    QuestionUpdate,
    TagCreate,
    TagResponse,
    TagUpdate,
)
from app.questions.service import (
    bulk_create_questions,
    create_knowledge_point,
    create_question,
    create_question_bank,
    create_tag,
    delete_tag,
    get_question_bank_by_id,
    get_question_by_id,
    get_tag_by_id,
    analyze_imported_question,
    recognize_imported_question,
    list_knowledge_points,
    list_question_banks,
    list_tags,
    soft_delete_question,
    soft_delete_question_bank,
    update_question,
    update_tag,
)

questions_router = APIRouter()
tags_router = APIRouter()
knowledge_points_router = APIRouter()
question_banks_router = APIRouter()


# --- Questions ---

@questions_router.get("", response_model=list[QuestionResponse])
async def list_questions(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    pagination: Annotated[PaginationParams, Depends(parse_pagination)],
    _user: CurrentUser,
) -> list[QuestionResponse]:
    from app.questions.service import _question_base_query

    base_query = select(Question).where(Question.deleted_at.is_(None))
    filters = parse_filters(request, Question)

    # Handle question_bank_id=__none__ as IS NULL filter
    qb_none = False
    qb_id = filters.get("question_bank_id")
    if qb_id == "__none__":
        filters.pop("question_bank_id")
        qb_none = True
        base_query = base_query.where(Question.question_bank_id.is_(None))

    # Handle tag_id filter via M2M join (supports comma-separated for multi-select)
    tag_id_raw = filters.pop("tag_id", None)
    tag_ids: list[str] = []
    if tag_id_raw:
        tag_ids = [v.strip() for v in tag_id_raw.split(",") if v.strip()]

    if tag_ids:
        base_query = base_query.join(question_tags).where(question_tags.c.tag_id.in_(tag_ids))

    filtered_query = apply_filters(base_query, filters, Question)

    total = await get_total_count(db, filtered_query)
    response.headers["X-Total-Count"] = str(total)

    full_query = _question_base_query()
    if qb_none:
        full_query = full_query.where(Question.question_bank_id.is_(None))
    if tag_ids:
        full_query = full_query.join(question_tags).where(question_tags.c.tag_id.in_(tag_ids))
    full_query = apply_filters(full_query, filters, Question)
    full_query = apply_pagination(full_query, pagination, Question)

    result = await db.execute(full_query)
    questions = result.unique().scalars().all()
    return [QuestionResponse.from_question(q) for q in questions]


@questions_router.get("/{question_id}", response_model=QuestionResponse)
async def get_question(
    question_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> QuestionResponse:
    question = await get_question_by_id(db, question_id)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return QuestionResponse.from_question(question)


@questions_router.post("", response_model=QuestionResponse, status_code=status.HTTP_201_CREATED)
async def create_question_endpoint(
    data: QuestionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "teacher")],
) -> QuestionResponse:
    question = await create_question(db, data, user.id)
    return QuestionResponse.from_question(question)


@questions_router.put("/{question_id}", response_model=QuestionResponse)
async def update_question_endpoint(
    question_id: uuid.UUID,
    data: QuestionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> QuestionResponse:
    question = await get_question_by_id(db, question_id)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    updated = await update_question(db, question, data)
    return QuestionResponse.from_question(updated)


@questions_router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question_endpoint(
    question_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> None:
    question = await get_question_by_id(db, question_id)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    await soft_delete_question(db, question)


@questions_router.post("/import/analyze", response_model=QuestionImportAnalyzeResponse)
async def analyze_imported_question_endpoint(
    data: QuestionImportAnalyzeRequest,
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> QuestionImportAnalyzeResponse:
    try:
        return await analyze_imported_question(data.question)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI 返回格式无效：{exc}") from exc


@questions_router.post("/import/recognize", response_model=QuestionImportRecognizeResponse)
async def recognize_imported_question_endpoint(
    data: QuestionImportRecognizeRequest,
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> QuestionImportRecognizeResponse:
    try:
        return await recognize_imported_question(data.raw_text)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI 返回格式无效：{exc}") from exc


@questions_router.post("/bulk", response_model=QuestionBulkCreateResponse, status_code=status.HTTP_201_CREATED)
async def bulk_create_questions_endpoint(
    data: QuestionBulkCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "teacher")],
) -> QuestionBulkCreateResponse:
    created = await bulk_create_questions(db, data.questions, user.id)
    return QuestionBulkCreateResponse(created=created)


# --- Tags ---

@tags_router.get("", response_model=list[TagResponse])
async def list_tags_endpoint(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
    pagination: Annotated[PaginationParams, Depends(parse_pagination)],
    question_bank_id: str | None = None,
) -> list[TagResponse]:
    from app.questions.models import Tag
    from sqlalchemy import func, select

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

    filters = parse_filters(request, Tag)
    # question_bank_id is handled via the count subquery, not as a Tag column filter
    filters.pop("question_bank_id", None)

    base_query = (
        select(Tag)
        .where(Tag.deleted_at.is_(None))
    )
    filtered_query = apply_filters(base_query, filters, Tag)
    total = await get_total_count(db, filtered_query)
    response.headers["X-Total-Count"] = str(total)

    full_query = (
        select(Tag, func.coalesce(count_subq.c.cnt, 0).label("question_count"))
        .outerjoin(count_subq, Tag.id == count_subq.c.tag_id)
        .where(Tag.deleted_at.is_(None))
    )
    full_query = apply_filters(full_query, filters, Tag)
    full_query = apply_pagination(full_query, pagination, Tag)

    result = await db.execute(full_query)
    rows = result.all()
    return [
        TagResponse(
            **{**TagResponse.model_validate(row[0]).model_dump(), "question_count": row[1]}
        )
        for row in rows
    ]


@tags_router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag_endpoint(
    data: TagCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> TagResponse:
    from app.questions.models import TagType
    if data.type != TagType.CUSTOM:
        # Standard tags require admin or teacher role via RBAC
        if not await user_has_role(db, user.id, "platform_admin", "school_admin", "teacher"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    tag = await create_tag(db, data)
    return TagResponse.model_validate(tag)


@tags_router.patch("/{tag_id}", response_model=TagResponse)
async def update_tag_endpoint(
    tag_id: uuid.UUID,
    data: TagUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> TagResponse:
    from app.questions.models import TagType
    existing = await get_tag_by_id(db, tag_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if existing.type != TagType.CUSTOM:
        if not await user_has_role(db, user.id, "platform_admin", "school_admin", "teacher"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    tag = await update_tag(db, tag_id, data)
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    return TagResponse.model_validate(tag)


@tags_router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag_endpoint(
    tag_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    from app.questions.models import TagType
    existing = await get_tag_by_id(db, tag_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if existing.type != TagType.CUSTOM:
        if not await user_has_role(db, user.id, "platform_admin", "school_admin", "teacher"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    await delete_tag(db, tag_id)


# --- KnowledgePoints ---

@knowledge_points_router.get("", response_model=list[KnowledgePointResponse])
async def list_knowledge_points_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> list[KnowledgePointResponse]:
    kps = await list_knowledge_points(db)
    return [KnowledgePointResponse.model_validate(kp) for kp in kps]


@knowledge_points_router.post("", response_model=KnowledgePointResponse, status_code=status.HTTP_201_CREATED)
async def create_knowledge_point_endpoint(
    data: KnowledgePointCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> KnowledgePointResponse:
    kp = await create_knowledge_point(db, data)
    return KnowledgePointResponse.model_validate(kp)


# --- QuestionBanks ---

@question_banks_router.get("", response_model=list[QuestionBankResponse])
async def list_question_banks_endpoint(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> list[QuestionBankResponse]:
    rows, no_bank_count = await list_question_banks(db)
    response.headers["X-No-Bank-Count"] = str(no_bank_count)
    return [
        QuestionBankResponse(
            **{**QuestionBankResponse.model_validate(row["bank"]).model_dump(), "question_count": row["question_count"]}
        )
        for row in rows
    ]


@question_banks_router.post("", response_model=QuestionBankResponse, status_code=status.HTTP_201_CREATED)
async def create_question_bank_endpoint(
    data: QuestionBankCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> QuestionBankResponse:
    bank = await create_question_bank(db, data)
    return QuestionBankResponse.model_validate(bank)


@question_banks_router.delete("/{bank_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question_bank_endpoint(
    bank_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> None:
    bank = await get_question_bank_by_id(db, bank_id)
    if bank is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question bank not found")
    await soft_delete_question_bank(db, bank)

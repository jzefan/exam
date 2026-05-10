"""Question, Tag, and KnowledgePoint API routers."""

import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles, user_has_role
from app.auth.models import User
from app.common.pagination import PaginationParams, apply_filters, apply_pagination, get_total_count, parse_filters, parse_pagination
from app.common.resource_access import can_read_shared_resource, can_write_owned_resource, teacher_visible_resource_filter
from app.database import get_db
from app.questions.models import KnowledgePoint, Question, QuestionImportJobStatus
from app.questions.models import question_knowledge_points, question_tags
from app.questions.schemas import (
    KnowledgePointCreate,
    KnowledgePointResponse,
    QuestionBankCreate,
    QuestionBankResponse,
    QuestionBankClearResponse,
    QuestionBulkCreateRequest,
    QuestionBulkCreateResponse,
    SaveGeneratedToCourseBankRequest,
    SaveGeneratedToCourseBankResponse,
    QuestionBulkDeleteRequest,
    QuestionBulkDeleteResponse,
    QuestionBulkMoveRequest,
    QuestionBulkMoveResponse,
    QuestionImportMatchCreateRequest,
    QuestionImportMatchCreateResponse,
    QuestionImportDocumentRecognizeRequest,
    QuestionImportDocumentRecognizeResponse,
    QuestionImportDraft,
    QuestionImportBulkCreateJobRequest,
    QuestionImportBulkCreateJobResponse,
    QuestionImportJobResponse,
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
    bulk_create_questions_fast,
    clear_question_bank_questions,
    match_and_create_import_question,
    create_knowledge_point,
    create_question,
    create_question_bank,
    create_tag,
    delete_tag,
    get_question_bank_by_id,
    get_question_by_id,
    get_tag_by_id,
    get_or_create_named_private_question_bank,
    analyze_imported_question,
    build_import_draft_from_segment,
    complete_import_draft_with_ai,
    recognize_question_document,
    recognize_imported_question,
    list_knowledge_points,
    list_question_banks,
    create_question_import_job,
    get_question_import_job_by_id,
    process_question_import_job,
    list_tags,
    save_generated_questions_to_default_course_bank,
    soft_delete_question,
    soft_delete_question_bank,
    update_question,
    update_tag,
)

questions_router = APIRouter()
tags_router = APIRouter()
knowledge_points_router = APIRouter()
question_banks_router = APIRouter()


async def _is_question_admin(db: AsyncSession, user: User) -> bool:
    return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin")


async def _ensure_can_write_question_bank(
    db: AsyncSession,
    bank_id: uuid.UUID | None,
    user: User,
    is_admin: bool,
) -> None:
    if bank_id is None:
        return
    bank = await get_question_bank_by_id(db, bank_id)
    if bank is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question bank not found")
    if not can_read_shared_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=bank.owner_id,
        visibility=bank.visibility,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question bank not found")
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=bank.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this question bank")


async def _get_visible_knowledge_point_or_404(
    db: AsyncSession,
    knowledge_point_id: uuid.UUID,
    user: User,
    is_admin: bool,
) -> KnowledgePoint:
    stmt = select(KnowledgePoint).where(
        KnowledgePoint.id == knowledge_point_id,
        KnowledgePoint.deleted_at.is_(None),
    )
    if not is_admin:
        stmt = stmt.where(teacher_visible_resource_filter(KnowledgePoint, user.id))
    kp = (await db.execute(stmt)).scalar_one_or_none()
    if kp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge point not found")
    return kp


async def _ensure_can_write_knowledge_point(
    db: AsyncSession,
    knowledge_point_id: uuid.UUID | None,
    user: User,
    is_admin: bool,
) -> None:
    if knowledge_point_id is None:
        return
    kp = await _get_visible_knowledge_point_or_404(db, knowledge_point_id, user, is_admin)
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=kp.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this knowledge point")


async def _ensure_can_read_knowledge_points(
    db: AsyncSession,
    knowledge_point_ids: list[uuid.UUID],
    user: User,
    is_admin: bool,
) -> None:
    if not knowledge_point_ids:
        return
    requested_ids = set(knowledge_point_ids)
    stmt = select(KnowledgePoint.id).where(
        KnowledgePoint.id.in_(requested_ids),
        KnowledgePoint.deleted_at.is_(None),
    )
    if not is_admin:
        stmt = stmt.where(teacher_visible_resource_filter(KnowledgePoint, user.id))
    visible_ids = set((await db.execute(stmt)).scalars().all())
    if visible_ids != requested_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge point not found")


def _parse_uuid_filter(value: str, field_name: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field_name}",
        ) from exc


def _parse_uuid_list_filter(value: str, field_name: str) -> list[uuid.UUID]:
    return [_parse_uuid_filter(item.strip(), field_name) for item in value.split(",") if item.strip()]


# --- Questions ---

@questions_router.get("", response_model=list[QuestionResponse])
async def list_questions(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    pagination: Annotated[PaginationParams, Depends(parse_pagination)],
    user: CurrentUser,
) -> list[QuestionResponse]:
    from app.questions.service import _question_base_query, _question_scope_query

    is_admin = await _is_question_admin(db, user)

    base_query = _question_scope_query(user=user, is_platform_admin=is_admin)
    filters = parse_filters(request, Question)

    # Handle question_bank_id=__none__ as IS NULL filter
    qb_none = False
    qb_id = filters.pop("question_bank_id", None)
    question_bank_id = None
    if qb_id == "__none__":
        qb_none = True
        base_query = base_query.where(Question.question_bank_id.is_(None))
    elif qb_id:
        question_bank_id = _parse_uuid_filter(qb_id, "question_bank_id")
        base_query = base_query.where(Question.question_bank_id == question_bank_id)

    # Handle tag_id filter via M2M join (supports comma-separated for multi-select)
    tag_id_raw = filters.pop("tag_id", None)
    tag_ids: list[uuid.UUID] = []
    if tag_id_raw:
        tag_ids = _parse_uuid_list_filter(tag_id_raw, "tag_id")

    knowledge_point_id_raw = filters.pop("knowledge_point_id", None)
    knowledge_point_id = (
        _parse_uuid_filter(knowledge_point_id_raw, "knowledge_point_id")
        if knowledge_point_id_raw
        else None
    )
    search_text = (filters.pop("search_text_like", None) or filters.pop("search_text", None) or "").strip()

    if tag_ids:
        base_query = base_query.join(question_tags).where(question_tags.c.tag_id.in_(tag_ids))
    if knowledge_point_id:
        base_query = base_query.join(question_knowledge_points).where(
            question_knowledge_points.c.knowledge_point_id == knowledge_point_id
        )
    if search_text:
        like_pattern = f"%{search_text}%"
        base_query = base_query.where(
            or_(
                Question.title.ilike(like_pattern),
                cast(Question.content, String).ilike(like_pattern),
                cast(Question.options, String).ilike(like_pattern),
            )
        )

    filtered_query = apply_filters(base_query, filters, Question)
    if tag_ids or knowledge_point_id:
        count_query = filtered_query.with_only_columns(func.count(func.distinct(Question.id))).order_by(None)
        total = (await db.execute(count_query)).scalar_one()
        filtered_query = filtered_query.distinct()
    else:
        total = await get_total_count(db, filtered_query)
    response.headers["X-Total-Count"] = str(total)

    full_query = _question_base_query(user=user, is_platform_admin=is_admin)
    if qb_none:
        full_query = full_query.where(Question.question_bank_id.is_(None))
    elif question_bank_id:
        full_query = full_query.where(Question.question_bank_id == question_bank_id)
    if tag_ids:
        full_query = full_query.join(question_tags).where(question_tags.c.tag_id.in_(tag_ids))
    if knowledge_point_id:
        full_query = full_query.join(question_knowledge_points).where(
            question_knowledge_points.c.knowledge_point_id == knowledge_point_id
        )
    if search_text:
        like_pattern = f"%{search_text}%"
        full_query = full_query.where(
            or_(
                Question.title.ilike(like_pattern),
                cast(Question.content, String).ilike(like_pattern),
                cast(Question.options, String).ilike(like_pattern),
            )
        )
    full_query = apply_filters(full_query, filters, Question)
    if tag_ids or knowledge_point_id:
        full_query = full_query.distinct()
    full_query = apply_pagination(full_query, pagination, Question)

    result = await db.execute(full_query)
    questions = result.unique().scalars().all()
    return [QuestionResponse.from_question(q) for q in questions]


@questions_router.get("/{question_id}", response_model=QuestionResponse)
async def get_question(
    question_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> QuestionResponse:
    is_admin = await _is_question_admin(db, user)
    question = await get_question_by_id(db, question_id, user=user, is_platform_admin=is_admin)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return QuestionResponse.from_question(question)


@questions_router.post("", response_model=QuestionResponse, status_code=status.HTTP_201_CREATED)
async def create_question_endpoint(
    data: QuestionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionResponse:
    is_admin = await _is_question_admin(db, user)
    await _ensure_can_write_question_bank(db, data.question_bank_id, user, is_admin)
    await _ensure_can_read_knowledge_points(db, data.knowledge_point_ids, user, is_admin)
    question = await create_question(db, data, user.id)
    return QuestionResponse.from_question(question)


@questions_router.put("/{question_id}", response_model=QuestionResponse)
async def update_question_endpoint(
    question_id: uuid.UUID,
    data: QuestionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionResponse:
    is_admin = await _is_question_admin(db, user)
    question = await get_question_by_id(db, question_id, user=user, is_platform_admin=is_admin)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=question.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this question")
    update_data = data.model_dump(exclude_unset=True)
    if "question_bank_id" in update_data:
        await _ensure_can_write_question_bank(db, data.question_bank_id, user, is_admin)
    if "knowledge_point_ids" in update_data and data.knowledge_point_ids is not None:
        await _ensure_can_read_knowledge_points(db, data.knowledge_point_ids, user, is_admin)
    updated = await update_question(db, question, data)
    return QuestionResponse.from_question(updated)


@questions_router.post("/bulk-delete", response_model=QuestionBulkDeleteResponse)
async def bulk_delete_questions_endpoint(
    data: QuestionBulkDeleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionBulkDeleteResponse:
    is_admin = await _is_question_admin(db, user)
    question_ids = list(dict.fromkeys(data.question_ids))
    questions: list[Question] = []
    for question_id in question_ids:
        question = await get_question_by_id(db, question_id, user=user, is_platform_admin=is_admin)
        if question is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Some questions were not found")
        if not can_write_owned_resource(
            is_platform_admin=is_admin,
            current_user_id=user.id,
            owner_id=question.owner_id,
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify some questions")
        questions.append(question)

    for question in questions:
        await soft_delete_question(db, question)

    return QuestionBulkDeleteResponse(deleted=len(questions))


@questions_router.post("/bulk-move", response_model=QuestionBulkMoveResponse)
async def bulk_move_questions_endpoint(
    data: QuestionBulkMoveRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionBulkMoveResponse:
    is_admin = await _is_question_admin(db, user)
    await _ensure_can_write_question_bank(db, data.question_bank_id, user, is_admin)

    question_ids = list(dict.fromkeys(data.question_ids))
    questions: list[Question] = []
    for question_id in question_ids:
        question = await get_question_by_id(db, question_id, user=user, is_platform_admin=is_admin)
        if question is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Some questions were not found")
        if not can_write_owned_resource(
            is_platform_admin=is_admin,
            current_user_id=user.id,
            owner_id=question.owner_id,
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify some questions")
        questions.append(question)

    for question in questions:
        question.question_bank_id = data.question_bank_id

    await db.flush()
    return QuestionBulkMoveResponse(moved=len(questions))


@questions_router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question_endpoint(
    question_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> None:
    is_admin = await _is_question_admin(db, user)
    question = await get_question_by_id(db, question_id, user=user, is_platform_admin=is_admin)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=question.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this question")
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
    _user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionImportRecognizeResponse:
    try:
        return await recognize_imported_question(data.raw_text)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"AI 返回格式无效：{exc}") from exc


@questions_router.post("/import/document-recognize", response_model=QuestionImportDocumentRecognizeResponse)
async def document_recognize_import_endpoint(
    data: QuestionImportDocumentRecognizeRequest,
    _user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionImportDocumentRecognizeResponse:
    try:
        return await recognize_question_document(data)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@questions_router.post("/import/re-recognize", response_model=QuestionImportDraft)
async def re_recognize_import_draft_endpoint(
    data: QuestionImportRecognizeRequest,
    _user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionImportDraft:
    draft = build_import_draft_from_segment(data.raw_text, boundary_confidence="low")
    return await complete_import_draft_with_ai(draft)


@questions_router.post("/bulk", response_model=QuestionBulkCreateResponse, status_code=status.HTTP_201_CREATED)
async def bulk_create_questions_endpoint(
    data: QuestionBulkCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionBulkCreateResponse:
    is_admin = await _is_question_admin(db, user)
    bank_ids = {question.question_bank_id for question in data.questions if question.question_bank_id is not None}
    for bank_id in bank_ids:
        await _ensure_can_write_question_bank(db, bank_id, user, is_admin)
    knowledge_point_ids = {
        knowledge_point_id
        for question in data.questions
        for knowledge_point_id in question.knowledge_point_ids
    }
    await _ensure_can_read_knowledge_points(db, list(knowledge_point_ids), user, is_admin)
    result = await bulk_create_questions(db, data.questions, user.id)
    return QuestionBulkCreateResponse(created=result.created, existing=result.existing, failed=result.failed)


@questions_router.post(
    "/save-generated-to-course-bank",
    response_model=SaveGeneratedToCourseBankResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_generated_to_course_bank_endpoint(
    data: SaveGeneratedToCourseBankRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> SaveGeneratedToCourseBankResponse:
    is_admin = await _is_question_admin(db, user)
    knowledge_point_ids = {
        knowledge_point_id
        for question in data.questions
        for knowledge_point_id in question.knowledge_point_ids
    }
    try:
        await _ensure_can_read_knowledge_points(db, list(knowledge_point_ids), user, is_admin)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No permission to read some knowledge points",
            ) from exc
        raise
    result = await save_generated_questions_to_default_course_bank(db, data.questions, user.id)
    return SaveGeneratedToCourseBankResponse(
        created=result.created,
        existing=result.existing,
        failed=result.failed,
        created_question_ids=[str(question_id) for question_id in result.created_question_ids],
    )


@questions_router.post(
    "/import/bulk-create-job",
    response_model=QuestionImportBulkCreateJobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_bulk_create_job_endpoint(
    data: QuestionImportBulkCreateJobRequest,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionImportBulkCreateJobResponse:
    is_admin = await _is_question_admin(db, user)
    bank_ids = {question.question_bank_id for question in data.questions if question.question_bank_id is not None}
    for bank_id in bank_ids:
        await _ensure_can_write_question_bank(db, bank_id, user, is_admin)
    root_knowledge_point_id = data.root_knowledge_point_id
    if root_knowledge_point_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="root_knowledge_point_id is required")
    knowledge_point_ids = {root_knowledge_point_id}
    knowledge_point_ids.update(
        knowledge_point_id
        for question in data.questions
        for knowledge_point_id in question.knowledge_point_ids
    )
    await _ensure_can_read_knowledge_points(db, list(knowledge_point_ids), user, is_admin)

    result = await bulk_create_questions_fast(db, data.questions, user.id)
    job = await create_question_import_job(db, user_id=user.id, total_count=result.created)
    job.created_question_ids = [str(question_id) for question_id in result.created_question_ids]
    await db.flush()
    await db.commit()

    if result.created_question_ids:
        background_tasks.add_task(
            process_question_import_job,
            job_id=job.id,
            user_id=user.id,
            root_knowledge_point_id=root_knowledge_point_id,
            questions=[question.model_dump() for question in result.created_questions],
        )
    else:
        job.status = QuestionImportJobStatus.COMPLETED
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()
    return QuestionImportBulkCreateJobResponse(
        job_id=job.id,
        created=result.created,
        existing=result.existing,
        failed=result.failed,
        status=job.status,
    )


@questions_router.get("/import/jobs/{job_id}", response_model=QuestionImportJobResponse)
async def get_question_import_job_endpoint(
    job_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> QuestionImportJobResponse:
    job = await get_question_import_job_by_id(db, job_id, user_id=user.id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question import job not found")
    return QuestionImportJobResponse.model_validate(job)


@questions_router.post(
    "/import/match-create",
    response_model=QuestionImportMatchCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_match_create_endpoint(
    data: QuestionImportMatchCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionImportMatchCreateResponse:
    is_admin = await _is_question_admin(db, user)
    await _ensure_can_write_question_bank(db, data.question.question_bank_id, user, is_admin)
    root_knowledge_point_id = data.root_knowledge_point_id
    if root_knowledge_point_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="root_knowledge_point_id is required")
    question, matched = await match_and_create_import_question(db, data.question, root_knowledge_point_id, user.id)
    return QuestionImportMatchCreateResponse(
        question_id=question.id,
        matched_knowledge_point_ids=[kp.id for kp in matched],
        matched_knowledge_point_names=[kp.name for kp in matched],
    )


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
    user: CurrentUser,
) -> list[KnowledgePointResponse]:
    is_admin = await _is_question_admin(db, user)
    kps = await list_knowledge_points(db, user=user, is_platform_admin=is_admin)
    return [KnowledgePointResponse.model_validate(kp) for kp in kps]


@knowledge_points_router.post("", response_model=KnowledgePointResponse, status_code=status.HTTP_201_CREATED)
async def create_knowledge_point_endpoint(
    data: KnowledgePointCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> KnowledgePointResponse:
    is_admin = await _is_question_admin(db, user)
    await _ensure_can_write_knowledge_point(db, data.parent_id, user, is_admin)
    kp = await create_knowledge_point(db, data, user.id)
    return KnowledgePointResponse.model_validate(kp)


# --- QuestionBanks ---

@question_banks_router.get("", response_model=list[QuestionBankResponse])
async def list_question_banks_endpoint(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[QuestionBankResponse]:
    is_admin = await _is_question_admin(db, user)
    rows, no_bank_count = await list_question_banks(db, user=user, is_platform_admin=is_admin)
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
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionBankResponse:
    bank = await create_question_bank(db, data, user.id)
    return QuestionBankResponse.model_validate(bank)


@question_banks_router.post("/ensure-course-bank", response_model=QuestionBankResponse)
async def ensure_course_question_bank_endpoint(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> QuestionBankResponse:
    bank = await get_or_create_named_private_question_bank(
        db,
        user_id=user.id,
        name="课程题库",
        description="课程学习资料关联的智能出题结果",
    )
    return QuestionBankResponse.model_validate(bank)


@question_banks_router.post("/{bank_id}/clear", response_model=QuestionBankClearResponse)
async def clear_question_bank_questions_endpoint(
    bank_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionBankClearResponse:
    is_admin = await _is_question_admin(db, user)
    bank = await get_question_bank_by_id(db, bank_id)
    if bank is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question bank not found")
    if not can_read_shared_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=bank.owner_id,
        visibility=bank.visibility,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question bank not found")
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=bank.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this question bank")

    result = await clear_question_bank_questions(db, bank)
    return QuestionBankClearResponse(**result)


@question_banks_router.delete("/{bank_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question_bank_endpoint(
    bank_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> None:
    is_admin = await _is_question_admin(db, user)
    bank = await get_question_bank_by_id(db, bank_id)
    if bank is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question bank not found")
    if not can_read_shared_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=bank.owner_id,
        visibility=bank.visibility,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question bank not found")
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=bank.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this question bank")
    await soft_delete_question_bank(db, bank)

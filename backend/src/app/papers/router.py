"""Paper API router."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles, user_has_role
from app.auth.models import User
from app.common.resource_access import can_write_owned_resource
from app.database import get_db
from app.papers.models import Paper
from app.papers.schemas import (
    PaperCreate,
    PaperDetailResponse,
    PaperExamSeedResponse,
    PaperQuestionItem,
    PaperQuestionResponse,
    PaperResponse,
    PaperUpdate,
)
from app.papers.schemas import (
    PaperImportConfirmRequest,
    PaperImportRecognizeRequest,
    PaperImportRecognizeResponse,
    PaperImportSessionResponse,
)
from app.papers.service import (
    archive_paper,
    confirm_import_session,
    create_import_session_from_recognition,
    create_paper,
    get_paper_by_id,
    get_import_session,
    list_papers_for_user,
    soft_delete_paper,
    update_paper,
)
from app.questions.schemas import QuestionResponse

router = APIRouter()
WriteUser = Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")]


async def _is_paper_admin(db: AsyncSession, user_id: uuid.UUID) -> bool:
    return await user_has_role(db, user_id, "platform_admin", "school_admin", "admin", "enterprise_admin")


def _paper_totals(paper: Paper) -> tuple[int, float]:
    items = sorted(paper.paper_questions or [], key=lambda item: item.order)
    total_score = 0.0
    for item in items:
        if item.score_override is not None:
            total_score += float(item.score_override)
        elif item.question is not None:
            total_score += float(item.question.score)
    return len(items), total_score


def build_paper_response(paper: Paper) -> PaperResponse:
    question_count, total_score = _paper_totals(paper)
    source_type = paper.source_type.value if hasattr(paper.source_type, "value") else paper.source_type
    return PaperResponse(
        id=paper.id,
        title=paper.title,
        description=paper.description,
        source_type=source_type,
        source_paper_id=paper.source_paper_id,
        root_knowledge_point_id=paper.root_knowledge_point_id,
        root_knowledge_point=paper.root_knowledge_point,
        is_reusable=paper.is_reusable,
        archived_at=paper.archived_at,
        question_count=question_count,
        total_score=total_score,
        owner_id=paper.owner_id,
        created_by=paper.created_by,
        created_by_name=paper.creator.full_name if paper.creator else "",
        created_at=paper.created_at,
        updated_at=paper.updated_at,
    )


def build_paper_detail_response(paper: Paper) -> PaperDetailResponse:
    base = build_paper_response(paper)
    questions = [
        PaperQuestionResponse(
            question_id=item.question_id,
            order=item.order,
            score_override=item.score_override,
            question=QuestionResponse.from_question(item.question) if item.question else None,
        )
        for item in sorted(paper.paper_questions, key=lambda item: item.order)
    ]
    return PaperDetailResponse(**base.model_dump(), questions=questions)


async def _get_visible_paper_or_404(db: AsyncSession, paper_id: uuid.UUID, user: User) -> Paper:
    is_admin = await _is_paper_admin(db, user.id)
    paper = await get_paper_by_id(db, paper_id, user=user, is_admin=is_admin)
    if paper is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    return paper


async def _get_writable_paper_or_404(db: AsyncSession, paper_id: uuid.UUID, user: User) -> Paper:
    paper = await _get_visible_paper_or_404(db, paper_id, user)
    is_admin = await _is_paper_admin(db, user.id)
    if not can_write_owned_resource(is_platform_admin=is_admin, current_user_id=user.id, owner_id=paper.owner_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this paper")
    return paper


def _raise_from_service_error(exc: ValueError) -> None:
    message = str(exc)
    if "not found or not visible" in message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message) from exc
    if "not writable" in message:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=message) from exc
    if "duplicate question" in message:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message) from exc
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message) from exc


@router.get("", response_model=list[PaperResponse])
async def list_papers(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[PaperResponse]:
    is_admin = await _is_paper_admin(db, user.id)
    papers, total = await list_papers_for_user(db, user=user, is_admin=is_admin)
    response.headers["X-Total-Count"] = str(total)
    return [build_paper_response(paper) for paper in papers]


@router.post("", response_model=PaperDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_paper_endpoint(
    body: PaperCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperDetailResponse:
    is_admin = await _is_paper_admin(db, user.id)
    try:
        paper = await create_paper(db, body, user=user, is_admin=is_admin)
    except ValueError as exc:
        _raise_from_service_error(exc)
    await db.commit()
    refreshed = await get_paper_by_id(db, paper.id, user=user, is_admin=is_admin)
    if refreshed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    return build_paper_detail_response(refreshed)


@router.post("/import/recognize", response_model=PaperImportRecognizeResponse)
async def recognize_paper_import(
    body: PaperImportRecognizeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperImportRecognizeResponse:
    try:
        session, recognition = await create_import_session_from_recognition(db, user=user, request=body)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return PaperImportRecognizeResponse(
        session_id=session.id,
        mode=recognition.mode.value if hasattr(recognition.mode, "value") else str(recognition.mode),
        summary=recognition.summary,
        drafts=recognition.drafts,
    )


@router.get("/import/sessions/{session_id}", response_model=PaperImportSessionResponse)
async def get_import_session_endpoint(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PaperImportSessionResponse:
    session = await get_import_session(db, session_id, user=user, is_admin=await _is_paper_admin(db, user.id))
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper import session not found")
    return PaperImportSessionResponse.model_validate(session)


@router.post("/import/sessions/{session_id}/confirm", response_model=PaperDetailResponse, status_code=status.HTTP_201_CREATED)
async def confirm_import_session_endpoint(
    session_id: uuid.UUID,
    body: PaperImportConfirmRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperDetailResponse:
    is_admin = await _is_paper_admin(db, user.id)
    session = await get_import_session(db, session_id, user=user, is_admin=is_admin)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper import session not found")
    try:
        paper = await confirm_import_session(db, session, body, user=user, is_admin=is_admin)
    except ValueError as exc:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        await db.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    await db.commit()
    refreshed = await get_paper_by_id(db, paper.id, user=user, is_admin=is_admin)
    if refreshed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    return build_paper_detail_response(refreshed)


@router.get("/{paper_id}", response_model=PaperDetailResponse)
async def get_paper_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PaperDetailResponse:
    paper = await _get_visible_paper_or_404(db, paper_id, user)
    return build_paper_detail_response(paper)


@router.get("/{paper_id}/exam-seed", response_model=PaperExamSeedResponse)
async def get_paper_exam_seed(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PaperExamSeedResponse:
    paper = await _get_visible_paper_or_404(db, paper_id, user)
    question_items: list[PaperQuestionItem] = []
    for item in sorted(paper.paper_questions, key=lambda value: value.order):
        if item.question is None:
            continue
        score_override = item.score_override if item.score_override is not None else item.question.score
        question_items.append(
            PaperQuestionItem(
                question_id=item.question_id,
                order=item.order,
                score_override=float(score_override) if score_override is not None else None,
            )
        )
    total_score = sum(float(item.score_override or 0) for item in question_items)
    return PaperExamSeedResponse(
        paper_id=paper.id,
        title=paper.title,
        description=paper.description,
        total_score=total_score,
        question_items=question_items,
    )


@router.patch("/{paper_id}", response_model=PaperDetailResponse)
async def update_paper_endpoint(
    paper_id: uuid.UUID,
    body: PaperUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperDetailResponse:
    is_admin = await _is_paper_admin(db, user.id)
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    try:
        await update_paper(db, paper, body, user=user, is_admin=is_admin)
    except ValueError as exc:
        _raise_from_service_error(exc)
    await db.commit()
    refreshed = await _get_visible_paper_or_404(db, paper_id, user)
    return build_paper_detail_response(refreshed)


@router.post("/{paper_id}/archive", response_model=PaperResponse)
async def archive_paper_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperResponse:
    is_admin = await _is_paper_admin(db, user.id)
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    await archive_paper(db, paper)
    await db.commit()
    refreshed = await get_paper_by_id(db, paper.id, user=user, is_admin=is_admin)
    if refreshed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    return build_paper_response(refreshed)


@router.delete("/{paper_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_paper_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> None:
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    await soft_delete_paper(db, paper)
    await db.commit()

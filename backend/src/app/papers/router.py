"""Paper API router."""

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles, user_has_role
from app.auth.models import User
from app.common.resource_access import can_write_owned_resource
from app.config import settings
from app.database import get_db
from app.exams.paper_export import build_paper_export, render_docx, render_pdf
from app.papers.models import Paper, PaperImportSession, PaperQuestionKnowledgeSuggestion
from app.papers.schemas import (
    PaperAIAppendRequest,
    PaperAIGenerateRequest,
    PaperAIGenerateResponse,
    PaperCreate,
    PaperDetailResponse,
    PaperExamSeedResponse,
    PaperQuestionItem,
    PaperQuestionResponse,
    PaperResponse,
    PaperKnowledgeRecognitionJobResponse,
    PaperKnowledgeRecognitionStartResponse,
    PaperKnowledgeSuggestionGenerateResponse,
    PaperUpdate,
)
from app.papers.schemas import (
    PaperImportConfirmRequest,
    PaperImportRecognizeRequest,
    PaperImportRecognizeResponse,
    PaperImportSessionResponse,
)
from app.papers.service import (
    append_ai_questions_to_paper,
    archive_paper,
    confirm_import_session,
    create_import_session_from_pdf_file,
    create_import_session_from_recognition,
    create_paper,
    extract_paper_import_file_content,
    generate_paper_from_source,
    generate_paper_virtual_knowledge_suggestions,
    get_paper_by_id,
    get_import_session,
    list_paper_question_knowledge_suggestions,
    list_papers_for_user,
    soft_delete_paper,
    update_paper,
)
from app.questions.schemas import QuestionResponse
from app.questions.docx_render import recognize_docx_visual
from app.questions.schemas import QuestionImportDocumentSummary as _QIDSummary
from app.questions.models import QuestionImportJobStatus, QuestionSource
from app.questions.service import (
    create_question_import_job,
    get_question_import_job_by_id,
    process_existing_question_knowledge_match_job,
)

router = APIRouter()
WriteUser = Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")]
_EXPORT_MEDIA_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


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


def build_paper_detail_response(
    paper: Paper,
    suggestions: list[PaperQuestionKnowledgeSuggestion] | None = None,
) -> PaperDetailResponse:
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
    return PaperDetailResponse(
        **base.model_dump(),
        questions=questions,
        knowledge_suggestions=suggestions or [],
    )


def _paper_root_only_imported_question_ids(paper: Paper) -> list[uuid.UUID]:
    root_id = paper.root_knowledge_point_id
    if root_id is None:
        return []
    question_ids: list[uuid.UUID] = []
    for item in sorted(paper.paper_questions, key=lambda question_item: question_item.order):
        question = item.question
        if question is None:
            continue
        source = question.source.value if hasattr(question.source, "value") else str(question.source)
        if source != QuestionSource.IMPORTED.value:
            continue
        knowledge_point_ids = [knowledge_point.id for knowledge_point in question.knowledge_points or []]
        if knowledge_point_ids == [root_id]:
            question_ids.append(question.id)
    return question_ids


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
    suggestions = await list_paper_question_knowledge_suggestions(db, refreshed.id)
    return build_paper_detail_response(refreshed, suggestions)


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


@router.post("/import/recognize-file", response_model=PaperImportRecognizeResponse)
async def recognize_paper_import_file(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
    file: Annotated[UploadFile, File(...)],
    prompt: Annotated[str | None, Form(max_length=2000)] = None,
    root_knowledge_point_id: Annotated[uuid.UUID | None, Form()] = None,
) -> PaperImportRecognizeResponse:
    try:
        file_name = file.filename or "paper"
        file_bytes = await file.read()
        if file_name.lower().endswith(".pdf"):
            session, recognition = await create_import_session_from_pdf_file(
                db,
                user=user,
                file_name=file_name,
                file_bytes=file_bytes,
                root_knowledge_point_id=root_knowledge_point_id,
                recognition_prompt=prompt,
            )
        else:
            raw_text, source_format = extract_paper_import_file_content(file_name, file_bytes)
            session, recognition = await create_import_session_from_recognition(
                db,
                user=user,
                request=PaperImportRecognizeRequest(
                    file_name=file_name,
                    raw_text=raw_text,
                    source_format=source_format,
                    root_knowledge_point_id=root_knowledge_point_id,
                    recognition_prompt=prompt,
                ),
            )
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


@router.post("/import/recognize-visual", response_model=PaperImportRecognizeResponse)
async def recognize_paper_import_visual(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
    file: Annotated[UploadFile, File(...)],
    prompt: Annotated[str | None, Form(max_length=2000)] = None,
) -> PaperImportRecognizeResponse:
    try:
        file_name = file.filename or "paper"
        file_bytes = await file.read()
        drafts, summary = await recognize_docx_visual(file_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    session = PaperImportSession(
        file_name=file_name,
        source_format="docx",
        root_knowledge_point_id=None,
        preview_payload={"drafts": [d.model_dump(mode="json") for d in drafts]},
        error_detail=None,
        created_by=user.id,
    )
    db.add(session)
    await db.flush()
    await db.commit()
    return PaperImportRecognizeResponse(
        session_id=session.id,
        mode="visual",
        summary=summary,
        drafts=drafts,
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
    suggestions = await list_paper_question_knowledge_suggestions(db, refreshed.id)
    return build_paper_detail_response(refreshed, suggestions)


@router.get("/{paper_id}", response_model=PaperDetailResponse)
async def get_paper_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PaperDetailResponse:
    paper = await _get_visible_paper_or_404(db, paper_id, user)
    suggestions = await list_paper_question_knowledge_suggestions(db, paper.id)
    return build_paper_detail_response(paper, suggestions)


@router.get("/{paper_id}/export")
async def export_paper_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    export_format: Annotated[Literal["docx", "pdf"], Query(alias="format")] = "docx",
    answers: bool = False,
) -> Response:
    """Export a reusable paper using the same standard layout as exams."""
    source_paper = await _get_visible_paper_or_404(db, paper_id, user)
    paper = await build_paper_export(
        db,
        source_paper,
        with_answers=answers,
        school_name=settings.exam_export_school_name,
        exam_form=settings.exam_export_form,
    )
    content = render_docx(paper) if export_format == "docx" else render_pdf(paper)

    variant = "（含答案）" if answers else "（空白）"
    name_parts = [part for part in (paper.course_name, paper.exam_title) if part]
    base = "-".join(name_parts) or "试卷"
    filename = f"{base}{variant}.{export_format}"
    disposition = f'attachment; filename="paper-{paper_id}.{export_format}"; ' f"filename*=UTF-8''{quote(filename)}"
    return Response(
        content=content,
        media_type=_EXPORT_MEDIA_TYPES[export_format],
        headers={"Content-Disposition": disposition},
    )


@router.post("/{paper_id}/knowledge-recognition", response_model=PaperKnowledgeRecognitionStartResponse)
async def start_paper_knowledge_recognition_endpoint(
    paper_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperKnowledgeRecognitionStartResponse:
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    if paper.root_knowledge_point_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Paper has no root knowledge point",
        )

    question_ids = _paper_root_only_imported_question_ids(paper)
    job = await create_question_import_job(db, user_id=user.id, total_count=len(question_ids))
    job.created_question_ids = [str(question_id) for question_id in question_ids]

    if question_ids:
        background_tasks.add_task(
            process_existing_question_knowledge_match_job,
            job_id=job.id,
            user_id=user.id,
            root_knowledge_point_id=paper.root_knowledge_point_id,
            question_ids=question_ids,
        )
    else:
        job.status = QuestionImportJobStatus.COMPLETED
        job.completed_at = datetime.now(timezone.utc)

    await db.commit()
    return PaperKnowledgeRecognitionStartResponse(
        job_id=job.id,
        status=job.status.value if hasattr(job.status, "value") else str(job.status),
        total_count=job.total_count,
        question_ids=question_ids,
    )


@router.get("/{paper_id}/knowledge-recognition/{job_id}", response_model=PaperKnowledgeRecognitionJobResponse)
async def get_paper_knowledge_recognition_job_endpoint(
    paper_id: uuid.UUID,
    job_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PaperKnowledgeRecognitionJobResponse:
    await _get_visible_paper_or_404(db, paper_id, user)
    job = await get_question_import_job_by_id(db, job_id, user_id=user.id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper knowledge recognition job not found")
    return PaperKnowledgeRecognitionJobResponse.model_validate(job)


@router.post("/{paper_id}/knowledge-suggestions", response_model=PaperKnowledgeSuggestionGenerateResponse)
async def generate_paper_knowledge_suggestions_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperKnowledgeSuggestionGenerateResponse:
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    suggestions = await generate_paper_virtual_knowledge_suggestions(db, paper, user_id=user.id)
    await db.commit()
    return PaperKnowledgeSuggestionGenerateResponse(suggestions=suggestions)


@router.post("/{paper_id}/ai-generate", response_model=PaperAIGenerateResponse)
async def ai_generate_paper_endpoint(
    paper_id: uuid.UUID,
    body: PaperAIGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperAIGenerateResponse:
    is_admin = await _is_paper_admin(db, user.id)
    source = await _get_writable_paper_or_404(db, paper_id, user)
    try:
        paper = await generate_paper_from_source(db, source, body, user=user, is_admin=is_admin)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    refreshed = await get_paper_by_id(db, paper.id, user=user, is_admin=is_admin)
    if refreshed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    return PaperAIGenerateResponse(
        paper_id=refreshed.id,
        generated_question_count=len(refreshed.paper_questions),
    )


@router.post("/{paper_id}/ai-append", response_model=PaperDetailResponse)
async def ai_append_paper_questions_endpoint(
    paper_id: uuid.UUID,
    body: PaperAIAppendRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: WriteUser,
) -> PaperDetailResponse:
    is_admin = await _is_paper_admin(db, user.id)
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    try:
        updated = await append_ai_questions_to_paper(db, paper, body, user=user, is_admin=is_admin)
    except ValueError as exc:
        _raise_from_service_error(exc)
    await db.commit()
    refreshed = await get_paper_by_id(db, updated.id, user=user, is_admin=is_admin)
    if refreshed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    suggestions = await list_paper_question_knowledge_suggestions(db, refreshed.id)
    return build_paper_detail_response(refreshed, suggestions)


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
    suggestions = await list_paper_question_knowledge_suggestions(db, refreshed.id)
    return build_paper_detail_response(refreshed, suggestions)


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

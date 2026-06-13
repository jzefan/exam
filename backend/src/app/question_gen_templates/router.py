"""HTTP routes for course question-generation templates."""

from __future__ import annotations

import json
import uuid
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.common.resource_access import teacher_visible_resource_filter
from app.database import get_db
from app.learning.models import KnowledgePoint
from app.question_gen_templates import service
from app.question_gen_templates.models import QuestionGenTemplate
from app.question_gen_templates.schemas import (
    RunSummary,
    SeedCompleteRequest,
    SeedCompleteResponse,
    TemplateChatRequest,
    TemplateCreate,
    TemplateGenerateRequest,
    TemplateMaterialResponse,
    TemplateResponse,
    TemplateSummary,
    TemplateUpdate,
)
from app.questions.ai_generate import generate_questions_stream
from app.questions.service import complete_seed_answer_analysis

course_templates_router = APIRouter(prefix="/api/teacher/courses", tags=["question-gen-templates"])
template_router = APIRouter(prefix="/api/question-gen-templates", tags=["question-gen-templates"])


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _to_response(template: QuestionGenTemplate) -> TemplateResponse:
    return TemplateResponse(
        id=template.id,
        course_kp_id=template.course_kp_id,
        name=template.name,
        description=template.description,
        is_default=template.is_default,
        student_profile=template.student_profile,
        seed_question_ids=[uuid.UUID(qid) for qid in (template.seed_question_ids or [])],
        manual_seed_questions=list(template.manual_seed_questions or []),
        gen_rules=template.gen_rules,
        materials=[
            TemplateMaterialResponse(
                id=m.id,
                resource_id=m.resource_id,
                resource_title=m.resource_title,
                content_hash=m.content_hash,
                truncated=m.truncated,
                text_length=len(m.text or ""),
                text=m.text or "",
            )
            for m in template.materials
        ],
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


def _to_summary(template: QuestionGenTemplate) -> TemplateSummary:
    fields = service.template_summary_fields(template)
    return TemplateSummary(
        id=template.id,
        course_kp_id=template.course_kp_id,
        name=template.name,
        description=template.description,
        is_default=template.is_default,
        student_profile=template.student_profile,
        material_count=fields["material_count"],
        seed_count=fields["seed_count"],
        updated_at=template.updated_at,
    )


async def _require_visible_course(db: AsyncSession, course_kp_id: uuid.UUID, user) -> None:
    stmt = select(KnowledgePoint.id).where(
        KnowledgePoint.id == course_kp_id,
        KnowledgePoint.deleted_at.is_(None),
        teacher_visible_resource_filter(KnowledgePoint, user.id),
    )
    if (await db.execute(stmt)).first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="课程不存在或无权访问")


async def _require_owned_template(db: AsyncSession, template_id: uuid.UUID, user) -> QuestionGenTemplate:
    template = await service.get_owned_template(db, template_id, user.id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="出题模板不存在或无权访问")
    return template


# --------------------------------------------------------------------------- #
# Course-scoped: list / create
# --------------------------------------------------------------------------- #
@course_templates_router.get("/{course_id}/question-gen-templates", response_model=list[TemplateSummary])
async def list_course_templates(
    course_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[TemplateSummary]:
    await _require_visible_course(db, course_id, user)
    templates = await service.list_templates(db, course_kp_id=course_id, user_id=user.id)
    return [_to_summary(t) for t in templates]


@course_templates_router.get("/{course_id}/question-gen-templates/seed-usage")
async def seed_usage(
    course_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, list[dict[str, str]]]:
    """question_id -> [{id, name}] of the teacher's skills using it as a seed."""
    await _require_visible_course(db, course_id, user)
    return await service.seed_usage_map(db, course_kp_id=course_id, user_id=user.id)


@course_templates_router.post(
    "/{course_id}/question-gen-templates",
    response_model=TemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_course_template(
    course_id: uuid.UUID,
    data: TemplateCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TemplateResponse:
    if data.course_kp_id != course_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="课程不一致")
    await _require_visible_course(db, course_id, user)
    template = await service.create_template(db, data, user_id=user.id)
    return _to_response(template)


# --------------------------------------------------------------------------- #
# Template-scoped: get / update / delete / set-default / duplicate / generate
# --------------------------------------------------------------------------- #
@template_router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TemplateResponse:
    return _to_response(await _require_owned_template(db, template_id, user))


@template_router.put("/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: uuid.UUID,
    data: TemplateUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TemplateResponse:
    template = await _require_owned_template(db, template_id, user)
    return _to_response(await service.update_template(db, template, data))


@template_router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    template = await _require_owned_template(db, template_id, user)
    await service.soft_delete_template(db, template)


@template_router.post("/{template_id}/set-default", response_model=TemplateResponse)
async def set_default_template(
    template_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TemplateResponse:
    template = await _require_owned_template(db, template_id, user)
    return _to_response(await service.set_default(db, template))


@template_router.post("/{template_id}/duplicate", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def duplicate_template(
    template_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TemplateResponse:
    template = await _require_owned_template(db, template_id, user)
    return _to_response(await service.duplicate_template(db, template, user_id=user.id))


async def _stream_generation(db: AsyncSession, template, ai_request, user) -> StreamingResponse:
    """Shared SSE generation stream (best-effort audit) for form & chat modes."""
    # Audit recording must never break generation: keep it best-effort.
    try:
        snapshot = service.build_run_snapshot(template, ai_request)
        run_id: uuid.UUID | None = await service.record_run_start(
            template_id=template.id, course_kp_id=template.course_kp_id, owner_id=user.id, snapshot=snapshot
        )
    except Exception:  # noqa: BLE001 - audit failure shouldn't block the user
        run_id = None

    async def event_stream() -> AsyncIterator[str]:
        generated = 0
        error_message: str | None = None
        try:
            async for event in generate_questions_stream(db, ai_request, user.id):
                if event.get("type") == "question":
                    generated += 1
                elif event.get("type") == "error":
                    error_message = event.get("message") or "生成失败"
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            if run_id is not None:
                try:
                    await service.record_run_finish(
                        run_id,
                        status="failed" if error_message else "completed",
                        generated_count=generated,
                        error_message=error_message,
                    )
                except Exception:  # noqa: BLE001 - best-effort audit
                    pass

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@template_router.post("/{template_id}/generate/stream")
async def generate_from_template(
    template_id: uuid.UUID,
    overrides: TemplateGenerateRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """Generate questions from a template, reusing the existing AI engine over SSE."""
    template = await _require_owned_template(db, template_id, user)
    try:
        ai_request = await service.assemble_generate_request(db, template, overrides)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return await _stream_generation(db, template, ai_request, user)


@template_router.post("/{template_id}/chat/stream")
async def chat_generate_from_template(
    template_id: uuid.UUID,
    body: TemplateChatRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """Chat-style generation: a free-form instruction drives types/counts/topic."""
    template = await _require_owned_template(db, template_id, user)
    try:
        ai_request = await service.assemble_chat_generate_request(
            db, template, message=body.message, model=body.model
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return await _stream_generation(db, template, ai_request, user)


@template_router.post("/seed/complete-answer", response_model=SeedCompleteResponse)
async def complete_seed_answer(
    data: SeedCompleteRequest,
    _user: CurrentUser,
) -> SeedCompleteResponse:
    """手动添加种子题：根据所选题型 + 粘贴的题干，AI 补全参考答案与解析。"""
    try:
        result = await complete_seed_answer_analysis(data.type, data.text)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return SeedCompleteResponse(answer=result["answer"], analysis=result["analysis"])


@template_router.get("/{template_id}/runs", response_model=list[RunSummary])
async def list_template_runs(
    template_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[RunSummary]:
    await _require_owned_template(db, template_id, user)
    runs = await service.list_runs(db, template_id=template_id, owner_id=user.id)
    return [RunSummary.model_validate(run) for run in runs]

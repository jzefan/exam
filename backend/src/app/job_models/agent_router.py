"""Stable agent-facing job model API routes."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.job_models.agent_schemas import (
    AgentExportFormat,
    AgentJobModelDraftCreate,
    AgentJobModelDetail,
    AgentJobModelSearchResponse,
    AgentJobModelSummary,
    AgentPublishRequest,
    AgentRecommendStandardRequest,
    AgentRecommendStandardResponse,
    AgentStructurePreviewRequest,
    AgentStructurePreviewResponse,
)
from app.job_models.agent_service import (
    count_current_structure,
    count_proposed_structure,
    get_agent_job_model,
    render_job_model_markdown,
    replace_current_version_structure,
    search_agent_job_models,
)
from app.job_models.schemas import JobModelCreate
from app.job_models.service import (
    create_job_model,
    get_job_model_by_id,
    publish_new_version,
    recommend_standard_model,
)
from app.rbac.dependencies import CurrentOrgId

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("", response_model=AgentJobModelSearchResponse)
async def search_job_models(
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
    q: str | None = Query(default=None, max_length=200),
    model_type: str | None = Query(default=None, max_length=40),
    industry_name: str | None = Query(default=None, max_length=100),
    direction_name: str | None = Query(default=None, max_length=100),
    _start: int = Query(0, ge=0),
    _end: int = Query(50, ge=1, le=500),
) -> AgentJobModelSearchResponse:
    limit = _end - _start if _end > _start else 50
    models, total = await search_agent_job_models(
        db,
        org_id=org_id,
        skip=_start,
        limit=limit,
        q=q,
        model_type=model_type,
        industry_name=industry_name,
        direction_name=direction_name,
    )
    return AgentJobModelSearchResponse(
        items=[AgentJobModelSummary.model_validate(model) for model in models],
        total=total,
    )


@router.post("/drafts", response_model=AgentJobModelDetail, status_code=status.HTTP_201_CREATED)
async def create_draft_job_model(
    body: AgentJobModelDraftCreate,
    db: DbSession,
    user: CurrentUser,
    org_id: CurrentOrgId,
) -> AgentJobModelDetail:
    model = await create_job_model(
        db,
        org_id,
        user.id,
        JobModelCreate(
            job_role=body.job_role,
            version_note=body.version_note,
            source_type="manual",
            model_type=body.model_type,
            status="draft",
            job_family=body.job_family,
            industry_name=body.industry_name,
            direction_name=body.direction_name,
            dimensions=body.dimensions,
        ),
    )
    await db.commit()
    loaded = await get_agent_job_model(db, org_id=org_id, model_id=model.id)
    return AgentJobModelDetail.model_validate(loaded)


@router.get("/{model_id}", response_model=AgentJobModelDetail)
async def get_job_model(
    model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> AgentJobModelDetail:
    model = await get_agent_job_model(db, org_id=org_id, model_id=model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job model not found")
    return AgentJobModelDetail.model_validate(model)


@router.post("/{model_id}/publish", response_model=AgentJobModelDetail)
async def publish_job_model(
    model_id: uuid.UUID,
    body: AgentPublishRequest,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> AgentJobModelDetail:
    model = await get_agent_job_model(db, org_id=org_id, model_id=model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job model not found")
    published = await publish_new_version(db, model, version_note=body.version_note)
    published.status = "published"
    await db.commit()
    loaded = await get_agent_job_model(db, org_id=org_id, model_id=model_id)
    return AgentJobModelDetail.model_validate(loaded)


@router.post("/{model_id}/structure-preview", response_model=AgentStructurePreviewResponse)
async def preview_structure_update(
    model_id: uuid.UUID,
    body: AgentStructurePreviewRequest,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> AgentStructurePreviewResponse:
    model = await get_agent_job_model(db, org_id=org_id, model_id=model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job model not found")
    return AgentStructurePreviewResponse(
        current=count_current_structure(model),
        proposed=count_proposed_structure(body.dimensions),
        will_write=False,
    )


@router.put("/{model_id}/structure", response_model=AgentJobModelDetail)
async def replace_job_model_structure(
    model_id: uuid.UUID,
    body: AgentStructurePreviewRequest,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> AgentJobModelDetail:
    model = await get_agent_job_model(db, org_id=org_id, model_id=model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job model not found")
    if model.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft job models can be updated through this endpoint.",
        )
    updated = await replace_current_version_structure(db, model, body.dimensions)
    await db.commit()
    return AgentJobModelDetail.model_validate(updated)


@router.get("/{model_id}/export", response_model=None)
async def export_job_model(
    model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
    format: AgentExportFormat = Query("json"),
) -> object:
    model = await get_agent_job_model(db, org_id=org_id, model_id=model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job model not found")
    if format == "markdown":
        return Response(
            content=render_job_model_markdown(model),
            media_type="text/markdown; charset=utf-8",
        )
    return AgentJobModelDetail.model_validate(model)


@router.post("/recommend-standard", response_model=AgentRecommendStandardResponse)
async def recommend_standard(
    body: AgentRecommendStandardRequest,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> AgentRecommendStandardResponse:
    result = await recommend_standard_model(db, body.job_text.strip(), org_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未匹配到合适的标准岗位，请补充更具体的岗位职责或技能关键词。",
        )
    model, rationale, confidence, keywords = result
    return AgentRecommendStandardResponse(
        model=AgentJobModelSummary.model_validate(model),
        rationale=rationale,
        confidence=confidence,
        matched_keywords=keywords,
    )

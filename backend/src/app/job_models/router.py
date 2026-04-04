"""API routes for job competency model management."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.job_models.schemas import (
    DimensionCreate,
    DimensionResponse,
    DimensionUpdate,
    JobModelCreate,
    JobModelResponse,
    JobModelSummary,
    JobModelUpdate,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    SkillKnowledgePointResponse,
    SkillKnowledgePointUpdate,
    SkillResponse,
    SkillUpdate,
    TemplateCreate,
    TemplateResponse,
    TemplateUpdate,
)
from app.job_models.editor_service import (
    bulk_set_kp_difficulty,
    bulk_set_skill_level,
    move_skill_to_dimension,
    reorder_dimensions,
    reorder_knowledge_points,
    reorder_skills,
)
from app.job_models.service import (
    create_dimension,
    create_job_model,
    create_knowledge_point,
    create_project,
    create_skill,
    create_template,
    delete_dimension,
    delete_knowledge_point,
    delete_project,
    delete_skill,
    get_job_model_by_id,
    get_project_by_id,
    get_template_by_id,
    list_job_models,
    list_projects,
    list_templates,
    publish_new_version,
    save_model_as_template,
    update_dimension,
    update_job_model,
    update_knowledge_point,
    update_project,
    update_skill,
    update_template,
)
from app.rbac.dependencies import CurrentOrgId
from pydantic import BaseModel

project_router = APIRouter()
model_router = APIRouter()
template_router = APIRouter()

DbSession = Annotated[AsyncSession, Depends(get_db)]


# --- Project Routes ---


@project_router.get("", response_model=list[ProjectResponse])
async def list_all_projects(
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> list[ProjectResponse]:
    projects, _ = await list_projects(db, org_id=org_id, skip=skip, limit=limit)
    return [ProjectResponse.model_validate(p) for p in projects]


@project_router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_new_project(
    body: ProjectCreate,
    db: DbSession,
    user: CurrentUser,
    org_id: CurrentOrgId,
) -> ProjectResponse:
    project = await create_project(db, body, org_id=org_id, user_id=user.id)
    await db.commit()
    return ProjectResponse.model_validate(project)


@project_router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> ProjectResponse:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return ProjectResponse.model_validate(project)


@project_router.patch("/{project_id}", response_model=ProjectResponse)
async def update_existing_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> ProjectResponse:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    updated = await update_project(db, project, body)
    await db.commit()
    return ProjectResponse.model_validate(updated)


@project_router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_project(
    project_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await delete_project(db, project)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@project_router.get("/{project_id}/models", response_model=list[JobModelSummary])
async def list_project_models(
    project_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> list[JobModelSummary]:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    models = await list_job_models(db, project_id)
    return [JobModelSummary.model_validate(m) for m in models]


@project_router.post("/{project_id}/models", response_model=JobModelResponse, status_code=status.HTTP_201_CREATED)
async def create_project_model(
    project_id: uuid.UUID,
    body: JobModelCreate,
    db: DbSession,
    _user: CurrentUser,
) -> JobModelResponse:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    model = await create_job_model(db, project_id, body)
    await db.commit()
    # Reload with full hierarchy
    loaded = await get_job_model_by_id(db, model.id)
    return JobModelResponse.model_validate(loaded)


# --- Model Routes ---


@model_router.get("/{model_id}", response_model=JobModelResponse)
async def get_model_detail(
    model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return JobModelResponse.model_validate(model)


@model_router.patch("/{model_id}", response_model=JobModelResponse)
async def update_model(
    model_id: uuid.UUID,
    body: JobModelUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    updated = await update_job_model(db, model, body)
    await db.commit()
    loaded = await get_job_model_by_id(db, updated.id)
    return JobModelResponse.model_validate(loaded)


@model_router.post("/{model_id}/publish", response_model=JobModelResponse)
async def publish_model_version(
    model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
    version_note: str | None = Query(None),
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    new_model = await publish_new_version(db, model, version_note=version_note)
    await db.commit()
    loaded = await get_job_model_by_id(db, new_model.id)
    return JobModelResponse.model_validate(loaded)


@model_router.post("/{model_id}/save-as-template", response_model=TemplateResponse)
async def save_as_template(
    model_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    name: str = Query(...),
) -> TemplateResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    template = await save_model_as_template(db, model, name=name, user_id=user.id)
    await db.commit()
    return TemplateResponse.model_validate(template)


@model_router.post("/{model_id}/dimensions", response_model=DimensionResponse, status_code=status.HTTP_201_CREATED)
async def add_dimension(
    model_id: uuid.UUID,
    body: DimensionCreate,
    db: DbSession,
    _user: CurrentUser,
) -> DimensionResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    dim = await create_dimension(db, model_id, body)
    await db.commit()
    # Reload with skills
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.job_models.models import CompetencyDimension, Skill

    result = await db.execute(
        select(CompetencyDimension)
        .where(CompetencyDimension.id == dim.id)
        .options(selectinload(CompetencyDimension.skills).selectinload(Skill.knowledge_points))
    )
    loaded_dim = result.scalar_one()
    return DimensionResponse.model_validate(loaded_dim)


@model_router.patch("/dimensions/{dimension_id}", response_model=DimensionResponse)
async def update_dim(
    dimension_id: uuid.UUID,
    body: DimensionUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> DimensionResponse:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.job_models.models import CompetencyDimension, Skill

    result = await db.execute(
        select(CompetencyDimension)
        .where(CompetencyDimension.id == dimension_id)
        .options(selectinload(CompetencyDimension.skills).selectinload(Skill.knowledge_points))
    )
    dim = result.scalar_one_or_none()
    if dim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dimension not found")
    updated = await update_dimension(db, dim, body)
    await db.commit()
    result2 = await db.execute(
        select(CompetencyDimension)
        .where(CompetencyDimension.id == updated.id)
        .options(selectinload(CompetencyDimension.skills).selectinload(Skill.knowledge_points))
    )
    loaded = result2.scalar_one()
    return DimensionResponse.model_validate(loaded)


@model_router.delete("/dimensions/{dimension_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_dimension(
    dimension_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    from sqlalchemy import select
    from app.job_models.models import CompetencyDimension

    result = await db.execute(select(CompetencyDimension).where(CompetencyDimension.id == dimension_id))
    dim = result.scalar_one_or_none()
    if dim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dimension not found")
    await delete_dimension(db, dim)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@model_router.post("/dimensions/{dimension_id}/skills", response_model=SkillResponse, status_code=status.HTTP_201_CREATED)
async def add_skill(
    dimension_id: uuid.UUID,
    body: SkillCreate,
    db: DbSession,
    _user: CurrentUser,
) -> SkillResponse:
    from sqlalchemy import select
    from app.job_models.models import CompetencyDimension

    result = await db.execute(select(CompetencyDimension).where(CompetencyDimension.id == dimension_id))
    dim = result.scalar_one_or_none()
    if dim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dimension not found")
    skill = await create_skill(db, dimension_id, body)
    await db.commit()
    from sqlalchemy.orm import selectinload
    from app.job_models.models import Skill

    result2 = await db.execute(
        select(Skill)
        .where(Skill.id == skill.id)
        .options(selectinload(Skill.knowledge_points))
    )
    loaded = result2.scalar_one()
    return SkillResponse.model_validate(loaded)


@model_router.patch("/skills/{skill_id}", response_model=SkillResponse)
async def update_skill_endpoint(
    skill_id: uuid.UUID,
    body: SkillUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> SkillResponse:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.job_models.models import Skill

    result = await db.execute(
        select(Skill).where(Skill.id == skill_id).options(selectinload(Skill.knowledge_points))
    )
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    updated = await update_skill(db, skill, body)
    await db.commit()
    result2 = await db.execute(
        select(Skill).where(Skill.id == updated.id).options(selectinload(Skill.knowledge_points))
    )
    loaded = result2.scalar_one()
    return SkillResponse.model_validate(loaded)


@model_router.delete("/skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_skill(
    skill_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    from sqlalchemy import select
    from app.job_models.models import Skill

    result = await db.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    await delete_skill(db, skill)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@model_router.post("/skills/{skill_id}/knowledge-points", response_model=SkillKnowledgePointResponse, status_code=status.HTTP_201_CREATED)
async def add_knowledge_point(
    skill_id: uuid.UUID,
    body: SkillKnowledgePointCreate,
    db: DbSession,
    _user: CurrentUser,
) -> SkillKnowledgePointResponse:
    from sqlalchemy import select
    from app.job_models.models import Skill

    result = await db.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    kp = await create_knowledge_point(db, skill_id, body)
    await db.commit()
    return SkillKnowledgePointResponse.model_validate(kp)


@model_router.patch("/knowledge-points/{kp_id}", response_model=SkillKnowledgePointResponse)
async def update_kp(
    kp_id: uuid.UUID,
    body: SkillKnowledgePointUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> SkillKnowledgePointResponse:
    from sqlalchemy import select
    from app.job_models.models import SkillKnowledgePoint

    result = await db.execute(select(SkillKnowledgePoint).where(SkillKnowledgePoint.id == kp_id))
    kp = result.scalar_one_or_none()
    if kp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge point not found")
    updated = await update_knowledge_point(db, kp, body)
    await db.commit()
    return SkillKnowledgePointResponse.model_validate(updated)


@model_router.delete("/knowledge-points/{kp_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_knowledge_point(
    kp_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    from sqlalchemy import select
    from app.job_models.models import SkillKnowledgePoint

    result = await db.execute(select(SkillKnowledgePoint).where(SkillKnowledgePoint.id == kp_id))
    kp = result.scalar_one_or_none()
    if kp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge point not found")
    await delete_knowledge_point(db, kp)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Editor Request Models ---


class ReorderRequest(BaseModel):
    order_map: dict[str, int]  # {id: sort_order}


class MoveSkillRequest(BaseModel):
    skill_id: uuid.UUID
    target_dimension_id: uuid.UUID


class BulkSetLevelRequest(BaseModel):
    skill_ids: list[uuid.UUID]
    level: str


class BulkSetDifficultyRequest(BaseModel):
    kp_ids: list[uuid.UUID]
    difficulty: str


# --- Editor Routes ---


@model_router.post("/{model_id}/reorder-dimensions", response_model=list[DimensionResponse])
async def reorder_dimensions_ep(
    model_id: uuid.UUID,
    body: ReorderRequest,
    db: DbSession,
    _user: CurrentUser,
) -> list[DimensionResponse]:
    """Reorder dimensions within a model."""
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    order_map = {uuid.UUID(k): v for k, v in body.order_map.items()}
    dimensions = await reorder_dimensions(db, model_id, order_map)
    await db.commit()
    return [DimensionResponse.model_validate(d) for d in dimensions]


@model_router.post("/dimensions/{dimension_id}/reorder-skills", response_model=list[SkillResponse])
async def reorder_skills_ep(
    dimension_id: uuid.UUID,
    body: ReorderRequest,
    db: DbSession,
    _user: CurrentUser,
) -> list[SkillResponse]:
    """Reorder skills within a dimension."""
    order_map = {uuid.UUID(k): v for k, v in body.order_map.items()}
    skills = await reorder_skills(db, dimension_id, order_map)
    await db.commit()
    return [SkillResponse.model_validate(s) for s in skills]


@model_router.post("/skills/{skill_id}/reorder-kps", response_model=list[SkillKnowledgePointResponse])
async def reorder_kps_ep(
    skill_id: uuid.UUID,
    body: ReorderRequest,
    db: DbSession,
    _user: CurrentUser,
) -> list[SkillKnowledgePointResponse]:
    """Reorder knowledge points within a skill."""
    order_map = {uuid.UUID(k): v for k, v in body.order_map.items()}
    kps = await reorder_knowledge_points(db, skill_id, order_map)
    await db.commit()
    return [SkillKnowledgePointResponse.model_validate(kp) for kp in kps]


@model_router.post("/move-skill", response_model=SkillResponse)
async def move_skill_ep(
    body: MoveSkillRequest,
    db: DbSession,
    _user: CurrentUser,
) -> SkillResponse:
    """Move a skill to a different dimension."""
    from sqlalchemy.orm import selectinload
    from app.job_models.models import Skill

    skill = await move_skill_to_dimension(db, body.skill_id, body.target_dimension_id)
    await db.commit()
    from sqlalchemy import select as sa_select
    result = await db.execute(
        sa_select(Skill).where(Skill.id == skill.id).options(selectinload(Skill.knowledge_points))
    )
    loaded = result.scalar_one()
    return SkillResponse.model_validate(loaded)


@model_router.post("/bulk-set-skill-level", response_model=dict[str, int])
async def bulk_set_level_ep(
    body: BulkSetLevelRequest,
    db: DbSession,
    _user: CurrentUser,
) -> dict[str, int]:
    """Set skill level for multiple skills."""
    count = await bulk_set_skill_level(db, body.skill_ids, body.level)
    await db.commit()
    return {"updated": count}


@model_router.post("/bulk-set-kp-difficulty", response_model=dict[str, int])
async def bulk_set_difficulty_ep(
    body: BulkSetDifficultyRequest,
    db: DbSession,
    _user: CurrentUser,
) -> dict[str, int]:
    """Set knowledge point difficulty for multiple KPs."""
    count = await bulk_set_kp_difficulty(db, body.kp_ids, body.difficulty)
    await db.commit()
    return {"updated": count}


# --- Template Routes ---


@template_router.get("", response_model=list[TemplateResponse])
async def list_all_templates(
    db: DbSession,
    _user: CurrentUser,
    industry: str | None = Query(None),
) -> list[TemplateResponse]:
    templates = await list_templates(db, industry=industry)
    return [TemplateResponse.model_validate(t) for t in templates]


@template_router.post("", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_new_template(
    body: TemplateCreate,
    db: DbSession,
    user: CurrentUser,
) -> TemplateResponse:
    template = await create_template(db, body, user_id=user.id)
    await db.commit()
    return TemplateResponse.model_validate(template)


@template_router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> TemplateResponse:
    template = await get_template_by_id(db, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return TemplateResponse.model_validate(template)


@template_router.patch("/{template_id}", response_model=TemplateResponse)
async def update_existing_template(
    template_id: uuid.UUID,
    body: TemplateUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> TemplateResponse:
    template = await get_template_by_id(db, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    updated = await update_template(db, template, body)
    await db.commit()
    return TemplateResponse.model_validate(updated)

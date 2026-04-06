"""Business logic for job competency model operations."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelProject,
    JobModelTemplate,
    Skill,
    SkillKnowledgePoint,
)
from app.job_models.schemas import (
    DimensionCreate,
    DimensionUpdate,
    JobModelCreate,
    JobModelUpdate,
    ProjectCreate,
    ProjectUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    SkillKnowledgePointUpdate,
    SkillUpdate,
    TemplateCreate,
    TemplateUpdate,
)


# --- Project CRUD ---


async def create_project(
    db: AsyncSession,
    data: ProjectCreate,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
) -> JobModelProject:
    project = JobModelProject(
        name=data.name,
        industry=data.industry,
        description=data.description,
        org_id=org_id,
        created_by=user_id,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


async def get_project_by_id(db: AsyncSession, project_id: uuid.UUID) -> JobModelProject | None:
    result = await db.execute(
        select(JobModelProject).where(
            JobModelProject.id == project_id,
            JobModelProject.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def list_projects(
    db: AsyncSession,
    org_id: uuid.UUID,
    skip: int = 0,
    limit: int = 50,
) -> tuple[list[JobModelProject], int]:
    base_query = select(JobModelProject).where(
        JobModelProject.org_id == org_id,
        JobModelProject.deleted_at.is_(None),
    )
    count_result = await db.execute(select(func.count()).select_from(base_query.subquery()))
    total = count_result.scalar_one()

    result = await db.execute(
        base_query.order_by(JobModelProject.created_at.desc()).offset(skip).limit(limit)
    )
    return list(result.scalars().all()), total


async def update_project(
    db: AsyncSession,
    project: JobModelProject,
    data: ProjectUpdate,
) -> JobModelProject:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)
    await db.flush()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, project: JobModelProject) -> None:
    project.deleted_at = datetime.now(timezone.utc)
    await db.flush()


# --- JobModel CRUD + Version Control ---


async def create_job_model(
    db: AsyncSession,
    project_id: uuid.UUID,
    data: JobModelCreate,
) -> JobModel:
    model = JobModel(
        project_id=project_id,
        job_role=data.job_role,
        version=1,
        version_note=data.version_note,
        is_current=True,
        source_type=data.source_type,
    )
    db.add(model)
    await db.flush()

    for dim_data in data.dimensions:
        await _create_dimension(db, model.id, dim_data)

    await db.refresh(model)
    return model


async def get_job_model_by_id(db: AsyncSession, model_id: uuid.UUID) -> JobModel | None:
    result = await db.execute(
        select(JobModel)
        .where(JobModel.id == model_id)
        .options(
            selectinload(JobModel.dimensions).selectinload(CompetencyDimension.skills).selectinload(Skill.knowledge_points)
        )
    )
    return result.scalar_one_or_none()


async def list_job_models(db: AsyncSession, project_id: uuid.UUID) -> list[JobModel]:
    result = await db.execute(
        select(JobModel)
        .where(JobModel.project_id == project_id)
        .order_by(JobModel.version.desc())
    )
    return list(result.scalars().all())


async def list_all_job_models(
    db: AsyncSession, org_id: uuid.UUID, skip: int = 0, limit: int = 50
) -> tuple[list[JobModel], int]:
    """List all job models in an organization with pagination."""
    # Get total count
    count_result = await db.execute(
        select(func.count(JobModel.id)).select_from(JobModel)
        .join(JobModelProject)
        .where(JobModelProject.org_id == org_id)
    )
    total = count_result.scalar_one()

    # Get paginated results
    result = await db.execute(
        select(JobModel)
        .join(JobModelProject)
        .where(JobModelProject.org_id == org_id)
        .order_by(JobModel.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all()), total


async def update_job_model(
    db: AsyncSession,
    model: JobModel,
    data: JobModelUpdate,
) -> JobModel:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(model, field, value)
    await db.flush()
    await db.refresh(model)
    return model


async def publish_new_version(
    db: AsyncSession,
    model: JobModel,
    version_note: str | None = None,
) -> JobModel:
    # Load full hierarchy of current model
    loaded = await get_job_model_by_id(db, model.id)

    # Mark old version as not current
    model.is_current = False
    await db.flush()

    # Create new version
    new_model = JobModel(
        project_id=model.project_id,
        job_role=model.job_role,
        version=model.version + 1,
        version_note=version_note,
        is_current=True,
        source_type=model.source_type,
    )
    db.add(new_model)
    await db.flush()

    # Copy hierarchy
    for dim in (loaded.dimensions if loaded else []):
        new_dim = CompetencyDimension(
            model_id=new_model.id,
            name=dim.name,
            description=dim.description,
            sort_order=dim.sort_order,
        )
        db.add(new_dim)
        await db.flush()

        for skill in dim.skills:
            new_skill = Skill(
                dimension_id=new_dim.id,
                name=skill.name,
                level=skill.level,
                description=skill.description,
                sort_order=skill.sort_order,
            )
            db.add(new_skill)
            await db.flush()

            for kp in skill.knowledge_points:
                new_kp = SkillKnowledgePoint(
                    skill_id=new_skill.id,
                    name=kp.name,
                    teaching_suggestion=kp.teaching_suggestion,
                    difficulty=kp.difficulty,
                    sort_order=kp.sort_order,
                )
                db.add(new_kp)

    await db.flush()
    await db.refresh(new_model)
    return new_model


# --- Dimension CRUD ---


async def create_dimension(
    db: AsyncSession,
    model_id: uuid.UUID,
    data: DimensionCreate,
) -> CompetencyDimension:
    return await _create_dimension(db, model_id, data)


async def update_dimension(
    db: AsyncSession,
    dim: CompetencyDimension,
    data: DimensionUpdate,
) -> CompetencyDimension:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(dim, field, value)
    await db.flush()
    await db.refresh(dim)
    return dim


async def delete_dimension(db: AsyncSession, dim: CompetencyDimension) -> None:
    await db.delete(dim)
    await db.flush()


# --- Skill CRUD ---


async def create_skill(
    db: AsyncSession,
    dimension_id: uuid.UUID,
    data: SkillCreate,
) -> Skill:
    return await _create_skill(db, dimension_id, data)


async def update_skill(
    db: AsyncSession,
    skill: Skill,
    data: SkillUpdate,
) -> Skill:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(skill, field, value)
    await db.flush()
    await db.refresh(skill)
    return skill


async def delete_skill(db: AsyncSession, skill: Skill) -> None:
    await db.delete(skill)
    await db.flush()


# --- KnowledgePoint CRUD ---


async def create_knowledge_point(
    db: AsyncSession,
    skill_id: uuid.UUID,
    data: SkillKnowledgePointCreate,
) -> SkillKnowledgePoint:
    kp = SkillKnowledgePoint(
        skill_id=skill_id,
        name=data.name,
        teaching_suggestion=data.teaching_suggestion,
        difficulty=data.difficulty,
        sort_order=data.sort_order,
    )
    db.add(kp)
    await db.flush()
    await db.refresh(kp)
    return kp


async def update_knowledge_point(
    db: AsyncSession,
    kp: SkillKnowledgePoint,
    data: SkillKnowledgePointUpdate,
) -> SkillKnowledgePoint:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(kp, field, value)
    await db.flush()
    await db.refresh(kp)
    return kp


async def delete_knowledge_point(db: AsyncSession, kp: SkillKnowledgePoint) -> None:
    await db.delete(kp)
    await db.flush()


# --- Template CRUD ---


async def create_template(
    db: AsyncSession,
    data: TemplateCreate,
    user_id: uuid.UUID,
    is_system: bool = False,
) -> JobModelTemplate:
    template = JobModelTemplate(
        name=data.name,
        industry=data.industry,
        template_data=data.template_data,
        is_system=is_system,
        created_by=user_id,
    )
    db.add(template)
    await db.flush()
    await db.refresh(template)
    return template


async def list_templates(
    db: AsyncSession,
    industry: str | None = None,
) -> list[JobModelTemplate]:
    query = select(JobModelTemplate).where(JobModelTemplate.deleted_at.is_(None))
    if industry is not None:
        query = query.where(JobModelTemplate.industry == industry)
    result = await db.execute(query.order_by(JobModelTemplate.created_at.desc()))
    return list(result.scalars().all())


async def get_template_by_id(
    db: AsyncSession,
    template_id: uuid.UUID,
) -> JobModelTemplate | None:
    result = await db.execute(
        select(JobModelTemplate).where(
            JobModelTemplate.id == template_id,
            JobModelTemplate.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def update_template(
    db: AsyncSession,
    template: JobModelTemplate,
    data: TemplateUpdate,
) -> JobModelTemplate:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)
    await db.flush()
    await db.refresh(template)
    return template


async def save_model_as_template(
    db: AsyncSession,
    model: JobModel,
    name: str,
    user_id: uuid.UUID,
) -> JobModelTemplate:
    loaded = await get_job_model_by_id(db, model.id)

    template_data: dict = {
        "job_role": model.job_role,
        "dimensions": [],
    }

    for dim in (loaded.dimensions if loaded else []):
        dim_dict: dict = {
            "name": dim.name,
            "description": dim.description,
            "sort_order": dim.sort_order,
            "skills": [],
        }
        for skill in dim.skills:
            skill_dict: dict = {
                "name": skill.name,
                "level": skill.level,
                "description": skill.description,
                "sort_order": skill.sort_order,
                "knowledge_points": [],
            }
            for kp in skill.knowledge_points:
                skill_dict["knowledge_points"].append({
                    "name": kp.name,
                    "teaching_suggestion": kp.teaching_suggestion,
                    "difficulty": kp.difficulty,
                    "sort_order": kp.sort_order,
                })
            dim_dict["skills"].append(skill_dict)
        template_data["dimensions"].append(dim_dict)

    template = JobModelTemplate(
        name=name,
        industry=None,
        template_data=template_data,
        is_system=False,
        created_by=user_id,
    )
    db.add(template)
    await db.flush()
    await db.refresh(template)
    return template


# --- Internal helpers ---


async def _create_dimension(
    db: AsyncSession,
    model_id: uuid.UUID,
    data: DimensionCreate,
) -> CompetencyDimension:
    dim = CompetencyDimension(
        model_id=model_id,
        name=data.name,
        description=data.description,
        sort_order=data.sort_order,
    )
    db.add(dim)
    await db.flush()

    for skill_data in data.skills:
        await _create_skill(db, dim.id, skill_data)

    await db.refresh(dim)
    return dim


async def _create_skill(
    db: AsyncSession,
    dimension_id: uuid.UUID,
    data: SkillCreate,
) -> Skill:
    skill = Skill(
        dimension_id=dimension_id,
        name=data.name,
        level=data.level,
        description=data.description,
        sort_order=data.sort_order,
    )
    db.add(skill)
    await db.flush()

    for kp_data in data.knowledge_points:
        kp = SkillKnowledgePoint(
            skill_id=skill.id,
            name=kp_data.name,
            teaching_suggestion=kp_data.teaching_suggestion,
            difficulty=kp_data.difficulty,
            sort_order=kp_data.sort_order,
        )
        db.add(kp)

    await db.flush()
    await db.refresh(skill)
    return skill

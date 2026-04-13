"""Business logic for job competency model operations."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelTemplate,
    JobModelVersion,
    SourceDocument,
    Skill,
    SkillKnowledgePoint,
)
from app.job_models.schemas import (
    DimensionCreate,
    DimensionUpdate,
    JobModelCreate,
    JobModelUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    SkillKnowledgePointUpdate,
    SkillUpdate,
    TemplateCreate,
    TemplateUpdate,
)


def _job_model_with_current_version_query():
    return select(JobModel).options(
        with_loader_criteria(JobModel, JobModel.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(JobModelVersion, JobModelVersion.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(CompetencyDimension, CompetencyDimension.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(Skill, Skill.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(SkillKnowledgePoint, SkillKnowledgePoint.deleted_at.is_(None), include_aliases=True),
        selectinload(JobModel.current_version)
        .selectinload(JobModelVersion.dimensions)
        .selectinload(CompetencyDimension.skills)
        .selectinload(Skill.knowledge_points),
        selectinload(JobModel.versions)
        .selectinload(JobModelVersion.dimensions)
        .selectinload(CompetencyDimension.skills)
        .selectinload(Skill.knowledge_points),
    )


async def _load_job_model(db: AsyncSession, model_id: uuid.UUID) -> JobModel | None:
    result = await db.execute(
        _job_model_with_current_version_query().where(
            JobModel.id == model_id,
            JobModel.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def _copy_version_hierarchy(
    db: AsyncSession,
    source_version: JobModelVersion,
    target_version_id: uuid.UUID,
) -> None:
    for dim in source_version.dimensions:
        new_dim = CompetencyDimension(
            model_version_id=target_version_id,
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
                item_source=skill.item_source,
                change_type=skill.change_type,
                evidence_summary=skill.evidence_summary,
                source_excerpt=skill.source_excerpt,
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
                    item_source=kp.item_source,
                    change_type=kp.change_type,
                    evidence_summary=kp.evidence_summary,
                    source_excerpt=kp.source_excerpt,
                    sort_order=kp.sort_order,
                )
                db.add(new_kp)

    await db.flush()


# --- JobModel CRUD + Version Control ---


async def create_job_model(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    data: JobModelCreate,
) -> JobModel:
    model = JobModel(
        job_role=data.job_role,
        model_type=data.model_type,
        status=data.status,
        job_family=data.job_family,
        industry_name=data.industry_name,
        direction_name=data.direction_name,
        origin_standard_model_id=data.origin_standard_model_id,
        org_id=org_id,
        created_by=user_id,
    )
    db.add(model)
    await db.flush()

    version = JobModelVersion(
        job_model_id=model.id,
        version=1,
        version_note=data.version_note,
        is_current=True,
        source_type=data.source_type,
        raw_content={
            "job_role": data.job_role,
            "dimensions": [dim.model_dump() for dim in data.dimensions],
        },
        created_by=user_id,
        published_at=datetime.now(timezone.utc),
    )
    db.add(version)
    await db.flush()

    model.current_version_id = version.id
    model.current_version = version
    version.job_model = model
    await db.flush()

    for dim_data in data.dimensions:
        await _create_dimension(db, version.id, dim_data)

    loaded = await _load_job_model(db, model.id)
    return loaded or model


async def create_enterprise_model_from_standard(
    db: AsyncSession,
    standard_model: JobModel,
    *,
    enterprise_name: str,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    version_note: str | None = None,
) -> tuple[JobModel, JobModelVersion]:
    loaded_standard = await _load_job_model(db, standard_model.id)
    if loaded_standard is None or loaded_standard.current_version is None:
        raise ValueError("Standard model not found")

    copied_dimensions = [
        DimensionCreate(
            name=dim.name,
            description=dim.description,
            sort_order=dim.sort_order,
            skills=[
                SkillCreate(
                    name=skill.name,
                    level=skill.level,
                    description=skill.description,
                    sort_order=skill.sort_order,
                    knowledge_points=[
                        SkillKnowledgePointCreate(
                            name=kp.name,
                            teaching_suggestion=kp.teaching_suggestion,
                            difficulty=kp.difficulty,
                            sort_order=kp.sort_order,
                        )
                        for kp in skill.knowledge_points
                    ],
                )
                for skill in dim.skills
            ],
        )
        for dim in loaded_standard.current_version.dimensions
    ]

    enterprise = await create_job_model(
        db,
        org_id,
        user_id,
        JobModelCreate(
            job_role=enterprise_name or loaded_standard.job_role,
            version_note=version_note,
            source_type="standard_based",
            model_type="enterprise",
            status="draft",
            job_family=loaded_standard.job_family,
            industry_name=loaded_standard.industry_name,
            direction_name=loaded_standard.direction_name,
            origin_standard_model_id=loaded_standard.id,
            dimensions=copied_dimensions,
        ),
    )

    if enterprise.current_version is None:
        raise RuntimeError("Enterprise model missing current version")

    enterprise.current_version.version_note = version_note
    enterprise.current_version.raw_content = loaded_standard.current_version.raw_content
    await db.flush()
    loaded = await _load_job_model(db, enterprise.id)
    result_model = loaded or enterprise
    if result_model.current_version is None:
        raise RuntimeError("Enterprise model missing current version after reload")
    return result_model, result_model.current_version


async def get_job_model_by_id(db: AsyncSession, model_id: uuid.UUID) -> JobModel | None:
    return await _load_job_model(db, model_id)


async def list_job_models(
    db: AsyncSession,
    org_id: uuid.UUID,
    model_type: str | None = None,
) -> list[JobModel]:
    query = _job_model_with_current_version_query().where(
        JobModel.org_id == org_id,
        JobModel.deleted_at.is_(None),
    )
    if model_type is not None:
        query = query.where(JobModel.model_type == model_type)
    result = await db.execute(query.order_by(JobModel.created_at.desc()))
    return list(result.scalars().all())


async def list_all_job_models(
    db: AsyncSession,
    org_id: uuid.UUID,
    skip: int = 0,
    limit: int = 50,
    model_type: str | None = None,
) -> tuple[list[JobModel], int]:
    """List all job models in an organization with pagination."""
    filters = [JobModel.org_id == org_id, JobModel.deleted_at.is_(None)]
    if model_type:
        filters.append(JobModel.model_type == model_type)

    count_result = await db.execute(
        select(func.count(JobModel.id)).select_from(JobModel).where(*filters)
    )
    total = count_result.scalar_one()

    result = await db.execute(
        _job_model_with_current_version_query()
        .where(*filters)
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
    if "job_role" in update_data:
        model.job_role = update_data["job_role"]

    if model.current_version is not None and update_data.get("version_note") is not None:
        model.current_version.version_note = update_data["version_note"]

    await db.flush()
    loaded = await _load_job_model(db, model.id)
    return loaded or model


async def delete_job_model(db: AsyncSession, model: JobModel) -> None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SourceDocument).where(
            SourceDocument.job_model_id == model.id,
            SourceDocument.deleted_at.is_(None),
        )
    )
    source_documents = list(result.scalars().all())

    model.deleted_at = now
    for version in model.versions:
        version.deleted_at = now
        if model.current_version_id == version.id:
            version.is_current = False
        for dim in version.dimensions:
            dim.deleted_at = now
            for skill in dim.skills:
                skill.deleted_at = now
                for kp in skill.knowledge_points:
                    kp.deleted_at = now

    for source_document in source_documents:
        source_document.deleted_at = now
    await db.flush()


async def recommend_standard_model(
    db: AsyncSession,
    job_text: str,
    org_id: uuid.UUID,
) -> JobModel | None:
    lowered = job_text.lower()
    keyword_role_map: list[tuple[str, str]] = [
        ("java", "Java 后端工程师"),
        ("spring", "Java 后端工程师"),
        ("mysql", "Java 后端工程师"),
        ("python", "Python 开发工程师"),
        ("前端", "前端开发工程师"),
        ("运维", "运维工程师"),
    ]

    matched_roles: list[str] = []
    for keyword, role in keyword_role_map:
        if keyword in lowered and role not in matched_roles:
            matched_roles.append(role)

    query = _job_model_with_current_version_query().where(
        JobModel.org_id == org_id,
        JobModel.model_type == "standard",
        JobModel.deleted_at.is_(None),
    )
    if matched_roles:
        query = query.where(JobModel.job_role.in_(matched_roles))

    result = await db.execute(query.order_by(JobModel.updated_at.desc()).limit(1))
    return result.scalar_one_or_none()


async def publish_new_version(
    db: AsyncSession,
    model: JobModel,
    version_note: str | None = None,
) -> JobModel:
    loaded = await _load_job_model(db, model.id)
    current_version = loaded.current_version if loaded else model.current_version
    if current_version is None:
        raise ValueError("Model has no current version")

    current_version.is_current = False
    await db.flush()

    new_version = JobModelVersion(
        job_model_id=model.id,
        version=current_version.version + 1,
        version_note=version_note,
        is_current=True,
        source_type=current_version.source_type,
        raw_content=current_version.raw_content,
        created_by=current_version.created_by,
        published_at=datetime.now(timezone.utc),
    )
    db.add(new_version)
    await db.flush()

    await _copy_version_hierarchy(db, current_version, new_version.id)

    model.current_version_id = new_version.id
    model.current_version = new_version
    new_version.job_model = model
    await db.flush()

    loaded_new = await _load_job_model(db, model.id)
    return loaded_new or model


# --- Dimension CRUD ---


async def create_dimension(
    db: AsyncSession,
    model_version_id: uuid.UUID,
    data: DimensionCreate,
) -> CompetencyDimension:
    return await _create_dimension(db, model_version_id, data)


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
    loaded = await _load_job_model(db, model.id)

    template_data: dict = {
        "job_role": model.job_role,
        "dimensions": [],
    }

    for dim in (loaded.current_version.dimensions if loaded and loaded.current_version else []):
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
                skill_dict["knowledge_points"].append(
                    {
                        "name": kp.name,
                        "teaching_suggestion": kp.teaching_suggestion,
                        "difficulty": kp.difficulty,
                        "sort_order": kp.sort_order,
                    }
                )
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
    model_version_id: uuid.UUID,
    data: DimensionCreate,
) -> CompetencyDimension:
    dim = CompetencyDimension(
        model_version_id=model_version_id,
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

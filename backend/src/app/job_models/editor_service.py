"""Editor service for node reordering and bulk operations on job models."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.job_models.models import CompetencyDimension, JobModel, JobModelVersion, Skill, SkillKnowledgePoint


async def reorder_dimensions(
    db: AsyncSession, model_id: uuid.UUID, order_map: dict[uuid.UUID, int]
) -> list[CompetencyDimension]:
    """
    Reorder dimensions within a model.

    Args:
        order_map: {dimension_id: new_sort_order, ...}

    Returns: Updated list of dimensions
    """
    result = await db.execute(
        select(JobModel)
        .options(selectinload(JobModel.current_version).selectinload(JobModelVersion.dimensions))
        .where(JobModel.id == model_id)
    )
    model = result.scalar_one_or_none()
    dimensions = list(model.current_version.dimensions if model and model.current_version else [])

    for dim in dimensions:
        if dim.id in order_map:
            dim.sort_order = order_map[dim.id]

    await db.flush()
    return list(dimensions)


async def reorder_skills(
    db: AsyncSession, dimension_id: uuid.UUID, order_map: dict[uuid.UUID, int]
) -> list[Skill]:
    """Reorder skills within a dimension."""
    result = await db.execute(
        select(Skill).where(Skill.dimension_id == dimension_id)
    )
    skills = result.scalars().all()

    for skill in skills:
        if skill.id in order_map:
            skill.sort_order = order_map[skill.id]

    await db.flush()
    return list(skills)


async def reorder_knowledge_points(
    db: AsyncSession, skill_id: uuid.UUID, order_map: dict[uuid.UUID, int]
) -> list[SkillKnowledgePoint]:
    """Reorder knowledge points within a skill."""
    result = await db.execute(
        select(SkillKnowledgePoint).where(SkillKnowledgePoint.skill_id == skill_id)
    )
    kps = result.scalars().all()

    for kp in kps:
        if kp.id in order_map:
            kp.sort_order = order_map[kp.id]

    await db.flush()
    return list(kps)


async def move_skill_to_dimension(
    db: AsyncSession, skill_id: uuid.UUID, target_dimension_id: uuid.UUID
) -> Skill:
    """Move a skill from one dimension to another."""
    result = await db.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one()
    skill.dimension_id = target_dimension_id
    await db.flush()
    await db.refresh(skill)
    return skill


async def bulk_set_skill_level(
    db: AsyncSession, skill_ids: list[uuid.UUID], level: str
) -> int:
    """
    Set level for multiple skills.

    Returns: Count of skills updated
    """
    result = await db.execute(
        select(Skill).where(Skill.id.in_(skill_ids))
    )
    skills = result.scalars().all()

    for skill in skills:
        skill.level = level

    await db.flush()
    return len(skills)


async def bulk_set_kp_difficulty(
    db: AsyncSession, kp_ids: list[uuid.UUID], difficulty: str
) -> int:
    """
    Set difficulty for multiple knowledge points.

    Returns: Count of KPs updated
    """
    result = await db.execute(
        select(SkillKnowledgePoint).where(SkillKnowledgePoint.id.in_(kp_ids))
    )
    kps = result.scalars().all()

    for kp in kps:
        kp.difficulty = difficulty

    await db.flush()
    return len(kps)

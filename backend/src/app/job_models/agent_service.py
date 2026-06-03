"""Service helpers for agent-facing job model APIs."""

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.job_models.models import JobModel
from app.job_models.schemas import DimensionCreate
from app.job_models.service import _job_model_summary_query, get_job_model_by_id
from app.job_models.service import _create_dimension


async def search_agent_job_models(
    db: AsyncSession,
    *,
    org_id: uuid.UUID,
    skip: int = 0,
    limit: int = 50,
    q: str | None = None,
    model_type: str | None = None,
    industry_name: str | None = None,
    direction_name: str | None = None,
) -> tuple[list[JobModel], int]:
    filters = [JobModel.org_id == org_id, JobModel.deleted_at.is_(None)]
    if model_type:
        filters.append(JobModel.model_type == model_type)
    if industry_name:
        filters.append(JobModel.industry_name == industry_name)
    if direction_name:
        filters.append(JobModel.direction_name == direction_name)
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                JobModel.job_role.ilike(pattern),
                JobModel.job_family.ilike(pattern),
                JobModel.industry_name.ilike(pattern),
                JobModel.direction_name.ilike(pattern),
            )
        )

    total_result = await db.execute(
        select(func.count(JobModel.id)).select_from(JobModel).where(*filters)
    )
    total = total_result.scalar_one()

    result = await db.execute(
        _job_model_summary_query()
        .where(*filters)
        .order_by(JobModel.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all()), total


async def get_agent_job_model(
    db: AsyncSession,
    *,
    org_id: uuid.UUID,
    model_id: uuid.UUID,
) -> JobModel | None:
    model = await get_job_model_by_id(db, model_id)
    if model is None or model.org_id != org_id:
        return None
    return model


def render_job_model_markdown(model: JobModel) -> str:
    lines = [
        f"# {model.job_role}",
        "",
        f"- 模型类型：{model.model_type}",
        f"- 状态：{model.status}",
        f"- 产业：{model.industry_name or '未分类'}",
        f"- 方向：{model.direction_name or '未分类'}",
    ]
    if model.current_version is None:
        return "\n".join(lines) + "\n"

    version = model.current_version
    lines.extend(
        [
            f"- 当前版本：v{version.version}",
            "",
            "## 能力模型",
        ]
    )

    for dimension in version.dimensions:
        lines.extend(["", f"## {dimension.name}"])
        if dimension.description:
            lines.extend(["", dimension.description])
        for skill in dimension.skills:
            level = f"（{skill.level}）" if skill.level else ""
            lines.append(f"- **{skill.name}**{level}")
            if skill.description:
                lines.append(f"  - {skill.description}")
            for kp in skill.knowledge_points:
                difficulty = f" [{kp.difficulty}]" if kp.difficulty else ""
                lines.append(f"  - {kp.name}{difficulty}")
                if kp.teaching_suggestion:
                    lines.append(f"    - 教学建议：{kp.teaching_suggestion}")

    return "\n".join(lines) + "\n"


def count_current_structure(model: JobModel) -> dict[str, int]:
    version = model.current_version
    if version is None:
        return {"dimensions": 0, "skills": 0, "knowledge_points": 0}
    dimensions = len(version.dimensions)
    skills = sum(len(dimension.skills) for dimension in version.dimensions)
    knowledge_points = sum(
        len(skill.knowledge_points)
        for dimension in version.dimensions
        for skill in dimension.skills
    )
    return {
        "dimensions": dimensions,
        "skills": skills,
        "knowledge_points": knowledge_points,
    }


def count_proposed_structure(dimensions: list[DimensionCreate]) -> dict[str, int]:
    skills = sum(len(dimension.skills) for dimension in dimensions)
    knowledge_points = sum(
        len(skill.knowledge_points)
        for dimension in dimensions
        for skill in dimension.skills
    )
    return {
        "dimensions": len(dimensions),
        "skills": skills,
        "knowledge_points": knowledge_points,
    }


async def replace_current_version_structure(
    db: AsyncSession,
    model: JobModel,
    dimensions: list[DimensionCreate],
) -> JobModel:
    if model.current_version is None:
        raise ValueError("Model has no current version")

    model_id = model.id
    for dimension in list(model.current_version.dimensions):
        await db.delete(dimension)
    await db.flush()

    for dimension_data in dimensions:
        await _create_dimension(db, model.current_version.id, dimension_data)

    await db.flush()
    db.expire_all()
    loaded = await get_job_model_by_id(db, model_id)
    return loaded or model

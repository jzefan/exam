"""Tests for job model editor service: reordering and bulk operations."""

import asyncio
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base
from app.rbac.models import Organization
from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelProject,
    Skill,
    SkillKnowledgePoint,
)
from app.job_models.editor_service import (
    bulk_set_kp_difficulty,
    bulk_set_skill_level,
    move_skill_to_dimension,
    reorder_dimensions,
)

TEST_DATABASE_URL = "sqlite+aiosqlite:///test_job_models.db"


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def db_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine) -> AsyncSession:
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def base_data(db_session: AsyncSession):
    """Create a project + model for use in tests."""
    org = Organization(name="Editor Test Org", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()

    project = JobModelProject(
        name="Editor Test Project",
        org_id=org.id,
        created_by=uuid.uuid4(),
    )
    db_session.add(project)
    await db_session.flush()

    model = JobModel(
        project_id=project.id,
        job_role="Software Engineer",
    )
    db_session.add(model)
    await db_session.flush()

    return {"org": org, "project": project, "model": model}


@pytest.mark.asyncio
async def test_reorder_dimensions(db_session: AsyncSession, base_data: dict):
    """Create dimensions, reorder, verify sort_order."""
    model = base_data["model"]

    dim_a = CompetencyDimension(model_id=model.id, name="Dim A", sort_order=0)
    dim_b = CompetencyDimension(model_id=model.id, name="Dim B", sort_order=1)
    dim_c = CompetencyDimension(model_id=model.id, name="Dim C", sort_order=2)
    db_session.add_all([dim_a, dim_b, dim_c])
    await db_session.flush()

    # Reverse order: A→2, B→1, C→0
    order_map = {dim_a.id: 2, dim_b.id: 1, dim_c.id: 0}
    updated = await reorder_dimensions(db_session, model.id, order_map)

    id_to_order = {d.id: d.sort_order for d in updated}
    assert id_to_order[dim_a.id] == 2
    assert id_to_order[dim_b.id] == 1
    assert id_to_order[dim_c.id] == 0


@pytest.mark.asyncio
async def test_move_skill_to_dimension(db_session: AsyncSession, base_data: dict):
    """Create skill in dim A, move to dim B, verify dimension_id."""
    model = base_data["model"]

    dim_a = CompetencyDimension(model_id=model.id, name="Source Dim", sort_order=0)
    dim_b = CompetencyDimension(model_id=model.id, name="Target Dim", sort_order=1)
    db_session.add_all([dim_a, dim_b])
    await db_session.flush()

    skill = Skill(dimension_id=dim_a.id, name="Python", sort_order=0)
    db_session.add(skill)
    await db_session.flush()

    assert skill.dimension_id == dim_a.id

    moved = await move_skill_to_dimension(db_session, skill.id, dim_b.id)

    assert moved.dimension_id == dim_b.id


@pytest.mark.asyncio
async def test_bulk_set_skill_level(db_session: AsyncSession, base_data: dict):
    """Create skills, bulk set to 'L3', verify all have level='L3'."""
    model = base_data["model"]

    dim = CompetencyDimension(model_id=model.id, name="Bulk Level Dim", sort_order=0)
    db_session.add(dim)
    await db_session.flush()

    skills = [
        Skill(dimension_id=dim.id, name=f"Skill {i}", level="L1", sort_order=i)
        for i in range(4)
    ]
    db_session.add_all(skills)
    await db_session.flush()

    skill_ids = [s.id for s in skills]
    count = await bulk_set_skill_level(db_session, skill_ids, "L3")

    assert count == 4

    result = await db_session.execute(select(Skill).where(Skill.id.in_(skill_ids)))
    refreshed = result.scalars().all()
    assert all(s.level == "L3" for s in refreshed)


@pytest.mark.asyncio
async def test_bulk_set_kp_difficulty(db_session: AsyncSession, base_data: dict):
    """Create KPs, bulk set difficulty, verify all updated."""
    model = base_data["model"]

    dim = CompetencyDimension(model_id=model.id, name="Bulk Diff Dim", sort_order=0)
    db_session.add(dim)
    await db_session.flush()

    skill = Skill(dimension_id=dim.id, name="Algorithm", sort_order=0)
    db_session.add(skill)
    await db_session.flush()

    kps = [
        SkillKnowledgePoint(skill_id=skill.id, name=f"KP {i}", difficulty="easy", sort_order=i)
        for i in range(3)
    ]
    db_session.add_all(kps)
    await db_session.flush()

    kp_ids = [kp.id for kp in kps]
    count = await bulk_set_kp_difficulty(db_session, kp_ids, "hard")

    assert count == 3

    result = await db_session.execute(
        select(SkillKnowledgePoint).where(SkillKnowledgePoint.id.in_(kp_ids))
    )
    refreshed = result.scalars().all()
    assert all(kp.difficulty == "hard" for kp in refreshed)

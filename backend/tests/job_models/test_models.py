"""Unit tests for job_models SQLAlchemy models."""

import asyncio
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import select

from app.models import Base
from app.rbac.models import Organization
from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelProject,
    JobModelTemplate,
    Skill,
    SkillKnowledgePoint,
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
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine) -> AsyncSession:
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def org(db_session: AsyncSession) -> Organization:
    organization = Organization(name="Test Org", type="enterprise", is_active=True)
    db_session.add(organization)
    await db_session.flush()
    return organization


@pytest.fixture
def user_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.mark.asyncio
async def test_create_project(db_session: AsyncSession, org: Organization, user_id: uuid.UUID):
    project = JobModelProject(
        name="Test Project",
        industry="Technology",
        org_id=org.id,
        created_by=user_id,
    )
    db_session.add(project)
    await db_session.flush()

    assert project.id is not None
    assert project.status == "draft"


@pytest.mark.asyncio
async def test_create_full_hierarchy(db_session: AsyncSession, org: Organization, user_id: uuid.UUID):
    project = JobModelProject(
        name="Hierarchy Project",
        org_id=org.id,
        created_by=user_id,
    )
    db_session.add(project)
    await db_session.flush()

    job_model = JobModel(
        project_id=project.id,
        job_role="Software Engineer",
    )
    db_session.add(job_model)
    await db_session.flush()

    dimension = CompetencyDimension(
        model_id=job_model.id,
        name="Technical Skills",
        sort_order=1,
    )
    db_session.add(dimension)
    await db_session.flush()

    skill = Skill(
        dimension_id=dimension.id,
        name="Python Programming",
        sort_order=1,
    )
    db_session.add(skill)
    await db_session.flush()

    kp = SkillKnowledgePoint(
        skill_id=skill.id,
        name="Async/Await",
        difficulty="中级",
        sort_order=1,
    )
    db_session.add(kp)
    await db_session.commit()

    result = await db_session.execute(
        select(SkillKnowledgePoint).where(SkillKnowledgePoint.skill_id == skill.id)
    )
    kps = result.scalars().all()
    assert len(kps) == 1


@pytest.mark.asyncio
async def test_create_template(db_session: AsyncSession, user_id: uuid.UUID):
    template = JobModelTemplate(
        name="Software Engineer Template",
        industry="Technology",
        template_data={"dimensions": [], "skills": []},
        created_by=user_id,
    )
    db_session.add(template)
    await db_session.flush()

    assert template.id is not None
    assert template.usage_count == 0

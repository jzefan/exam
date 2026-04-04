"""Fixtures for job_models service tests."""

import asyncio
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base
from app.rbac.models import Organization
from app.job_models.schemas import ProjectCreate
from app.job_models.service import create_project

TEST_DATABASE_URL = "sqlite+aiosqlite:///test_job_models_service.db"


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


@pytest.fixture
async def project(db_session: AsyncSession, org: Organization, user_id: uuid.UUID):
    return await create_project(
        db_session,
        ProjectCreate(name="Test Project", industry="Technology"),
        org_id=org.id,
        user_id=user_id,
    )

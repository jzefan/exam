"""Fixtures for job_models service tests and router integration tests."""

import asyncio
import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.database import get_db
from app.job_models.schemas import JobModelCreate
from app.job_models.service import create_job_model
from app.main import app
from app.models import Base
from app.rbac.models import Organization, Role, UserOrganization

TEST_DATABASE_URL = "sqlite+aiosqlite:///test_job_models_service.db"
ROUTER_TEST_DATABASE_URL = "sqlite+aiosqlite:///test_job_models_router.db"


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
async def job_model(db_session: AsyncSession, org: Organization, user_id: uuid.UUID):
    return await create_job_model(
        db_session,
        org_id=org.id,
        user_id=user_id,
        data=JobModelCreate(
            job_role="Test Job Model",
            model_type="standard",
            status="draft",
            industry_name="Technology",
            direction_name="General",
            dimensions=[],
        ),
    )


# --- Router integration test fixtures ---


@pytest.fixture(scope="module")
async def router_db_engine():
    engine = create_async_engine(ROUTER_TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def router_db_session(router_db_engine) -> AsyncGenerator[AsyncSession, None]:
    session_factory = async_sessionmaker(router_db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(router_db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        try:
            yield router_db_session
            await router_db_session.commit()
        except Exception:
            await router_db_session.rollback()
            raise

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def admin_token(router_db_session: AsyncSession) -> str:
    unique_suffix = uuid.uuid4().hex[:8]
    admin = await create_user(
        router_db_session,
        UserCreate(
            username=f"admin_{unique_suffix}",
            email=f"admin_{unique_suffix}@example.com",
            password="adminpass123",
            full_name="Admin User",
        ),
    )

    org = Organization(name=f"Test Org {unique_suffix}", type="enterprise", is_active=True)
    router_db_session.add(org)
    await router_db_session.flush()

    admin_role = Role(name=f"admin_{unique_suffix}", display_name="Admin", is_system=False)
    router_db_session.add(admin_role)
    await router_db_session.flush()

    user_org = UserOrganization(
        user_id=admin.id,
        org_id=org.id,
        role_id=admin_role.id,
        is_primary=True,
        is_primary_role=True,
    )
    router_db_session.add(user_org)
    await router_db_session.commit()
    router_db_session.info["current_org_id"] = org.id
    return create_access_token(admin.id, "")


@pytest.fixture
async def admin_client(client: AsyncClient, admin_token: str) -> AsyncClient:
    client.headers.update({"Authorization": f"Bearer {admin_token}"})
    return client

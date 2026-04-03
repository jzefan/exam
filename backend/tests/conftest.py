import asyncio
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.rbac.models import Organization, Role, UserOrganization

TEST_DATABASE_URL = "sqlite+aiosqlite:///test.db"


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def db_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def admin_token(db_session: AsyncSession) -> str:
    admin = await create_user(
        db_session,
        UserCreate(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
            full_name="Admin User",
        ),
    )

    # Set up RBAC: org + admin role + assignment
    org = Organization(name="Test Org", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()

    admin_role = Role(name="admin", display_name="Admin", is_system=True)
    db_session.add(admin_role)
    await db_session.flush()

    user_org = UserOrganization(
        user_id=admin.id, org_id=org.id, role_id=admin_role.id, is_primary=True
    )
    db_session.add(user_org)
    await db_session.commit()
    return create_access_token(admin.id, "")


@pytest.fixture
async def admin_client(client: AsyncClient, admin_token: str) -> AsyncClient:
    client.headers.update({"Authorization": f"Bearer {admin_token}"})
    return client

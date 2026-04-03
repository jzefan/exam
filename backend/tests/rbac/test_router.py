import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_list_organizations_unauthenticated() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/organizations")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_roles_unauthenticated() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/roles")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_permissions_unauthenticated() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/permissions")
    assert response.status_code == 401

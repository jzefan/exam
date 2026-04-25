import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_register_and_login(client: AsyncClient) -> None:
    # Register
    register_data = {
        "username": "testuser",
        "email": "test@example.com",
        "password": "testpass123",
        "full_name": "Test User",
    }
    response = await client.post("/api/auth/register", json=register_data)
    assert response.status_code == 201
    user = response.json()
    assert user["username"] == "testuser"
    assert user["is_active"] is True

    # Login
    login_data = {"username": "testuser", "password": "testpass123"}
    response = await client.post("/api/auth/login", json=login_data)
    assert response.status_code == 200
    token_data = response.json()
    assert "access_token" in token_data
    assert token_data["user"]["username"] == "testuser"

    # Get me
    headers = {"Authorization": f"Bearer {token_data['access_token']}"}
    response = await client.get("/api/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["username"] == "testuser"


@pytest.mark.asyncio
async def test_register_duplicate_username(client: AsyncClient) -> None:
    register_data = {
        "username": "dupuser",
        "email": "dup1@example.com",
        "password": "testpass123",
        "full_name": "Dup User",
    }
    await client.post("/api/auth/register", json=register_data)

    register_data["email"] = "dup2@example.com"
    response = await client.post("/api/auth/register", json=register_data)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient) -> None:
    response = await client.post("/api/auth/login", json={"username": "noone", "password": "wrong"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_external_guest_cannot_password_login(client: AsyncClient, db_session: AsyncSession) -> None:
    user = User(
        username="extguest",
        email="extguest@example.com",
        password_hash=hash_password("realpass123"),
        full_name="External Guest",
        user_type="external_guest",
    )
    db_session.add(user)
    await db_session.commit()

    response = await client.post(
        "/api/auth/login",
        json={"username": "extguest", "password": "realpass123"},
    )

    assert response.status_code == 401
    assert "invitation" in response.json()["detail"].lower()

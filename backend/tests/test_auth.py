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
async def test_register_accepts_persona_and_defaults_to_teacher(client: AsyncClient) -> None:
    response = await client.post(
        "/api/auth/register",
        json={
            "username": "assessor-user",
            "email": "assessor@example.com",
            "password": "testpass123",
            "full_name": "Assessor User",
            "role_name": "evaluator",
            "persona": "assessor",
        },
    )

    assert response.status_code == 201
    assert response.json()["persona"] == "assessor"
    assert response.json()["system_domain"] == "exam"

    default_response = await client.post(
        "/api/auth/register",
        json={
            "username": "teacher-persona-user",
            "email": "teacher-persona@example.com",
            "password": "testpass123",
            "full_name": "Teacher Persona User",
            "role_name": "evaluator",
        },
    )

    assert default_response.status_code == 201
    assert default_response.json()["persona"] == "teacher"


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
async def test_login_reports_missing_account(client: AsyncClient) -> None:
    response = await client.post("/api/auth/login", json={"username": "noone", "password": "wrong"})
    assert response.status_code == 401
    assert response.json()["detail"] == "账号不存在，请检查用户名或手机号"


@pytest.mark.asyncio
async def test_login_reports_wrong_password(client: AsyncClient) -> None:
    await client.post(
        "/api/auth/register",
        json={
            "username": "password-user",
            "email": "password-user@example.com",
            "password": "right-password",
            "full_name": "Password User",
        },
    )

    response = await client.post(
        "/api/auth/login",
        json={"username": "password-user", "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "密码错误，请重新输入"


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


@pytest.mark.asyncio
async def test_forgot_password_requires_admin_when_user_has_no_real_email(client: AsyncClient) -> None:
    await client.post(
        "/api/auth/register",
        json={
            "username": "no-email-user",
            "password": "testpass123",
            "full_name": "No Email User",
        },
    )

    response = await client.post(
        "/api/auth/forgot-password",
        json={"account": "no-email-user"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "contact_admin"
    assert "管理员" in payload["message"]
    assert payload["email"] is None


@pytest.mark.asyncio
async def test_forgot_password_returns_masked_email_when_user_has_email(client: AsyncClient) -> None:
    sent_messages: list[dict[str, str]] = []

    async def fake_send_password_reset_email(*, to_email: str, reset_url: str) -> None:
        sent_messages.append({"to_email": to_email, "reset_url": reset_url})

    from app.auth import router as auth_router

    original_sender = auth_router.send_password_reset_email
    auth_router.send_password_reset_email = fake_send_password_reset_email
    await client.post(
        "/api/auth/register",
        json={
            "username": "email-user",
            "email": "reset-user@example.com",
            "password": "testpass123",
            "full_name": "Email User",
        },
    )

    try:
        response = await client.post(
            "/api/auth/forgot-password",
            json={"account": "email-user"},
        )
    finally:
        auth_router.send_password_reset_email = original_sender

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "email_sent"
    assert payload["email"] == "r***r@example.com"
    assert "重置链接已发送" in payload["message"]
    assert sent_messages[0]["to_email"] == "reset-user@example.com"
    assert "/reset-password?token=" in sent_messages[0]["reset_url"]


@pytest.mark.asyncio
async def test_reset_password_with_email_token(client: AsyncClient) -> None:
    sent_messages: list[dict[str, str]] = []

    async def fake_send_password_reset_email(*, to_email: str, reset_url: str) -> None:
        sent_messages.append({"to_email": to_email, "reset_url": reset_url})

    from app.auth import router as auth_router

    original_sender = auth_router.send_password_reset_email
    auth_router.send_password_reset_email = fake_send_password_reset_email
    await client.post(
        "/api/auth/register",
        json={
            "username": "reset-user",
            "email": "reset-password@example.com",
            "password": "oldpass123",
            "full_name": "Reset Password User",
        },
    )

    try:
        await client.post("/api/auth/forgot-password", json={"account": "reset-user"})
    finally:
        auth_router.send_password_reset_email = original_sender

    token = sent_messages[0]["reset_url"].split("token=", 1)[1]
    reset_response = await client.post(
        "/api/auth/reset-password",
        json={"token": token, "password": "newpass123"},
    )
    assert reset_response.status_code == 200
    assert reset_response.json()["message"] == "密码已重置，请使用新密码登录"

    old_login = await client.post(
        "/api/auth/login",
        json={"username": "reset-user", "password": "oldpass123"},
    )
    assert old_login.status_code == 401

    new_login = await client.post(
        "/api/auth/login",
        json={"username": "reset-user", "password": "newpass123"},
    )
    assert new_login.status_code == 200


@pytest.mark.asyncio
async def test_forgot_password_reports_missing_account(client: AsyncClient) -> None:
    response = await client.post(
        "/api/auth/forgot-password",
        json={"account": "missing-user"},
    )

    assert response.status_code == 404
    assert "账号" in response.json()["detail"]

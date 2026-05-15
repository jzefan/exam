import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token, verify_password
from app.auth.service import build_user_response, create_user, force_change_password_for_student
from app.rbac.models import Organization, Role


async def _seed_roles_and_org(db_session):
    org = Organization(name="Force Change School", type="school", is_active=True)
    roles = [
        Role(name="teacher", display_name="Teacher", is_system=True),
        Role(name="student", display_name="Student", is_system=True),
    ]
    db_session.add(org)
    db_session.add_all(roles)
    await db_session.flush()
    return org


@pytest.mark.asyncio
async def test_create_student_sets_must_change_password_true(db_session) -> None:
    org = await _seed_roles_and_org(db_session)

    user = await create_user(
        db_session,
        UserCreate(
            username="student-force-change",
            email="student-force-change@example.com",
            password="init1234",
            full_name="Student Force Change",
            role_name="student",
            org_id=org.id,
        ),
    )

    assert user.must_change_password is True


@pytest.mark.asyncio
async def test_create_teacher_keeps_must_change_password_false(db_session) -> None:
    org = await _seed_roles_and_org(db_session)

    user = await create_user(
        db_session,
        UserCreate(
            username="teacher-no-force-change",
            email="teacher-no-force-change@example.com",
            password="init1234",
            full_name="Teacher No Force Change",
            role_name="teacher",
            org_id=org.id,
        ),
    )

    assert user.must_change_password is False


@pytest.mark.asyncio
async def test_force_change_password_clears_flag_and_updates_hash(db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    student = await create_user(
        db_session,
        UserCreate(
            username="student-password-update",
            email="student-password-update@example.com",
            password="init1234",
            full_name="Student Password Update",
            role_name="student",
            org_id=org.id,
        ),
    )

    updated = await force_change_password_for_student(db_session, student, "newpass123")

    assert updated.must_change_password is False
    assert verify_password("newpass123", updated.password_hash) is True


@pytest.mark.asyncio
async def test_force_change_password_requires_minimum_length(db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    student = await create_user(
        db_session,
        UserCreate(
            username="student-short-password",
            email="student-short-password@example.com",
            password="init1234",
            full_name="Student Short Password",
            role_name="student",
            org_id=org.id,
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        await force_change_password_for_student(db_session, student, "12345")

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "密码至少需要6位"


@pytest.mark.asyncio
async def test_user_response_includes_must_change_password(db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    student = await create_user(
        db_session,
        UserCreate(
            username="student-response-flag",
            email="student-response-flag@example.com",
            password="init1234",
            full_name="Student Response Flag",
            role_name="student",
            org_id=org.id,
        ),
    )

    response = await build_user_response(db_session, student)

    assert response.must_change_password is True


# ── endpoint integration tests ──────────────────────────────────────────────

async def _create_student_and_token(db_session, username: str, org) -> tuple:
    student = await create_user(
        db_session,
        UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="init1234",
            full_name="Student",
            role_name="student",
            org_id=org.id,
        ),
    )
    await db_session.flush()
    token = create_access_token(student.id, "")
    return student, token


async def _create_teacher_and_token(db_session, username: str, org) -> tuple:
    teacher = await create_user(
        db_session,
        UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="init1234",
            full_name="Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    await db_session.flush()
    token = create_access_token(teacher.id, "")
    return teacher, token


@pytest.mark.asyncio
async def test_login_response_includes_must_change_password(client: AsyncClient, db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    await create_user(
        db_session,
        UserCreate(
            username="student-login-flag",
            email="student-login-flag@example.com",
            password="init1234",
            full_name="Student Login Flag",
            role_name="student",
            org_id=org.id,
        ),
    )
    await db_session.flush()

    response = await client.post("/api/auth/login", json={"username": "student-login-flag", "password": "init1234"})

    assert response.status_code == 200
    assert response.json()["user"]["must_change_password"] is True


@pytest.mark.asyncio
async def test_force_change_password_endpoint_clears_flag(client: AsyncClient, db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    _student, token = await _create_student_and_token(db_session, "student-ep-clear", org)

    response = await client.post(
        "/api/auth/force-change-password",
        json={"password": "newpass123", "confirm_password": "newpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["must_change_password"] is False
    assert body["message"] == "密码修改成功"


@pytest.mark.asyncio
async def test_force_change_password_rejects_already_cleared_student(client: AsyncClient, db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    student, token = await _create_student_and_token(db_session, "student-ep-cleared", org)
    student.must_change_password = False
    await db_session.flush()

    response = await client.post(
        "/api/auth/force-change-password",
        json={"password": "newpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_force_change_password_rejects_non_student(client: AsyncClient, db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    _teacher, token = await _create_teacher_and_token(db_session, "teacher-ep-reject", org)

    response = await client.post(
        "/api/auth/force-change-password",
        json={"password": "newpass123"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_force_change_password_rejects_mismatched_confirm(client: AsyncClient, db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    _student, token = await _create_student_and_token(db_session, "student-ep-mismatch", org)

    response = await client.post(
        "/api/auth/force-change-password",
        json={"password": "newpass123", "confirm_password": "different456"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_admin_password_reset_rearms_student_flag(client: AsyncClient, db_session) -> None:
    org = await _seed_roles_and_org(db_session)
    # Add platform_admin role
    from sqlalchemy import select
    from app.rbac.models import UserOrganization
    from app.auth.models import User

    admin_role = Role(name="platform_admin", display_name="Platform Admin", is_system=True)
    db_session.add(admin_role)
    await db_session.flush()

    admin = await create_user(
        db_session,
        UserCreate(
            username="admin-rearm",
            email="admin-rearm@example.com",
            password="adminpass123",
            full_name="Admin Rearm",
            org_id=org.id,
        ),
    )
    uo = UserOrganization(user_id=admin.id, org_id=org.id, role_id=admin_role.id, is_primary=True, is_primary_role=True)
    db_session.add(uo)
    await db_session.flush()

    student, _ = await _create_student_and_token(db_session, "student-rearm", org)
    student.must_change_password = False
    await db_session.flush()

    admin_token = create_access_token(admin.id, "")
    response = await client.put(
        f"/api/users/{student.id}",
        json={"password": "resetpass123"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    assert response.json()["must_change_password"] is True

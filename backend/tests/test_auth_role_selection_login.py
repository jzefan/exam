"""Two-step login for accounts that hold more than one role."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import UserCreate
from app.auth.security import create_role_selection_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user

PASSWORD = "pw123456"


async def _role(db: AsyncSession, name: str) -> Role:
    return (
        await db.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    ).scalar_one()


async def _org(db: AsyncSession, name: str) -> Organization:
    org = Organization(name=name, type="school", is_active=True)
    db.add(org)
    await db.flush()
    return org


@pytest.mark.asyncio
async def test_single_role_login_skips_role_selection(client: AsyncClient, db_session: AsyncSession):
    await seed_roles(db_session)
    org = await _org(db_session, "卫生健康职业学院")
    await create_user(
        db_session,
        UserCreate(
            username="solo-teacher",
            email="solo@example.com",
            password=PASSWORD,
            full_name="单独老师",
            role_names=["teacher"],
            org_id=org.id,
        ),
    )
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"username": "solo-teacher", "password": PASSWORD}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requires_role_selection"] is False
    assert body["access_token"]
    assert body["user"]["primary_org"]["role_name"] == "teacher"
    assert body["roles"] == []


@pytest.mark.asyncio
async def test_multi_role_login_returns_deduplicated_role_choices(
    client: AsyncClient, db_session: AsyncSession
):
    await seed_roles(db_session)
    org_a = await _org(db_session, "卫生健康职业学院")
    org_b = await _org(db_session, "附属医院")
    org_c = await _org(db_session, "继续教育学院")

    user = await create_user(
        db_session,
        UserCreate(
            username="13900000009",
            email="13900000009@example.com",
            password=PASSWORD,
            full_name="身兼数职",
            role_names=["teacher"],
            org_id=org_a.id,
        ),
    )
    student_role = await _role(db_session, "student")
    await add_role_to_user(db_session, user.id, org_b.id, student_role.id)
    await add_role_to_user(db_session, user.id, org_c.id, student_role.id)
    await db_session.commit()

    response = await client.post(
        "/api/auth/login", json={"username": "13900000009", "password": PASSWORD}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requires_role_selection"] is True
    assert body["access_token"] is None
    assert body["selection_token"]

    roles = {role["name"]: role for role in body["roles"]}
    assert set(roles) == {"student", "teacher"}
    # Same role in two organizations is still one choice.
    assert set(roles["student"]["org_names"]) == {"附属医院", "继续教育学院"}
    assert roles["teacher"]["org_names"] == ["卫生健康职业学院"]


@pytest.mark.asyncio
async def test_select_role_exchanges_ticket_for_token(client: AsyncClient, db_session: AsyncSession):
    await seed_roles(db_session)
    org_a = await _org(db_session, "卫生健康职业学院")
    org_b = await _org(db_session, "附属医院")
    user = await create_user(
        db_session,
        UserCreate(
            username="13900000010",
            email="13900000010@example.com",
            password=PASSWORD,
            full_name="身兼数职",
            role_names=["teacher"],
            org_id=org_a.id,
        ),
    )
    student_role = await _role(db_session, "student")
    await add_role_to_user(db_session, user.id, org_b.id, student_role.id)
    await db_session.commit()

    first = await client.post(
        "/api/auth/login", json={"username": "13900000010", "password": PASSWORD}
    )
    ticket = first.json()["selection_token"]

    response = await client.post(
        "/api/auth/login/select-role",
        json={"selection_token": ticket, "role_name": "student"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    # The chosen identity drives which workspace the client lands in.
    assert body["user"]["primary_org"]["role_name"] == "student"
    assert body["user"]["primary_org"]["org_name"] == "附属医院"


@pytest.mark.asyncio
async def test_role_selection_rejects_bad_ticket_and_unknown_role(
    client: AsyncClient, db_session: AsyncSession
):
    await seed_roles(db_session)
    org = await _org(db_session, "卫生健康职业学院")
    user = await create_user(
        db_session,
        UserCreate(
            username="13900000011",
            email="13900000011@example.com",
            password=PASSWORD,
            full_name="单独老师",
            role_names=["teacher"],
            org_id=org.id,
        ),
    )
    await db_session.commit()

    expired = await client.post(
        "/api/auth/login/select-role",
        json={"selection_token": "not-a-ticket", "role_name": "teacher"},
    )
    assert expired.status_code == 401
    assert "重新登录" in expired.json()["detail"]

    wrong_role = await client.post(
        "/api/auth/login/select-role",
        json={
            "selection_token": create_role_selection_token(user.id),
            "role_name": "platform_admin",
        },
    )
    assert wrong_role.status_code == 400
    assert "所选角色" in wrong_role.json()["detail"]


@pytest.mark.asyncio
async def test_single_role_login_with_explicit_role_name(client: AsyncClient, db_session: AsyncSession):
    await seed_roles(db_session)
    org = await _org(db_session, "卫生健康职业学院")
    await create_user(
        db_session,
        UserCreate(
            username="solo-teacher-2",
            email="solo2@example.com",
            password=PASSWORD,
            full_name="单独老师",
            role_names=["teacher"],
            org_id=org.id,
        ),
    )
    await db_session.commit()

    response = await client.post(
        "/api/auth/login",
        json={"username": "solo-teacher-2", "password": PASSWORD, "role_name": "teacher"},
    )

    assert response.status_code == 200
    assert response.json()["access_token"]

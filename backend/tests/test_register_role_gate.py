"""Self-registration may only mint staff-side roles.

Students get their account from a teacher (`rbac` service: username = phone or
student id, first login forces a password change), so anything a student - or an
anonymous caller - asks for beyond teacher/evaluator must be refused outright.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Organization, Role, TeacherStudent

ROLE_HINT = "注册仅支持教师或机构用户身份；学生账号由任课老师创建，无需注册"


def _payload(**overrides: object) -> dict:
    data: dict = {
        "username": "gate-user",
        "email": "gate-user@example.com",
        "password": "testpass123",
        "full_name": "Gate User",
    }
    data.update(overrides)
    return data


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"role_name": "platform_admin"},
        {"role_name": "school_admin"},
        {"role_name": "student"},
        {"role_names": ["teacher", "platform_admin"]},
    ],
)
async def test_register_rejects_roles_outside_allow_list(
    client: AsyncClient, overrides: dict
) -> None:
    response = await client.post("/api/auth/register", json=_payload(**overrides))

    assert response.status_code == 422
    assert response.json()["detail"] == ROLE_HINT

    # Refused up front, so no account may exist afterwards.
    login = await client.post(
        "/api/auth/login", json={"username": "gate-user", "password": "testpass123"}
    )
    assert login.status_code == 401


@pytest.mark.asyncio
async def test_register_keeps_accepting_teacher_and_evaluator(client: AsyncClient) -> None:
    for index, role_name in enumerate(["teacher", "evaluator"]):
        response = await client.post(
            "/api/auth/register",
            json=_payload(
                username=f"staff-{index}",
                email=f"staff-{index}@example.com",
                role_name=role_name,
            ),
        )
        assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_register_keeps_schema_default_when_role_is_omitted(client: AsyncClient) -> None:
    """Only an explicitly requested role is checked, so older callers still work."""
    response = await client.post("/api/auth/register", json=_payload())

    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_register_ignores_client_supplied_org_and_teacher(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    default_org = Organization(name="Default Org", type="school", is_active=True)
    db_session.add(default_org)
    db_session.add(Role(name="teacher", display_name="Teacher"))
    await db_session.commit()

    bogus_org_id = uuid.uuid4()
    bogus_teacher_id = uuid.uuid4()
    response = await client.post(
        "/api/auth/register",
        json=_payload(
            role_name="teacher",
            org_id=str(bogus_org_id),
            owner_teacher_id=str(bogus_teacher_id),
            teacher_ids=[str(bogus_teacher_id)],
        ),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["owner_teacher_id"] is None
    assert [org["org_id"] for org in body["organizations"]] == [str(default_org.id)]

    links = (
        await db_session.execute(
            select(TeacherStudent).where(
                TeacherStudent.student_id == uuid.UUID(body["id"])
            )
        )
    ).scalars().all()
    assert links == []

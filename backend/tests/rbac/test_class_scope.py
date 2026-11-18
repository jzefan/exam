import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Class, Organization, Role
from app.rbac.schemas import StudentCreate
from app.rbac.service import create_student


async def _create_org(db_session, name: str) -> Organization:
    org = Organization(name=name, type="school", is_active=True)
    db_session.add(org)
    await db_session.flush()

    existing_roles = set((await db_session.execute(select(Role.name))).scalars().all())
    for role_name in ("teacher", "student"):
        if role_name not in existing_roles:
            db_session.add(
                Role(name=role_name, display_name=role_name.title(), is_system=True)
            )
    await db_session.flush()
    return org


async def _create_teacher(db_session, org_id, *, username: str) -> User:
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="teacherpass123",
            full_name=username,
            role_name="teacher",
            org_id=org_id,
        ),
    )


def _auth_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id, '')}"}


@pytest.mark.asyncio
async def test_same_school_duplicate_class_name_is_rejected(client: AsyncClient, db_session) -> None:
    org = await _create_org(db_session, "Same School")
    owner = await _create_teacher(db_session, org.id, username="class-owner")
    colleague = await _create_teacher(db_session, org.id, username="class-colleague")
    org_id = org.id
    await db_session.commit()

    created = await client.post(
        "/api/rbac/students/classes",
        headers=_auth_headers(owner),
        json={"name": "2025级健康大数据班"},
    )
    assert created.status_code == 201

    # Whitespace-only differences must not bypass school-level uniqueness.
    duplicate = await client.post(
        "/api/rbac/students/classes",
        headers=_auth_headers(colleague),
        json={"name": "  2025级健康大数据班  "},
    )
    assert duplicate.status_code == 409
    assert "同名班级" in duplicate.json()["detail"]

    count = await db_session.scalar(select(func.count()).select_from(Class).where(Class.org_id == org_id))
    assert count == 1


@pytest.mark.asyncio
async def test_different_schools_may_use_the_same_class_name(client: AsyncClient, db_session) -> None:
    first_org = await _create_org(db_session, "School A")
    second_org = await _create_org(db_session, "School B")
    first_teacher = await _create_teacher(db_session, first_org.id, username="school-a-teacher")
    second_teacher = await _create_teacher(db_session, second_org.id, username="school-b-teacher")
    first_org_id = first_org.id
    second_org_id = second_org.id
    await db_session.commit()

    first = await client.post(
        "/api/rbac/students/classes",
        headers=_auth_headers(first_teacher),
        json={"name": "2025级健康大数据班"},
    )
    second = await client.post(
        "/api/rbac/students/classes",
        headers=_auth_headers(second_teacher),
        json={"name": "2025级健康大数据班"},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["org_id"] == str(first_org_id)
    assert second.json()["org_id"] == str(second_org_id)


@pytest.mark.asyncio
async def test_resolve_finds_a_colleagues_class_with_member_count(client: AsyncClient, db_session) -> None:
    org = await _create_org(db_session, "Resolve School")
    owner = await _create_teacher(db_session, org.id, username="resolve-owner")
    colleague = await _create_teacher(db_session, org.id, username="resolve-colleague")
    org_id = org.id
    await db_session.commit()

    created = await client.post(
        "/api/rbac/students/classes",
        headers=_auth_headers(owner),
        json={"name": "2025级健康大数据班"},
    )
    class_id = created.json()["id"]
    for index in range(2):
        await create_student(
            db_session,
            org_id,
            StudentCreate(
                full_name=f"Student {index}",
                phone=f"1390000{index:04d}",
                student_id=f"S{index:04d}",
                class_id=class_id,
            ),
            owner_teacher_id=owner.id,
        )
    await db_session.commit()

    # The colleague's teacher-scoped class list does not contain the class yet.
    visible = await client.get("/api/rbac/students/classes", headers=_auth_headers(colleague))
    assert visible.status_code == 200
    assert [item["id"] for item in visible.json()] == []

    response = await client.post(
        "/api/rbac/students/classes/resolve",
        headers=_auth_headers(colleague),
        json={"names": [" 2025级健康大数据班 "]},
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["name"] == "2025级健康大数据班"
    match = items[0]["matches"][0]
    assert match["id"] == class_id
    assert match["member_count"] == 2
    assert match["created_by_name"] == "resolve-owner"


@pytest.mark.asyncio
async def test_colleague_can_import_into_the_resolved_school_class(client: AsyncClient, db_session) -> None:
    org = await _create_org(db_session, "Shared Class School")
    owner = await _create_teacher(db_session, org.id, username="shared-owner")
    colleague = await _create_teacher(db_session, org.id, username="shared-colleague")
    org_id = org.id
    await db_session.commit()

    created = await client.post(
        "/api/rbac/students/classes",
        headers=_auth_headers(owner),
        json={"name": "2025级健康大数据班"},
    )
    class_id = created.json()["id"]

    reused = await client.post(
        "/api/rbac/students",
        headers=_auth_headers(colleague),
        json={
            "full_name": "Shared Student",
            "phone": "13900009999",
            "student_id": "S9999",
            "class_id": class_id,
        },
    )
    assert reused.status_code == 201
    assert reused.json()["class_id"] == class_id

    visible = await client.get("/api/rbac/students/classes", headers=_auth_headers(colleague))
    assert [item["id"] for item in visible.json()] == [class_id]

    # The class keeps a single copy; the second teacher did not create a new one.
    count = await db_session.scalar(
        select(func.count()).select_from(Class).where(Class.org_id == org_id)
    )
    assert count == 1


@pytest.mark.asyncio
async def test_resolve_is_scoped_to_the_callers_school(client: AsyncClient, db_session) -> None:
    first_org = await _create_org(db_session, "Resolve A")
    second_org = await _create_org(db_session, "Resolve B")
    first_teacher = await _create_teacher(db_session, first_org.id, username="resolve-a")
    second_teacher = await _create_teacher(db_session, second_org.id, username="resolve-b")
    await db_session.commit()

    await client.post(
        "/api/rbac/students/classes",
        headers=_auth_headers(second_teacher),
        json={"name": "同名班级"},
    )

    response = await client.post(
        "/api/rbac/students/classes/resolve",
        headers=_auth_headers(first_teacher),
        json={"names": ["同名班级"]},
    )

    assert response.status_code == 200
    assert response.json()["items"] == []

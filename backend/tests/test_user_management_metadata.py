import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role
from app.rbac.schemas import StudentCreate
from app.rbac.service import create_student


async def _seed_roles_and_org(db_session):
    org = Organization(name="岗位模型学校", type="school", is_active=True)
    roles = [
        Role(name="platform_admin", display_name="Platform Admin", is_system=True),
        Role(name="teacher", display_name="Teacher", is_system=True),
        Role(name="student", display_name="Student", is_system=True),
        Role(name="school_admin", display_name="School Admin", is_system=True),
        Role(name="enterprise_admin", display_name="Enterprise Admin", is_system=True),
        Role(name="enterprise_user", display_name="Enterprise User", is_system=True),
    ]
    db_session.add(org)
    db_session.add_all(roles)
    await db_session.flush()
    return org


@pytest.mark.asyncio
async def test_user_list_includes_domain_and_teacher_relationship_metadata(
    client: AsyncClient, db_session
) -> None:
    org = await _seed_roles_and_org(db_session)
    admin = await create_user(
        db_session,
        UserCreate(
            username="platform-admin-meta",
            email="platform-admin-meta@example.com",
            password="adminpass123",
            full_name="Platform Admin",
            role_name="platform_admin",
            org_id=org.id,
        ),
    )
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-meta",
            email="teacher-meta@example.com",
            password="teacherpass123",
            full_name="Teacher Meta",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Student Meta", phone="13920000001", student_id="UM001"),
        owner_teacher_id=teacher.id,
    )
    await create_user(
        db_session,
        UserCreate(
            username="school-admin-meta",
            email="school-admin-meta@example.com",
            password="schoolpass123",
            full_name="School Admin Meta",
            role_name="school_admin",
            org_id=org.id,
        ),
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(admin.id, '')}"})
    response = await client.get("/api/users")

    assert response.status_code == 200
    payload = {item["username"]: item for item in response.json()}

    assert payload["platform-admin-meta"]["system_domain"] == "platform"
    assert payload["teacher-meta"]["system_domain"] == "exam"
    assert payload["teacher-meta"]["managed_student_count"] == 1
    assert payload["teacher-meta"]["owner_teacher_name"] is None
    assert payload["teacher-meta"]["owner_teacher_id"] is None
    assert payload["13920000001"]["system_domain"] == "exam"
    assert payload["13920000001"]["owner_teacher_id"] == str(teacher.id)
    assert payload["13920000001"]["owner_teacher_name"] == "Teacher Meta"
    assert payload["13920000001"]["teacher_ids"] == [str(teacher.id)]
    assert payload["13920000001"]["teacher_names"] == ["Teacher Meta"]
    assert payload["school-admin-meta"]["system_domain"] == "job_model"


@pytest.mark.asyncio
async def test_platform_admin_can_reassign_student_owner_teacher(
    client: AsyncClient, db_session
) -> None:
    org = await _seed_roles_and_org(db_session)
    admin = await create_user(
        db_session,
        UserCreate(
            username="platform-admin-update",
            email="platform-admin-update@example.com",
            password="adminpass123",
            full_name="Platform Admin Update",
            role_name="platform_admin",
            org_id=org.id,
        ),
    )
    teacher_a = await create_user(
        db_session,
        UserCreate(
            username="teacher-owner-a",
            email="teacher-owner-a@example.com",
            password="teacherpass123",
            full_name="Teacher Owner A",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    teacher_b = await create_user(
        db_session,
        UserCreate(
            username="teacher-owner-b",
            email="teacher-owner-b@example.com",
            password="teacherpass123",
            full_name="Teacher Owner B",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Student Owner", phone="13920000002", student_id="UM002"),
        owner_teacher_id=teacher_a.id,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(admin.id, '')}"})
    response = await client.put(
        f"/api/users/{student.id}",
        json={
            "full_name": "Student Owner",
            "email": student.email,
            "role_names": ["student"],
            "teacher_ids": [str(teacher_b.id)],
            "is_active": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["owner_teacher_id"] == str(teacher_b.id)
    assert response.json()["owner_teacher_name"] == "Teacher Owner B"
    assert response.json()["teacher_ids"] == [str(teacher_b.id)]
    assert response.json()["teacher_names"] == ["Teacher Owner B"]


@pytest.mark.asyncio
async def test_platform_admin_can_filter_users_by_primary_role(
    client: AsyncClient, db_session
) -> None:
    org = await _seed_roles_and_org(db_session)
    admin = await create_user(
        db_session,
        UserCreate(
            username="platform-admin-filter",
            email="platform-admin-filter@example.com",
            password="adminpass123",
            full_name="Platform Admin Filter",
            role_name="platform_admin",
            org_id=org.id,
        ),
    )
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-filter",
            email="teacher-filter@example.com",
            password="teacherpass123",
            full_name="Teacher Filter",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    await create_user(
        db_session,
        UserCreate(
            username="school-admin-filter",
            email="school-admin-filter@example.com",
            password="schoolpass123",
            full_name="School Admin Filter",
            role_name="school_admin",
            org_id=org.id,
        ),
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(admin.id, '')}"})
    response = await client.get("/api/users?role_name=teacher")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == str(teacher.id)
    assert payload[0]["primary_org"]["role_name"] == "teacher"

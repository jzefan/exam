import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role
from app.rbac.schemas import StudentCreate
from app.rbac.service import create_student


async def _create_org_with_roles(db_session):
    org = Organization(name="Student Scope School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()
    return org


async def _create_teacher(db_session, org_id, *, username: str, email: str, full_name: str) -> User:
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=email,
            password="teacherpass123",
            full_name=full_name,
            role_name="teacher",
            org_id=org_id,
        ),
    )


@pytest.mark.asyncio
async def test_teacher_only_sees_owned_students(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-owner",
        email="teacher-student-owner@example.com",
        full_name="Teacher Student Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-other",
        email="teacher-student-other@example.com",
        full_name="Teacher Student Other",
    )
    own_student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Own Student", phone="13900000001", student_id="S001"),
        owner_teacher_id=teacher.id,
    )
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Other Student", phone="13900000002", student_id="S002"),
        owner_teacher_id=other_teacher.id,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students")

    assert response.status_code == 200
    assert [item["username"] for item in response.json()] == [own_student.username]
    assert response.json()[0]["owner_teacher_id"] == str(teacher.id)


@pytest.mark.asyncio
async def test_teacher_created_student_is_owned_by_teacher(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-create",
        email="teacher-student-create@example.com",
        full_name="Teacher Student Create",
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/rbac/students",
        json={"full_name": "Created Student", "phone": "13900000003", "student_id": "S003"},
    )

    assert response.status_code == 201
    assert response.json()["owner_teacher_id"] == str(teacher.id)

    student = await db_session.scalar(select(User).where(User.phone == "13900000003"))
    assert student is not None
    assert student.owner_teacher_id == teacher.id

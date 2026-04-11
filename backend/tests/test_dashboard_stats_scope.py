import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role
from app.rbac.schemas import StudentCreate
from app.rbac.service import create_student, ensure_teacher_student_link


async def _create_org_with_roles(db_session):
    org = Organization(name="Dashboard Scope School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()
    return org


@pytest.mark.asyncio
async def test_teacher_dashboard_student_count_only_includes_owned_students(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-dashboard-owner",
            email="teacher-dashboard-owner@example.com",
            password="teacherpass123",
            full_name="Teacher Dashboard Owner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    other_teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-dashboard-other",
            email="teacher-dashboard-other@example.com",
            password="teacherpass123",
            full_name="Teacher Dashboard Other",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Owned Student", phone="13910000001", student_id="DS001"),
        owner_teacher_id=teacher.id,
    )
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Other Student", phone="13910000002", student_id="DS002"),
        owner_teacher_id=other_teacher.id,
    )
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Unowned Student", phone="13910000003", student_id="DS003"),
        owner_teacher_id=None,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/analytics/dashboard-stats")

    assert response.status_code == 200
    assert response.json()["total_students"] == 1


@pytest.mark.asyncio
async def test_teacher_dashboard_student_count_includes_associated_students_without_owner(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-dashboard-associated",
            email="teacher-dashboard-associated@example.com",
            password="teacherpass123",
            full_name="Teacher Dashboard Associated",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Associated Student", phone="13910000004", student_id="DS004"),
        owner_teacher_id=None,
    )
    await ensure_teacher_student_link(db_session, teacher.id, student.id)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/analytics/dashboard-stats")

    assert response.status_code == 200
    assert response.json()["total_students"] == 1

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Class, Organization, Role
from app.rbac.schemas import StudentCreate
from app.rbac.service import create_student, assign_unowned_students_to_single_teacher, ensure_teacher_student_link


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
    assert {item["owner_teacher_id"] for item in response.json()} == {str(teacher.id)}


@pytest.mark.asyncio
async def test_single_teacher_system_backfills_unowned_students_to_sole_teacher(db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-backfill",
        email="teacher-student-backfill@example.com",
        full_name="Teacher Student Backfill",
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Legacy Student", phone="13900000009", student_id="S009"),
        owner_teacher_id=None,
    )

    affected = await assign_unowned_students_to_single_teacher(db_session)
    await db_session.commit()
    await db_session.refresh(student)

    assert affected == 1
    assert student.owner_teacher_id == teacher.id


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


@pytest.mark.asyncio
async def test_teacher_sees_student_when_association_exists_even_without_owner_teacher_id(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-associated",
        email="teacher-student-associated@example.com",
        full_name="Teacher Student Associated",
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Linked Student", phone="13900000004", student_id="S004"),
        owner_teacher_id=None,
    )
    await ensure_teacher_student_link(db_session, teacher.id, student.id)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(student.id)]


@pytest.mark.asyncio
async def test_teacher_class_list_only_includes_classes_used_by_their_students(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-class-owner",
        email="teacher-class-owner@example.com",
        full_name="Teacher Class Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-class-other",
        email="teacher-class-other@example.com",
        full_name="Teacher Class Other",
    )
    class_a = Class(name="A班", org_id=org.id)
    class_b = Class(name="B班", org_id=org.id)
    db_session.add_all([class_a, class_b])
    await db_session.flush()
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="A Student", phone="13900000005", student_id="S005", class_id=class_a.id),
        owner_teacher_id=teacher.id,
    )
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="B Student", phone="13900000006", student_id="S006", class_id=class_b.id),
        owner_teacher_id=other_teacher.id,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students/classes")

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["A班"]


@pytest.mark.asyncio
async def test_teacher_class_list_keeps_empty_classes_created_by_teacher(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-empty-class",
        email="teacher-empty-class@example.com",
        full_name="Teacher Empty Class",
    )
    empty_class = Class(name="空班级", org_id=org.id, created_by=teacher.id)
    db_session.add(empty_class)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students/classes")

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["空班级"]


@pytest.mark.asyncio
async def test_teacher_cannot_delete_other_teachers_class(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-delete-own",
        email="teacher-delete-own@example.com",
        full_name="Teacher Delete Own",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-delete-other",
        email="teacher-delete-other@example.com",
        full_name="Teacher Delete Other",
    )
    foreign_class = Class(name="他人班级", org_id=org.id, created_by=other_teacher.id)
    db_session.add(foreign_class)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.delete(f"/api/rbac/students/classes/{foreign_class.id}")

    assert response.status_code == 403

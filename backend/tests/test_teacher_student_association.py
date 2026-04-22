import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import verify_password
from app.auth.service import create_user
from app.rbac.models import Organization, Role, TeacherStudent
from app.rbac.schemas import StudentCreate
from app.rbac.service import create_or_link_student, create_student, ensure_teacher_student_link


async def _seed_org_roles(db_session):
    org = Organization(name="Association School", type="school", is_active=True)
    roles = [
        Role(name="teacher", display_name="Teacher", is_system=True),
        Role(name="student", display_name="Student", is_system=True),
    ]
    db_session.add(org)
    db_session.add_all(roles)
    await db_session.flush()
    return org


@pytest.mark.asyncio
async def test_create_student_creates_teacher_student_link(db_session) -> None:
    org = await _seed_org_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="assoc-teacher",
            email="assoc-teacher@example.com",
            password="teacherpass123",
            full_name="Assoc Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Assoc Student", phone="13930000001", student_id="AS001"),
        owner_teacher_id=teacher.id,
    )

    links = (
        await db_session.execute(
            select(TeacherStudent).where(
                TeacherStudent.teacher_id == teacher.id,
                TeacherStudent.student_id == student.id,
            )
        )
    ).scalars().all()

    assert len(links) == 1


@pytest.mark.asyncio
async def test_create_student_uses_student_id_as_account_when_phone_is_absent(db_session) -> None:
    org = await _seed_org_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="assoc-roster-teacher",
            email="assoc-roster-teacher@example.com",
            password="teacherpass123",
            full_name="Assoc Roster Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )

    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Roster Student", student_id="3256260101"),
        owner_teacher_id=teacher.id,
    )

    assert student.username == "3256260101"
    assert student.phone is None
    assert student.student_id == "3256260101"
    assert verify_password("3256260101", student.password_hash)


@pytest.mark.asyncio
async def test_teacher_student_link_is_idempotent(db_session) -> None:
    org = await _seed_org_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="assoc-teacher-2",
            email="assoc-teacher-2@example.com",
            password="teacherpass123",
            full_name="Assoc Teacher Two",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Assoc Student Two", phone="13930000002", student_id="AS002"),
        owner_teacher_id=None,
    )

    assert await ensure_teacher_student_link(db_session, teacher.id, student.id) is True
    assert await ensure_teacher_student_link(db_session, teacher.id, student.id) is False


@pytest.mark.asyncio
async def test_teacher_student_unique_constraint_prevents_duplicate_links(db_session) -> None:
    org = await _seed_org_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="assoc-teacher-3",
            email="assoc-teacher-3@example.com",
            password="teacherpass123",
            full_name="Assoc Teacher Three",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Assoc Student Three", phone="13930000003", student_id="AS003"),
        owner_teacher_id=None,
    )

    db_session.add(TeacherStudent(teacher_id=teacher.id, student_id=student.id))
    await db_session.flush()
    db_session.add(TeacherStudent(teacher_id=teacher.id, student_id=student.id))

    with pytest.raises(IntegrityError):
        await db_session.flush()


@pytest.mark.asyncio
async def test_create_or_link_student_reuses_existing_student_by_phone(db_session) -> None:
    org = await _seed_org_roles(db_session)
    teacher_a = await create_user(
        db_session,
        UserCreate(
            username="assoc-teacher-a",
            email="assoc-teacher-a@example.com",
            password="teacherpass123",
            full_name="Assoc Teacher A",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    teacher_b = await create_user(
        db_session,
        UserCreate(
            username="assoc-teacher-b",
            email="assoc-teacher-b@example.com",
            password="teacherpass123",
            full_name="Assoc Teacher B",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    existing_student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Shared Student", phone="13930000004", student_id="AS004"),
        owner_teacher_id=teacher_a.id,
    )

    student, linked, created = await create_or_link_student(
        db_session,
        org.id,
        StudentCreate(full_name="Shared Student", phone="13930000004", student_id="AS004"),
        teacher_b.id,
    )

    assert student.id == existing_student.id
    assert created is False
    assert linked is True

    teacher_links = (
        await db_session.execute(
            select(TeacherStudent.teacher_id).where(TeacherStudent.student_id == existing_student.id)
        )
    ).scalars().all()
    assert set(teacher_links) == {teacher_a.id, teacher_b.id}

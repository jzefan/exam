"""Adding a student whose phone already belongs to another role.

One person is one account, and one account can hold several roles, so the student
roster must attach a student membership instead of colliding on the login name.
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password
from app.rbac.models import Class, Organization, Role, UserOrganization
from app.rbac.schemas import StudentCreate
from app.rbac.seed import seed_roles
from app.rbac.service import create_or_link_student


async def _role(db: AsyncSession, name: str) -> Role:
    return (
        await db.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    ).scalar_one()


@pytest.mark.asyncio
async def test_add_student_attaches_role_to_existing_account(db_session: AsyncSession):
    await seed_roles(db_session)
    org = Organization(name="卫生健康职业学院", type="school", is_active=True)
    db_session.add(org)
    await db_session.flush()

    teacher_role = await _role(db_session, "teacher")
    student_role = await _role(db_session, "student")

    # The person already uses this phone as a teacher account.
    person = User(
        username="13900000001",
        email="13900000001@example.com",
        phone="13900000001",
        password_hash=hash_password("x"),
        full_name="程欣茹",
    )
    actor = User(
        username="teacher-actor",
        email="actor@example.com",
        password_hash=hash_password("x"),
        full_name="任课老师",
    )
    db_session.add_all([person, actor])
    await db_session.flush()
    db_session.add(
        UserOrganization(
            user_id=person.id,
            org_id=org.id,
            role_id=teacher_role.id,
            is_primary=True,
            is_primary_role=True,
        )
    )
    student_class = Class(name="生成式人工智能技术应用", org_id=org.id, created_by=actor.id)
    db_session.add(student_class)
    await db_session.commit()

    result = await create_or_link_student(
        db_session,
        org.id,
        StudentCreate(
            full_name="程欣茹",
            phone="13900000001",
            class_id=student_class.id,
        ),
        actor.id,
    )
    await db_session.commit()

    assert result.created is False
    assert result.role_added is True
    assert result.linked is True
    # Same account — no second row fighting over the username.
    assert result.student.id == person.id

    memberships = (
        await db_session.execute(
            select(UserOrganization.role_id, UserOrganization.is_primary).where(
                UserOrganization.user_id == person.id,
                UserOrganization.org_id == org.id,
            )
        )
    ).all()
    role_ids = {row[0] for row in memberships}
    assert role_ids == {teacher_role.id, student_role.id}
    # The teacher identity stays the primary one.
    assert {row[0]: row[1] for row in memberships}[teacher_role.id] is True
    assert {row[0]: row[1] for row in memberships}[student_role.id] is False


@pytest.mark.asyncio
async def test_add_student_twice_reports_already_linked(db_session: AsyncSession):
    await seed_roles(db_session)
    org = Organization(name="卫生健康职业学院", type="school", is_active=True)
    db_session.add(org)
    await db_session.flush()
    actor = User(
        username="teacher-actor",
        email="actor@example.com",
        password_hash=hash_password("x"),
        full_name="任课老师",
    )
    db_session.add(actor)
    await db_session.commit()

    data = StudentCreate(full_name="程欣茹", phone="13900000002")
    first = await create_or_link_student(db_session, org.id, data, actor.id)
    await db_session.commit()
    second = await create_or_link_student(db_session, org.id, data, actor.id)
    await db_session.commit()

    assert first.created is True
    assert first.role_added is False
    assert second.created is False
    assert second.linked is False  # router turns this into "该学生已在当前教师名下"


@pytest.mark.asyncio
async def test_conflicting_account_returns_readable_message(
    admin_client, db_session: AsyncSession
):
    await seed_roles(db_session)
    # Someone else already owns the email that create_student derives from the
    # phone, so the insert violates a unique constraint.
    db_session.add(
        User(
            username="someone-else",
            email="13911112222@example.com",
            phone="13800000000",
            password_hash=hash_password("x"),
            full_name="占位账号",
        )
    )
    await db_session.commit()

    response = await admin_client.post(
        "/api/rbac/students",
        json={"full_name": "程欣茹", "phone": "13911112222"},
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "手机号" in detail
    # The client must never see the SQL that failed.
    assert "INSERT" not in detail
    assert "sqlalchemy" not in detail.lower()

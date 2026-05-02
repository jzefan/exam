from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import create_access_token, hash_password
from app.exams.models import Exam, ExamStatus, ExamStudent
from app.rbac.models import Organization, Role
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user


async def _setup_teacher_exam(db: AsyncSession) -> tuple[User, str, Exam]:
    await seed_roles(db)
    org = Organization(name="Public Link School", type="school", is_active=True)
    db.add(org)
    await db.flush()
    teacher = User(
        username="public-link-teacher",
        email="public-link-teacher@example.com",
        password_hash=hash_password("x"),
        full_name="Public Link Teacher",
        user_type="internal",
        primary_org_id=org.id,
    )
    db.add(teacher)
    await db.flush()
    teacher_role = (
        await db.execute(select(Role).where(Role.name == "teacher", Role.org_id.is_(None)))
    ).scalar_one()
    await add_role_to_user(db, teacher.id, org.id, teacher_role.id, is_primary=True)
    exam = Exam(
        title="公开链接练习",
        owner_id=teacher.id,
        created_by=teacher.id,
        duration_minutes=60,
        total_score=100.0,
        status=ExamStatus.ONGOING.value,
        start_time=None,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(exam)
    await db.flush()
    await db.commit()
    return teacher, create_access_token(teacher.id, "teacher"), exam


@pytest.mark.asyncio
async def test_public_link_redeem_creates_external_guest_and_assigns_exam(
    client,
    db_session: AsyncSession,
) -> None:
    _teacher, token, exam = await _setup_teacher_exam(db_session)

    create_response = await client.post(
        f"/api/exams/{exam.id}/public-link",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 201
    public_url = create_response.json()["public_url"]
    raw_token = parse_qs(urlparse(public_url).query)["token"][0]

    redeem_response = await client.post(
        "/api/exam-public/redeem",
        json={"token": raw_token, "full_name": "外部考生", "phone": "13900001111"},
    )

    assert redeem_response.status_code == 200
    body = redeem_response.json()
    assert body["exam_id"] == str(exam.id)
    assert body["candidate_name"] == "外部考生"
    assert body["access_token"]

    guest = (
        await db_session.execute(
            select(User).where(User.phone == "13900001111", User.user_type == "external_guest")
        )
    ).scalar_one()
    assert guest.full_name == "外部考生"

    exam_student = (
        await db_session.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == exam.id,
                ExamStudent.student_id == guest.id,
            )
        )
    ).scalar_one_or_none()
    assert exam_student is not None

    exam_id = exam.id
    db_session.expire_all()
    students_response = await client.get(
        f"/api/exams/{exam_id}/students",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert students_response.status_code == 200
    assert students_response.json()[0]["phone"] == "13900001111"
    assert students_response.json()[0]["user_type"] == "external_guest"

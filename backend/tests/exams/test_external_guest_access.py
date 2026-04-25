import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.invitation_security import create_exam_take_token
from app.auth.models import User
from app.exams.models import Exam, ExamStatus, ExamStudent
from app.rbac.models import Organization
from app.rbac.seed import seed_roles


async def _make_external_guest(db: AsyncSession) -> tuple[User, Exam]:
    await seed_roles(db)
    org = Organization(name="External Guest Enterprise", type="enterprise", is_active=True)
    db.add(org)
    await db.flush()
    guest = User(
        username=f"guest_{uuid.uuid4().hex[:8]}",
        email=f"guest_{uuid.uuid4().hex[:8]}@x.com",
        phone="13800000099",
        password_hash="!",
        full_name="Guest",
        user_type="external_guest",
        primary_org_id=org.id,
    )
    db.add(guest)
    await db.flush()
    exam = Exam(
        title="External Guest Exam",
        owner_id=guest.id,
        created_by=guest.id,
        duration_minutes=60,
        total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(exam)
    await db.flush()
    await db.commit()
    return guest, exam


@pytest.mark.asyncio
async def test_external_guest_jwt_blocked_from_user_management(client, db_session: AsyncSession):
    guest, exam = await _make_external_guest(db_session)
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    token = create_exam_take_token(guest.id, exam.id, expires)

    response = await client.get(
        "/api/users",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_external_guest_cannot_access_other_exam(client, db_session: AsyncSession):
    guest, exam = await _make_external_guest(db_session)
    other_exam = Exam(
        title="Other Exam",
        owner_id=guest.id,
        created_by=guest.id,
        duration_minutes=60,
        total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(other_exam)
    await db_session.flush()
    await db_session.commit()

    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    token = create_exam_take_token(guest.id, exam.id, expires)

    response = await client.get(
        f"/api/exams/{other_exam.id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_external_guest_can_start_assigned_exam_with_exam_take_token(client, db_session: AsyncSession):
    guest, exam = await _make_external_guest(db_session)
    db_session.add(ExamStudent(exam_id=exam.id, student_id=guest.id))
    await db_session.commit()
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    token = create_exam_take_token(guest.id, exam.id, expires)

    response = await client.post(
        f"/api/student/exams/{exam.id}/start",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )

    assert response.status_code == 200
    assert response.json()["exam_id"] == str(exam.id)

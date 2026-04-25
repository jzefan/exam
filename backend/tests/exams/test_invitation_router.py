from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import create_access_token, hash_password
from app.exams.models import Exam, ExamStatus
from app.rbac.models import Organization, Role
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user


async def _setup_hr_exam(db: AsyncSession) -> tuple[User, str, Exam]:
    await seed_roles(db)
    org = Organization(name="Invitation Router Enterprise", type="enterprise", is_active=True)
    db.add(org)
    await db.flush()
    hr = User(
        username="router-hr",
        email="router-hr@x.com",
        password_hash=hash_password("x"),
        full_name="Router HR",
        user_type="internal",
        primary_org_id=org.id,
    )
    db.add(hr)
    await db.flush()
    eval_role = (
        await db.execute(select(Role).where(Role.name == "evaluator", Role.org_id.is_(None)))
    ).scalar_one()
    await add_role_to_user(db, hr.id, org.id, eval_role.id, is_primary=True)
    exam = Exam(
        title="Recruit",
        owner_id=hr.id,
        created_by=hr.id,
        duration_minutes=60,
        total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(exam)
    await db.flush()
    await db.commit()
    return hr, create_access_token(hr.id, "evaluator"), exam


@pytest.mark.asyncio
async def test_bulk_invitation_creates_invites(client, db_session: AsyncSession):
    _hr, token, exam = await _setup_hr_exam(db_session)

    response = await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {token}"},
        json=[
            {"full_name": "Cand A", "phone": "13800000001"},
            {"full_name": "Cand B", "phone": "13800000002"},
        ],
    )

    assert response.status_code == 201
    body = response.json()
    assert len(body) == 2
    for item in body:
        assert "invite_url" in item
        assert "token=" in item["invite_url"]


@pytest.mark.asyncio
async def test_list_invitations(client, db_session: AsyncSession):
    _hr, token, exam = await _setup_hr_exam(db_session)
    await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {token}"},
        json=[{"full_name": "A", "phone": "13800000001"}],
    )

    response = await client.get(
        f"/api/exams/{exam.id}/invitations",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_redeem_endpoint(client, db_session: AsyncSession):
    _hr, token, exam = await _setup_hr_exam(db_session)
    bulk = await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {token}"},
        json=[{"full_name": "A", "phone": "13800000001"}],
    )
    raw_token = bulk.json()[0]["invite_url"].rsplit("token=", 1)[1]

    response = await client.post("/api/exam-invite/redeem", json={"token": raw_token})

    assert response.status_code == 200
    assert "access_token" in response.json()
    assert response.json()["exam_id"] == str(exam.id)


@pytest.mark.asyncio
async def test_non_enterprise_evaluator_forbidden(client, db_session: AsyncSession):
    await seed_roles(db_session)
    school = Organization(name="Invitation Router School", type="school", is_active=True)
    db_session.add(school)
    await db_session.flush()
    teacher = User(
        username="router-teacher",
        email="router-teacher@s.com",
        password_hash=hash_password("x"),
        full_name="Router Teacher",
        user_type="internal",
        primary_org_id=school.id,
    )
    db_session.add(teacher)
    await db_session.flush()
    teacher_role = (
        await db_session.execute(select(Role).where(Role.name == "teacher", Role.org_id.is_(None)))
    ).scalar_one()
    await add_role_to_user(db_session, teacher.id, school.id, teacher_role.id, is_primary=True)
    exam = Exam(
        title="School Invite",
        owner_id=teacher.id,
        created_by=teacher.id,
        duration_minutes=60,
        total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(exam)
    await db_session.flush()
    await db_session.commit()

    token = create_access_token(teacher.id, "teacher")
    response = await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {token}"},
        json=[{"full_name": "A", "phone": "13800000001"}],
    )

    assert response.status_code == 400
    assert "enterprise" in response.json()["detail"].lower()

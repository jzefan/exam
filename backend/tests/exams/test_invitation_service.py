from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password
from app.exams.invitation_schemas import CandidateImportItem
from app.exams.invitation_service import (
    InvitationError,
    create_invitation,
    redeem_token,
    revoke_invitation,
)
from app.exams.models import Exam, ExamStatus
from app.rbac.models import Organization, Role
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user


async def _setup_hr_with_exam(db: AsyncSession) -> tuple[User, Exam, Organization]:
    await seed_roles(db)
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db.add(org)
    await db.flush()

    hr = User(
        username="hr1",
        email="hr@acme.com",
        password_hash=hash_password("x"),
        full_name="HR One",
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
        title="Recruitment Q1",
        owner_id=hr.id,
        created_by=hr.id,
        duration_minutes=60,
        total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(exam)
    await db.flush()
    return hr, exam, org


@pytest.mark.asyncio
async def test_create_invitation_creates_external_guest_user(db_session: AsyncSession):
    hr, exam, org = await _setup_hr_with_exam(db_session)
    await db_session.commit()

    result = await create_invitation(
        db_session,
        exam,
        CandidateImportItem(full_name="Cand A", phone="13800000001", email="a@x.com"),
        hr,
    )
    await db_session.commit()

    user = (await db_session.execute(select(User).where(User.id == result.user_id))).scalar_one()
    assert user.user_type == "external_guest"
    assert user.primary_org_id == org.id
    assert user.phone == "13800000001"


@pytest.mark.asyncio
async def test_create_invitation_dedupes_by_phone(db_session: AsyncSession):
    hr, exam, _org = await _setup_hr_with_exam(db_session)
    await db_session.commit()

    first = await create_invitation(
        db_session,
        exam,
        CandidateImportItem(full_name="A", phone="13800000001"),
        hr,
    )
    await db_session.commit()

    other_exam = Exam(
        title="Recruitment Q2",
        owner_id=hr.id,
        created_by=hr.id,
        duration_minutes=60,
        total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(other_exam)
    await db_session.flush()

    second = await create_invitation(
        db_session,
        other_exam,
        CandidateImportItem(full_name="A", phone="13800000001"),
        hr,
    )
    await db_session.commit()

    assert first.user_id == second.user_id


@pytest.mark.asyncio
async def test_create_invitation_rejects_non_enterprise(db_session: AsyncSession):
    await seed_roles(db_session)
    school_org = Organization(name="School", type="school", is_active=True)
    db_session.add(school_org)
    await db_session.flush()
    teacher = User(
        username="teacher-invite",
        email="teacher-invite@s.com",
        password_hash=hash_password("x"),
        full_name="Teacher Invite",
        user_type="internal",
        primary_org_id=school_org.id,
    )
    db_session.add(teacher)
    await db_session.flush()
    teacher_role = (
        await db_session.execute(select(Role).where(Role.name == "teacher", Role.org_id.is_(None)))
    ).scalar_one()
    await add_role_to_user(db_session, teacher.id, school_org.id, teacher_role.id, is_primary=True)
    exam = Exam(
        title="School Exam",
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

    with pytest.raises(InvitationError, match="enterprise"):
        await create_invitation(
            db_session,
            exam,
            CandidateImportItem(full_name="A", phone="13800000001"),
            teacher,
        )


@pytest.mark.asyncio
async def test_redeem_token_returns_jwt_for_valid(db_session: AsyncSession):
    hr, exam, _org = await _setup_hr_with_exam(db_session)
    await db_session.commit()

    result = await create_invitation(
        db_session,
        exam,
        CandidateImportItem(full_name="A", phone="13800000001"),
        hr,
    )
    await db_session.commit()
    raw_token = result.invite_url.rsplit("token=", 1)[1]

    response = await redeem_token(db_session, raw_token)
    await db_session.commit()

    assert response.exam_id == exam.id
    assert response.candidate_name == "A"
    assert response.access_token


@pytest.mark.asyncio
async def test_redeem_revoked_invitation_fails(db_session: AsyncSession):
    hr, exam, _org = await _setup_hr_with_exam(db_session)
    await db_session.commit()

    result = await create_invitation(
        db_session,
        exam,
        CandidateImportItem(full_name="A", phone="13800000001"),
        hr,
    )
    await db_session.commit()
    raw_token = result.invite_url.rsplit("token=", 1)[1]

    await revoke_invitation(db_session, result.invitation_id, hr)
    await db_session.commit()

    with pytest.raises(InvitationError, match="revoked"):
        await redeem_token(db_session, raw_token)


@pytest.mark.asyncio
async def test_redeem_expired_invitation_fails(db_session: AsyncSession):
    hr, exam, _org = await _setup_hr_with_exam(db_session)
    exam.end_time = datetime.now(timezone.utc) - timedelta(days=1)
    await db_session.commit()

    result = await create_invitation(
        db_session,
        exam,
        CandidateImportItem(full_name="A", phone="13800000001"),
        hr,
    )
    await db_session.commit()
    raw_token = result.invite_url.rsplit("token=", 1)[1]

    with pytest.raises(InvitationError, match="expired"):
        await redeem_token(db_session, raw_token)

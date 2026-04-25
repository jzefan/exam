"""Create, list, revoke, and redeem external-candidate exam invitations."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.invitation_security import (
    create_exam_take_token,
    generate_invitation_token,
    hash_invitation_token,
)
from app.auth.models import User
from app.config import settings
from app.exams.invitation_models import ExamInvitation
from app.exams.invitation_schemas import CandidateImportItem, InvitationCreated, RedeemResponse
from app.exams.models import Exam, ExamStudent
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.service import add_role_to_user


class InvitationError(Exception):
    """Raised when an invitation operation cannot proceed."""


_TAKE_TOKEN_BUFFER = timedelta(minutes=30)


def _build_invite_url(token: str) -> str:
    base = (getattr(settings, "frontend_base_url", None) or "http://localhost:5173").rstrip("/")
    return f"{base}/exam-invite?token={token}"


async def _resolve_evaluator_enterprise_org(db: AsyncSession, evaluator: User) -> Organization:
    org = (
        await db.execute(
            select(Organization)
            .join(UserOrganization, UserOrganization.org_id == Organization.id)
            .where(
                UserOrganization.user_id == evaluator.id,
                UserOrganization.is_primary_role.is_(True),
                Organization.type == "enterprise",
                Organization.is_active.is_(True),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if org is None:
        raise InvitationError("Only evaluators of an enterprise organization can issue invitations")
    return org


async def _find_or_create_external_guest(
    db: AsyncSession,
    candidate: CandidateImportItem,
    org: Organization,
) -> User:
    existing = (
        await db.execute(
            select(User).where(
                User.user_type == "external_guest",
                User.primary_org_id == org.id,
                User.phone == candidate.phone,
                User.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    user = User(
        username=f"guest_{uuid.uuid4().hex[:12]}",
        email=candidate.email or f"guest_{uuid.uuid4().hex[:8]}@invite.local",
        phone=candidate.phone,
        password_hash="!",
        full_name=candidate.full_name,
        is_active=True,
        user_type="external_guest",
        primary_org_id=org.id,
    )
    db.add(user)
    await db.flush()

    assessee_role = (
        await db.execute(select(Role).where(Role.name == "assessee", Role.org_id.is_(None)))
    ).scalar_one()
    await add_role_to_user(db, user.id, org.id, assessee_role.id, is_primary=True)
    return user


async def create_invitation(
    db: AsyncSession,
    exam: Exam,
    candidate: CandidateImportItem,
    evaluator: User,
) -> InvitationCreated:
    if exam.end_time is None:
        raise InvitationError("Exam must have an end_time before issuing invitations")

    org = await _resolve_evaluator_enterprise_org(db, evaluator)
    guest = await _find_or_create_external_guest(db, candidate, org)

    existing_exam_student = (
        await db.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == exam.id,
                ExamStudent.student_id == guest.id,
            )
        )
    ).scalar_one_or_none()
    if existing_exam_student is None:
        db.add(ExamStudent(exam_id=exam.id, student_id=guest.id))
        await db.flush()

    raw_token = generate_invitation_token()
    invitation = ExamInvitation(
        exam_id=exam.id,
        user_id=guest.id,
        token_hash=hash_invitation_token(raw_token),
        expires_at=exam.end_time + _TAKE_TOKEN_BUFFER,
        created_by=evaluator.id,
    )
    db.add(invitation)
    await db.flush()

    return InvitationCreated(
        user_id=guest.id,
        invitation_id=invitation.id,
        invite_url=_build_invite_url(raw_token),
    )


async def revoke_invitation(
    db: AsyncSession,
    invitation_id: uuid.UUID,
    evaluator: User,
) -> None:
    invitation = (
        await db.execute(select(ExamInvitation).where(ExamInvitation.id == invitation_id))
    ).scalar_one_or_none()
    if invitation is None:
        raise InvitationError("Invitation not found")
    invitation.revoked_at = datetime.now(timezone.utc)
    await db.flush()


async def redeem_token(db: AsyncSession, raw_token: str) -> RedeemResponse:
    token_hash = hash_invitation_token(raw_token)
    invitation = (
        await db.execute(select(ExamInvitation).where(ExamInvitation.token_hash == token_hash))
    ).scalar_one_or_none()
    if invitation is None:
        raise InvitationError("Token not recognized")

    now = datetime.now(timezone.utc)
    if invitation.revoked_at is not None:
        raise InvitationError("Invitation revoked")
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now:
        raise InvitationError("Invitation expired")

    if invitation.used_at is None:
        invitation.used_at = now
        await db.flush()

    user = (await db.execute(select(User).where(User.id == invitation.user_id))).scalar_one()
    access_token = create_exam_take_token(user.id, invitation.exam_id, expires_at)
    return RedeemResponse(
        access_token=access_token,
        exam_id=invitation.exam_id,
        candidate_name=user.full_name,
    )

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
from app.exams.invitation_models import ExamInvitation, ExamPublicLink
from app.exams.invitation_schemas import (
    CandidateImportItem,
    InvitationCreated,
    PublicLinkRedeemRequest,
    PublicLinkResponse,
    RedeemResponse,
)
from app.exams.models import Exam, ExamStudent
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.service import add_role_to_user


class InvitationError(Exception):
    """Raised when an invitation operation cannot proceed."""


_TAKE_TOKEN_BUFFER = timedelta(minutes=30)


def _build_invite_url(token: str) -> str:
    base = (getattr(settings, "frontend_base_url", None) or "http://localhost:5173").rstrip("/")
    return f"{base}/exam-invite?token={token}"


def _build_public_url(token: str) -> str:
    base = (getattr(settings, "frontend_base_url", None) or "http://localhost:5173").rstrip("/")
    return f"{base}/exam-public?token={token}"


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


async def _resolve_user_primary_org(db: AsyncSession, user: User) -> Organization | None:
    if user.primary_org_id is not None:
        org = (
            await db.execute(
                select(Organization).where(
                    Organization.id == user.primary_org_id,
                    Organization.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if org is not None:
            return org

    return (
        await db.execute(
            select(Organization)
            .join(UserOrganization, UserOrganization.org_id == Organization.id)
            .where(
                UserOrganization.user_id == user.id,
                UserOrganization.is_primary_role.is_(True),
                Organization.is_active.is_(True),
            )
            .limit(1)
        )
    ).scalar_one_or_none()


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


async def _find_or_create_public_external_guest(
    db: AsyncSession,
    candidate: PublicLinkRedeemRequest,
    org: Organization | None,
) -> User:
    filters = [
        User.user_type == "external_guest",
        User.phone == candidate.phone,
        User.deleted_at.is_(None),
    ]
    if org is not None:
        filters.append(User.primary_org_id == org.id)

    existing = (await db.execute(select(User).where(*filters))).scalar_one_or_none()
    if existing is not None:
        existing.full_name = candidate.full_name
        return existing

    user = User(
        username=f"guest_{uuid.uuid4().hex[:12]}",
        email=f"guest_{uuid.uuid4().hex[:8]}@public.local",
        phone=candidate.phone,
        password_hash="!",
        full_name=candidate.full_name,
        is_active=True,
        user_type="external_guest",
        primary_org_id=org.id if org is not None else None,
    )
    db.add(user)
    await db.flush()

    if org is not None:
        assessee_role = (
            await db.execute(select(Role).where(Role.name == "assessee", Role.org_id.is_(None)))
        ).scalar_one_or_none()
        if assessee_role is not None:
            await add_role_to_user(db, user.id, org.id, assessee_role.id, is_primary=True)
    return user


def _public_link_response(link: ExamPublicLink, token: str) -> PublicLinkResponse:
    return PublicLinkResponse(
        id=link.id,
        exam_id=link.exam_id,
        public_url=_build_public_url(token),
        expires_at=link.expires_at,
        revoked_at=link.revoked_at,
    )


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


async def create_or_replace_public_link(
    db: AsyncSession,
    exam: Exam,
    creator: User,
) -> PublicLinkResponse:
    raw_token = generate_invitation_token()
    token_hash = hash_invitation_token(raw_token)
    expires_at = exam.end_time + _TAKE_TOKEN_BUFFER if exam.end_time is not None else None
    existing = (
        await db.execute(select(ExamPublicLink).where(ExamPublicLink.exam_id == exam.id))
    ).scalar_one_or_none()
    if existing is None:
        existing = ExamPublicLink(
            exam_id=exam.id,
            token_hash=token_hash,
            expires_at=expires_at,
            created_by=creator.id,
        )
        db.add(existing)
    else:
        existing.token_hash = token_hash
        existing.expires_at = expires_at
        existing.revoked_at = None
        existing.created_by = creator.id
    await db.flush()
    return _public_link_response(existing, raw_token)


async def get_public_link(db: AsyncSession, exam: Exam) -> PublicLinkResponse | None:
    link = (
        await db.execute(
            select(ExamPublicLink).where(
                ExamPublicLink.exam_id == exam.id,
                ExamPublicLink.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if link is None:
        return None
    return _public_link_response(link, "")


async def revoke_public_link(db: AsyncSession, exam: Exam) -> None:
    link = (
        await db.execute(
            select(ExamPublicLink).where(
                ExamPublicLink.exam_id == exam.id,
                ExamPublicLink.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if link is None:
        raise InvitationError("Public link not found")
    link.revoked_at = datetime.now(timezone.utc)
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


async def redeem_public_link(db: AsyncSession, body: PublicLinkRedeemRequest) -> RedeemResponse:
    token_hash = hash_invitation_token(body.token)
    link = (
        await db.execute(select(ExamPublicLink).where(ExamPublicLink.token_hash == token_hash))
    ).scalar_one_or_none()
    if link is None:
        raise InvitationError("Token not recognized")

    now = datetime.now(timezone.utc)
    if link.revoked_at is not None:
        raise InvitationError("Public link revoked")
    expires_at = link.expires_at
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            raise InvitationError("Public link expired")

    exam = (
        await db.execute(select(Exam).where(Exam.id == link.exam_id, Exam.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if exam is None:
        raise InvitationError("Exam not found")
    if exam.status == "closed":
        raise InvitationError("Exam is closed")

    owner = (await db.execute(select(User).where(User.id == exam.owner_id))).scalar_one()
    org = await _resolve_user_primary_org(db, owner)
    guest = await _find_or_create_public_external_guest(db, body, org)

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

    take_token_expires_at = expires_at or (
        now + timedelta(minutes=settings.access_token_expire_minutes)
    )
    access_token = create_exam_take_token(guest.id, exam.id, take_token_expires_at)
    return RedeemResponse(
        access_token=access_token,
        exam_id=exam.id,
        candidate_name=guest.full_name,
    )

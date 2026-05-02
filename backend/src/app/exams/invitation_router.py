"""HTTP endpoints for enterprise recruitment exam invitations."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.capabilities import require_capability
from app.auth.models import User
from app.database import get_db
from app.exams.invitation_models import ExamInvitation
from app.exams.invitation_schemas import (
    CandidateImportItem,
    InvitationCreated,
    InvitationListItem,
    PublicLinkRedeemRequest,
    PublicLinkResponse,
    RedeemRequest,
    RedeemResponse,
)
from app.exams.invitation_service import (
    InvitationError,
    create_invitation,
    create_or_replace_public_link,
    get_public_link,
    redeem_public_link,
    redeem_token,
    revoke_invitation,
    revoke_public_link,
)
from app.exams.models import Exam


router = APIRouter()
public_router = APIRouter()


async def _exam_or_404(db: AsyncSession, exam_id: uuid.UUID) -> Exam:
    exam = (
        await db.execute(select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    return exam


def _ensure_exam_owner(exam: Exam, user: User) -> None:
    if exam.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not exam owner")


@router.post(
    "/exams/{exam_id}/invitations/bulk",
    response_model=list[InvitationCreated],
    status_code=status.HTTP_201_CREATED,
)
async def bulk_invite(
    exam_id: uuid.UUID,
    candidates: list[CandidateImportItem],
    user: Annotated[User, require_capability("exam.create")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[InvitationCreated]:
    exam = await _exam_or_404(db, exam_id)
    _ensure_exam_owner(exam, user)

    out: list[InvitationCreated] = []
    for candidate in candidates:
        try:
            out.append(await create_invitation(db, exam, candidate, user))
        except InvitationError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return out


@router.get("/exams/{exam_id}/invitations", response_model=list[InvitationListItem])
async def list_invitations(
    exam_id: uuid.UUID,
    user: Annotated[User, require_capability("exam.read")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[InvitationListItem]:
    exam = await _exam_or_404(db, exam_id)
    _ensure_exam_owner(exam, user)

    rows = (
        await db.execute(
            select(ExamInvitation, User)
            .join(User, User.id == ExamInvitation.user_id)
            .where(ExamInvitation.exam_id == exam.id)
            .order_by(ExamInvitation.created_at.desc())
        )
    ).all()
    return [
        InvitationListItem(
            id=invitation.id,
            user_id=invitation.user_id,
            candidate_name=candidate.full_name,
            candidate_phone=candidate.phone or "",
            expires_at=invitation.expires_at,
            used_at=invitation.used_at,
            revoked_at=invitation.revoked_at,
        )
        for invitation, candidate in rows
    ]


@router.delete("/exams/{exam_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invitation(
    exam_id: uuid.UUID,
    invitation_id: uuid.UUID,
    user: Annotated[User, require_capability("exam.update")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    exam = await _exam_or_404(db, exam_id)
    _ensure_exam_owner(exam, user)
    try:
        await revoke_invitation(db, invitation_id, user)
    except InvitationError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await db.commit()


@router.post(
    "/exams/{exam_id}/public-link",
    response_model=PublicLinkResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_public_link(
    exam_id: uuid.UUID,
    user: Annotated[User, require_capability("exam.update")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PublicLinkResponse:
    exam = await _exam_or_404(db, exam_id)
    _ensure_exam_owner(exam, user)
    result = await create_or_replace_public_link(db, exam, user)
    await db.commit()
    return result


@router.get("/exams/{exam_id}/public-link", response_model=PublicLinkResponse | None)
async def read_public_link(
    exam_id: uuid.UUID,
    user: Annotated[User, require_capability("exam.read")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PublicLinkResponse | None:
    exam = await _exam_or_404(db, exam_id)
    _ensure_exam_owner(exam, user)
    return await get_public_link(db, exam)


@router.delete("/exams/{exam_id}/public-link", status_code=status.HTTP_204_NO_CONTENT)
async def delete_public_link(
    exam_id: uuid.UUID,
    user: Annotated[User, require_capability("exam.update")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    exam = await _exam_or_404(db, exam_id)
    _ensure_exam_owner(exam, user)
    try:
        await revoke_public_link(db, exam)
    except InvitationError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await db.commit()


@public_router.post("/exam-invite/redeem", response_model=RedeemResponse)
async def redeem(
    body: RedeemRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RedeemResponse:
    try:
        result = await redeem_token(db, body.token)
    except InvitationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return result


@public_router.post("/exam-public/redeem", response_model=RedeemResponse)
async def redeem_public(
    body: PublicLinkRedeemRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RedeemResponse:
    try:
        result = await redeem_public_link(db, body)
    except InvitationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return result

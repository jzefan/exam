"""Dependencies enforcing internal-user and external-guest session boundaries."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.invitation_security import decode_exam_take_token
from app.auth.models import User
from app.auth.security import decode_access_token
from app.database import get_db


bearer = HTTPBearer()


async def get_actor_for_exam(
    exam_id: uuid.UUID,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Accept an internal JWT or an invitation JWT bound to the given exam."""
    raw_token = credentials.credentials

    invitation_payload = decode_exam_take_token(raw_token)
    if invitation_payload is not None:
        if invitation_payload.get("exam_id") != str(exam_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token not valid for this exam",
            )
        user_id = uuid.UUID(invitation_payload["sub"])
        user = (
            await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
        ).scalar_one_or_none()
        if user is None or user.user_type != "external_guest":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return user

    internal_payload = decode_access_token(raw_token)
    if internal_payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id = uuid.UUID(internal_payload["sub"])
    user = (
        await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if user is None or not user.is_active or user.user_type == "external_guest":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return user

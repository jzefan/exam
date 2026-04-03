import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import decode_access_token
from app.database import get_db

security = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = uuid.UUID(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*role_names: str):
    """Legacy compatibility: check if user has any of the given role names in their orgs."""

    async def checker(
        user: CurrentUser,
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> User:
        from app.rbac.models import Role, UserOrganization

        result = await db.execute(
            select(Role.name)
            .join(UserOrganization, UserOrganization.role_id == Role.id)
            .where(UserOrganization.user_id == user.id)
        )
        user_roles = {row[0] for row in result.all()}
        if not user_roles.intersection(set(role_names)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return Depends(checker)

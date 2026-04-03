"""FastAPI dependencies for RBAC permission checking."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.rbac.service import get_user_primary_org, user_has_permission


async def check_permission(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    resource: str,
    action: str,
) -> None:
    """Raise 403 if the user does not have the required permission in the org."""
    has = await user_has_permission(db, user_id, org_id, resource, action)
    if not has:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: {resource}:{action}",
        )


async def get_current_org_id(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_org_id: Annotated[str | None, Header()] = None,
) -> uuid.UUID:
    """Get the current organization ID from header or user's primary org."""
    if x_org_id is not None:
        return uuid.UUID(x_org_id)
    primary = await get_user_primary_org(db, user.id)
    if primary is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No organization context. Set X-Org-Id header or join an organization.",
        )
    return primary.org_id


CurrentOrgId = Annotated[uuid.UUID, Depends(get_current_org_id)]


def require_permission(resource: str, action: str):
    """Dependency factory that checks if the current user has a permission."""

    async def _checker(
        user: CurrentUser,
        org_id: CurrentOrgId,
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> None:
        await check_permission(db, user.id, org_id, resource, action)

    return Depends(_checker)

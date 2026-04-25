"""Capability-based authorization helpers."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.rbac.models import Permission, Role, RolePermission, UserOrganization


def _parse(capability: str) -> tuple[str, str]:
    resource, _, action = capability.partition(".")
    if not resource or not action:
        raise ValueError(f"Capability must be 'resource.action', got {capability!r}")
    return resource, action


async def user_has_capability(
    db: AsyncSession,
    user_id: uuid.UUID,
    *capabilities: str,
) -> bool:
    """Return True if the user holds at least one requested capability."""
    if not capabilities:
        return True

    pairs = {_parse(capability) for capability in capabilities}

    is_platform_admin = (
        await db.execute(
            select(Role.id)
            .join(UserOrganization, UserOrganization.role_id == Role.id)
            .where(
                UserOrganization.user_id == user_id,
                Role.name == "platform_admin",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if is_platform_admin is not None:
        return True

    rows = (
        await db.execute(
            select(Permission.resource, Permission.action)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .join(Role, Role.id == RolePermission.role_id)
            .join(UserOrganization, UserOrganization.role_id == Role.id)
            .where(UserOrganization.user_id == user_id)
        )
    ).all()
    held = {(resource, action) for resource, action in rows}
    return bool(held.intersection(pairs))


def require_capability(*capabilities: str):
    """FastAPI dependency: 403 unless current user holds any capability."""

    async def checker(
        user: CurrentUser,
        db: Annotated[AsyncSession, Depends(get_db)],
    ):
        if not await user_has_capability(db, user.id, *capabilities):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return Depends(checker)

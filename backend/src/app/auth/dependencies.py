import uuid
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.oidc_client import OIDCError, get_oidc_client
from app.auth.oidc_provision import get_or_provision_user
from app.auth.security import decode_access_token
from app.database import get_db

security = HTTPBearer()


async def _resolve_user_from_token(token: str, db: AsyncSession) -> User | None:
    """Resolve a Bearer token to a User row.

    Tries two strategies in order:
      1. Local HS256 access_token (issued by exam's own /api/auth/login)
      2. OIDC RS256 access_token (issued by ArkLoop IdP, sub = user.oidc_subject)

    Returns None if neither path produces a live, active user.
    """
    # ── Strategy 1: local HS256 ─────────────────────────────────────────
    payload = decode_access_token(token)
    if payload is not None and "sub" in payload:
        try:
            user_id = uuid.UUID(payload["sub"])
        except (TypeError, ValueError):
            return None
        result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
        user = result.scalar_one_or_none()
        # Single-session enforcement: a token carrying a `sid` claim (issued to
        # students at login) is valid only while it matches the user's current
        # session_token. A newer login elsewhere rotates session_token, so this
        # older token is rejected — kicking the previously logged-in device.
        if user is not None:
            sid = payload.get("sid")
            if sid is not None and sid != user.session_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="账号已在其他设备登录，请重新登录",
                )
        return user

    # ── Strategy 2: OIDC RS256 ──────────────────────────────────────────
    oidc = get_oidc_client()
    if oidc is None:
        return None
    try:
        claims: dict[str, Any] = await oidc.verify_token(token)
    except OIDCError:
        return None

    # Auto-provision: when the worker presents a token for an ArkLoop user
    # who has never visited exam before, mint the local row on demand. This
    # lets teachers do everything from the ArkLoop UI; they never need to
    # touch exam's own login page.
    #
    # The provisioning function commits its own transaction, so we don't
    # need to wrap anything here.
    return await get_or_provision_user(db, claims)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    user = await _resolve_user_from_token(credentials.credentials, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")
    if user.user_type == "external_guest":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="External guests must use exam invitation tokens",
        )
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


async def user_has_role(db: AsyncSession, user_id: uuid.UUID, *role_names: str) -> bool:
    """Check if user has any of the given role names via RBAC (for inline checks)."""
    from app.rbac.models import Role, UserOrganization

    result = await db.execute(
        select(Role.name)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .where(UserOrganization.user_id == user_id)
    )
    user_roles = {row[0] for row in result.all()}
    return bool(user_roles.intersection(set(role_names)))

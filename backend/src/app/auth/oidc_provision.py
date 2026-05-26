"""User auto-provisioning from OIDC claims.

Shared by two entry points:
  1. /api/auth/oidc/callback — browser SSO flow (user explicitly logs in here)
  2. dependencies._resolve_user_from_token — API call from the ArkLoop worker
     on behalf of a user who has never visited exam in a browser

Both paths need the same logic: if we see a fresh oidc_subject, mint a new
user row with sensible defaults; if we see a subject whose email already
matches a local-only account, link them.

Putting the logic in one module ensures the two paths never drift apart.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.rbac.models import Organization, Role, UserOrganization


async def get_or_provision_user(db: AsyncSession, claims: dict[str, Any]) -> User | None:
    """Look up (or create) the User row matching the OIDC token claims.

    Resolution order:
      1. By ``oidc_subject`` — already linked, just return it
      2. By ``email`` — local account exists, link by setting oidc_subject
      3. Auto-provision a fresh teacher row

    Returns ``None`` only when ``claims`` lacks the mandatory ``sub``. In all
    other cases a usable User is returned (and committed).
    """
    sub = claims.get("sub")
    if not sub:
        return None

    # 1) Already linked.
    result = await db.execute(select(User).where(User.oidc_subject == sub, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user:
        return user

    email = (claims.get("email") or "").strip()
    name = (claims.get("name") or "").strip() or (email.split("@")[0] if email else sub)

    # 2) Link an existing local account by email.
    if email:
        result = await db.execute(select(User).where(User.email == email, User.deleted_at.is_(None)))
        existing = result.scalar_one_or_none()
        if existing:
            existing.oidc_subject = sub
            existing.provider = "arkloop"
            await _ensure_teacher_membership(db, existing)
            await db.commit()
            await db.refresh(existing)
            return existing

    # 3) Auto-provision.
    #
    # username uniqueness: derive from email-local-part first; if collision
    # with another live row, fall back to sub-prefix. We intentionally use
    # a placeholder password hash that can never authenticate locally —
    # OIDC users always SSO.
    base_username = email.split("@")[0] if email else f"sso-{sub[:8]}"
    username = await _pick_unique_username(db, base_username)

    # Email may collide with a deleted row's unique constraint — soft-deleted
    # rows are excluded from the partial index, so this is fine; we just need
    # email itself to be non-empty per the NOT NULL constraint.
    final_email = email or f"{username}@sso.local"

    user = User(
        username=username,
        email=final_email,
        full_name=name,
        password_hash="!oidc!",
        persona="teacher",
        user_type="internal",
        is_active=True,
        oidc_subject=sub,
        provider="arkloop",
    )
    db.add(user)
    await db.flush()
    await _ensure_teacher_membership(db, user)
    await db.commit()
    await db.refresh(user)
    return user


async def _ensure_teacher_membership(db: AsyncSession, user: User) -> None:
    """Attach OIDC teachers to the default organization and teacher role."""
    existing = await db.execute(select(UserOrganization.user_id).where(UserOrganization.user_id == user.id))
    if existing.scalar_one_or_none() is not None:
        return

    org_result = await db.execute(select(Organization).where(Organization.deleted_at.is_(None)).limit(1))
    org = org_result.scalar_one_or_none()
    role_result = await db.execute(select(Role).where(Role.name == "teacher", Role.deleted_at.is_(None)).limit(1))
    role = role_result.scalar_one_or_none()
    if org is None or role is None:
        return

    db.add(
        UserOrganization(
            user_id=user.id,
            org_id=org.id,
            role_id=role.id,
            is_primary=True,
            is_primary_role=True,
        )
    )


async def _pick_unique_username(db: AsyncSession, base: str) -> str:
    """Return ``base`` if free, else ``base-2``, ``base-3``, ... up to 50 tries."""
    base = (base or "user").lower().strip() or "user"
    candidate = base
    for i in range(2, 52):
        result = await db.execute(
            select(User.id).where(User.username == candidate, User.deleted_at.is_(None))
        )
        if result.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}-{i}"
    # Extremely unlikely; fall through with a random suffix.
    import secrets

    return f"{base}-{secrets.token_hex(4)}"

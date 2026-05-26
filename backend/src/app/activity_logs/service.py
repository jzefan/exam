"""Service layer for recording and querying platform activity logs.

Keep `log_event` cheap, side-effect-safe, and never raise into the calling
endpoint — observability must not break business flows.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.activity_logs.models import ActivityLog
from app.auth.models import User
from app.rbac.models import Role, UserOrganization

logger = logging.getLogger(__name__)

# Standard categories — keeping this tiny on purpose; new categories are
# added as needed when we instrument additional flows.
CATEGORY_AUTH = "auth"
CATEGORY_EXAM = "exam"
CATEGORY_QUESTION = "question"


def _extract_request_context(request: Request | None) -> tuple[str | None, str | None]:
    if request is None:
        return None, None
    state = getattr(request, "state", None)
    ip = getattr(state, "client_ip", None) if state else None
    ua = getattr(state, "user_agent", None) if state else None
    if ip is None:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip() or None
        elif request.client:
            ip = request.client.host
    if ua is None:
        ua = request.headers.get("user-agent")
        if ua and len(ua) > 400:
            ua = ua[:400]
    return ip, ua


async def _primary_role_for_user(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    """Return the user's primary role name, or first role if no primary marked."""
    result = await db.execute(
        select(Role.name, UserOrganization.is_primary)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .where(UserOrganization.user_id == user_id)
    )
    rows = result.all()
    if not rows:
        return None
    for name, is_primary in rows:
        if is_primary:
            return name
    return rows[0][0]


async def log_event(
    db: AsyncSession,
    *,
    event_category: str,
    event_type: str,
    user: User | None = None,
    username: str | None = None,
    role_name: str | None = None,
    target_type: str | None = None,
    target_id: str | uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
    request: Request | None = None,
    success: bool = True,
) -> None:
    """Persist an activity log row. Never raises into the caller."""
    try:
        ip, ua = _extract_request_context(request)
        resolved_username = username or (user.username if user else None)
        resolved_full_name = user.full_name if user else None
        resolved_role = role_name
        if resolved_role is None and user is not None:
            try:
                resolved_role = await _primary_role_for_user(db, user.id)
            except SQLAlchemyError:
                resolved_role = None

        entry = ActivityLog(
            user_id=user.id if user else None,
            username=resolved_username,
            full_name=resolved_full_name,
            role_name=resolved_role,
            event_category=event_category,
            event_type=event_type,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            event_metadata=metadata,
            ip_address=ip,
            user_agent=ua,
            success=success,
        )
        db.add(entry)
        # Best-effort flush so failures surface here rather than poisoning the
        # outer transaction at commit time.
        await db.flush()
    except Exception:  # noqa: BLE001 — observability must never break the request
        logger.exception(
            "Failed to record activity log event=%s/%s", event_category, event_type
        )


async def list_activity_logs(
    db: AsyncSession,
    *,
    user_search: str | None = None,
    role_name: str | None = None,
    event_category: str | None = None,
    event_type: str | None = None,
    success: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[ActivityLog], int]:
    page = max(1, page)
    page_size = max(1, min(200, page_size))

    base = select(ActivityLog)
    count_q = select(func.count(ActivityLog.id))

    filters = []
    if user_search:
        like = f"%{user_search.strip()}%"
        filters.append(
            (ActivityLog.username.ilike(like)) | (ActivityLog.full_name.ilike(like))
        )
    if role_name:
        filters.append(ActivityLog.role_name == role_name)
    if event_category:
        filters.append(ActivityLog.event_category == event_category)
    if event_type:
        filters.append(ActivityLog.event_type == event_type)
    if success is not None:
        filters.append(ActivityLog.success.is_(success))
    if date_from:
        filters.append(ActivityLog.created_at >= date_from)
    if date_to:
        filters.append(ActivityLog.created_at <= date_to)

    for f in filters:
        base = base.where(f)
        count_q = count_q.where(f)

    total = (await db.execute(count_q)).scalar_one()
    rows = (
        await db.execute(
            base.order_by(ActivityLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return list(rows), int(total or 0)


async def list_facets(db: AsyncSession) -> tuple[list[str], list[str], list[str]]:
    """Distinct values used to populate filter dropdowns."""
    categories = (
        await db.execute(select(ActivityLog.event_category).distinct())
    ).scalars().all()
    types = (
        await db.execute(select(ActivityLog.event_type).distinct())
    ).scalars().all()
    roles = (
        await db.execute(
            select(ActivityLog.role_name).where(ActivityLog.role_name.is_not(None)).distinct()
        )
    ).scalars().all()
    return (
        sorted([c for c in categories if c]),
        sorted([t for t in types if t]),
        sorted([r for r in roles if r]),
    )

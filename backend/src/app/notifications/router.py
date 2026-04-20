import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.common.pagination import PaginationParams, apply_pagination, get_total_count, parse_pagination
from app.database import get_db
from app.notifications.models import Notification
from app.notifications.schemas import NotificationResponse

router = APIRouter()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    pagination: Annotated[PaginationParams, Depends(parse_pagination)],
    user: CurrentUser,
    unread_only: bool = Query(False),
) -> list[NotificationResponse]:
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc())

    total = await get_total_count(db, stmt)
    response.headers["X-Total-Count"] = str(total)

    stmt = apply_pagination(stmt, pagination, Notification)
    result = await db.execute(stmt)
    notifications = result.scalars().all()
    return [NotificationResponse.model_validate(notification) for notification in notifications]


@router.get("/unread-count")
async def get_unread_count(db: Annotated[AsyncSession, Depends(get_db)], user: CurrentUser) -> dict[str, int]:
    result = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return {"unread_count": result.scalar_one()}


@router.patch("/{notification_id}/read")
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, bool]:
    notification = (
        await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    notification.read_at = _utcnow()
    await db.commit()
    return {"read": True}


@router.post("/mark-all-read")
async def mark_all_notifications_read(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, int]:
    stmt = (
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=_utcnow())
    )
    result = await db.execute(stmt)
    await db.commit()
    return {"updated_count": int(result.rowcount or 0)}

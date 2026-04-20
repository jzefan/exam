import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications.models import Notification


async def create_notification(
    db: AsyncSession,
    user_id: uuid.UUID,
    type: str,
    title: str,
    content: str | None = None,
    link_url: str | None = None,
    payload: Any | None = None,
) -> Notification:
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        content=content,
        link_url=link_url,
        payload=payload,
    )
    db.add(notification)
    await db.flush()
    return notification

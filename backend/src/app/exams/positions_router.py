"""Position API router."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, user_has_role
from app.database import get_db
from app.exams.models import Position
from app.exams.schemas import PositionCreate, PositionResponse

router = APIRouter()


@router.get("", response_model=list[PositionResponse])
async def list_positions(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[PositionResponse]:
    """List positions visible to current user: own + system-level."""
    query = select(Position).where(
        Position.deleted_at.is_(None),
        or_(Position.created_by == user.id, Position.is_system.is_(True)),
    )
    result = await db.execute(query)
    positions = result.scalars().all()
    response.headers["X-Total-Count"] = str(len(positions))
    return [
        PositionResponse(
            id=p.id,
            name=p.name,
            is_system=p.is_system,
            created_by=p.created_by,
            created_at=p.created_at,
        )
        for p in positions
    ]


@router.post("", response_model=PositionResponse, status_code=status.HTTP_201_CREATED)
async def create_position(
    body: PositionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PositionResponse:
    is_admin = await user_has_role(db, user.id, "platform_admin", "school_admin", "enterprise_admin")
    position = Position(name=body.name, created_by=user.id, is_system=is_admin)
    db.add(position)
    await db.commit()
    await db.refresh(position)
    return PositionResponse(
        id=position.id,
        name=position.name,
        is_system=position.is_system,
        created_by=position.created_by,
        created_at=position.created_at,
    )


@router.delete("/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_position(
    position_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    from datetime import datetime, timezone

    result = await db.execute(
        select(Position).where(Position.id == position_id, Position.deleted_at.is_(None))
    )
    position = result.scalar_one_or_none()
    if position is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")

    # Only allow deleting own non-system positions (admins can delete system ones)
    is_admin = await user_has_role(db, user.id, "platform_admin", "school_admin", "enterprise_admin")
    if position.is_system and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete system position")
    if not position.is_system and position.created_by != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete others' position")

    position.deleted_at = datetime.now(timezone.utc)
    await db.commit()

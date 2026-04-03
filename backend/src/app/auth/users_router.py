"""User management CRUD — admin only."""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles
from app.auth.models import User
from app.auth.schemas import UserCreate, UserResponse, UserUpdate
from app.auth.service import build_user_response, create_user, get_user_by_email, get_user_by_username, update_user
from app.common.pagination import PaginationParams, apply_filters, apply_pagination, get_total_count, parse_filters, parse_pagination
from app.database import get_db

router = APIRouter()


@router.get("", response_model=list[UserResponse])
async def list_users(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    pagination: Annotated[PaginationParams, Depends(parse_pagination)],
    _admin: Annotated[User, require_roles("admin")],
) -> list[UserResponse]:
    base_query = select(User).where(User.deleted_at.is_(None))
    filters = parse_filters(request, User)
    filtered_query = apply_filters(base_query, filters, User)

    total = await get_total_count(db, filtered_query)
    response.headers["X-Total-Count"] = str(total)

    query = apply_pagination(filtered_query, pagination, User)
    result = await db.execute(query)
    users = result.scalars().all()
    return [UserResponse.model_validate(u) for u in users]


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, require_roles("admin")],
) -> UserResponse:
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserResponse.model_validate(user)


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user_endpoint(
    data: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, require_roles("admin")],
) -> UserResponse:
    if await get_user_by_username(db, data.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    if await get_user_by_email(db, data.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    user = await create_user(db, data)
    return UserResponse.model_validate(user)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user_endpoint(
    user_id: uuid.UUID,
    data: UserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, require_roles("admin")],
) -> UserResponse:
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user = await update_user(db, user, data)
    return UserResponse.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, require_roles("admin")],
) -> None:
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.deleted_at = datetime.now(timezone.utc)
    await db.flush()

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
    _admin: Annotated[User, require_roles("platform_admin")],
) -> list[UserResponse]:
    base_query = select(User).where(User.deleted_at.is_(None))
    filters = parse_filters(request, User)
    filtered_query = apply_filters(base_query, filters, User)

    total = await get_total_count(db, filtered_query)
    response.headers["X-Total-Count"] = str(total)

    query = apply_pagination(filtered_query, pagination, User)
    result = await db.execute(query)
    users = result.scalars().all()
    return [await build_user_response(db, u) for u in users]


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, require_roles("platform_admin")],
) -> UserResponse:
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return await build_user_response(db, user)


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user_endpoint(
    data: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, require_roles("platform_admin")],
) -> UserResponse:
    if await get_user_by_username(db, data.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    if await get_user_by_email(db, data.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    user = await create_user(db, data)
    return await build_user_response(db, user)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user_endpoint(
    user_id: uuid.UUID,
    data: UserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, require_roles("platform_admin")],
) -> UserResponse:
    from app.auth.security import hash_password
    from app.rbac.models import Organization, Role, UserOrganization

    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Update basic fields
    basic_data = data.model_dump(exclude_unset=True, exclude={"role_names", "password"})
    for field, value in basic_data.items():
        setattr(user, field, value)

    # Update password if provided
    if data.password is not None and data.password:
        user.password_hash = hash_password(data.password)

    # Update roles if provided
    if data.role_names is not None:
        # Get default org
        org_result = await db.execute(select(Organization).limit(1))
        org = org_result.scalar_one_or_none()
        if org:
            # Remove existing role assignments
            existing = await db.execute(
                select(UserOrganization).where(UserOrganization.user_id == user.id)
            )
            for uo in existing.scalars().all():
                await db.delete(uo)
            await db.flush()

            # Add new role assignments
            for i, role_name in enumerate(data.role_names):
                role_result = await db.execute(
                    select(Role).where(Role.name == role_name, Role.deleted_at.is_(None))
                )
                role = role_result.scalar_one_or_none()
                if role:
                    db.add(UserOrganization(
                        user_id=user.id,
                        org_id=org.id,
                        role_id=role.id,
                        is_primary=(i == 0),
                    ))

    await db.flush()
    await db.refresh(user)
    return await build_user_response(db, user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[User, require_roles("platform_admin")],
) -> None:
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.deleted_at = datetime.now(timezone.utc)
    await db.flush()

"""Admin-only API for inspecting platform activity logs."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.activity_logs.schemas import (
    ActivityLogFacetsResponse,
    ActivityLogListResponse,
    ActivityLogResponse,
)
from app.activity_logs.service import list_activity_logs, list_facets
from app.auth.dependencies import require_roles
from app.auth.models import User
from app.database import get_db

router = APIRouter()
PlatformAdmin = Annotated[User, require_roles("platform_admin")]


@router.get("", response_model=ActivityLogListResponse)
async def get_activity_logs(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: PlatformAdmin,
    user_search: str | None = Query(default=None),
    role_name: str | None = Query(default=None),
    event_category: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    success: bool | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
) -> ActivityLogListResponse:
    items, total = await list_activity_logs(
        db,
        user_search=user_search,
        role_name=role_name,
        event_category=event_category,
        event_type=event_type,
        success=success,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    return ActivityLogListResponse(
        items=[ActivityLogResponse.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/facets", response_model=ActivityLogFacetsResponse)
async def get_activity_log_facets(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: PlatformAdmin,
) -> ActivityLogFacetsResponse:
    categories, types, roles = await list_facets(db)
    return ActivityLogFacetsResponse(
        event_categories=categories, event_types=types, roles=roles
    )

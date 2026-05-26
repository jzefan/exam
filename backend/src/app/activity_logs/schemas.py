"""Pydantic schemas for activity log responses."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ActivityLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID | None
    username: str | None
    full_name: str | None
    role_name: str | None
    event_category: str
    event_type: str
    target_type: str | None
    target_id: str | None
    event_metadata: dict[str, Any] | None = Field(default=None, alias="event_metadata")
    ip_address: str | None
    user_agent: str | None
    success: bool
    created_at: datetime


class ActivityLogListResponse(BaseModel):
    items: list[ActivityLogResponse]
    total: int
    page: int
    page_size: int


class ActivityLogFacetsResponse(BaseModel):
    """Distinct values to populate filter dropdowns in the admin UI."""

    event_categories: list[str]
    event_types: list[str]
    roles: list[str]

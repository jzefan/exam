import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class NotificationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    type: str = Field(max_length=80)
    title: str = Field(max_length=200)
    content: str | None = None
    link_url: str | None = Field(default=None, max_length=500)
    payload: dict[str, Any] | list[Any] | str | int | float | bool | None = None
    read_at: datetime | None = None
    created_at: datetime

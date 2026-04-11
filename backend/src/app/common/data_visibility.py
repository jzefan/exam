"""Shared ownership and visibility primitives."""

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column


class VisibilityScope(str, enum.Enum):
    PRIVATE = "private"
    PLATFORM = "platform"


class OwnerMixin:
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)


class VisibilityMixin:
    visibility: Mapped[VisibilityScope] = mapped_column(
        Enum(
            VisibilityScope,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            name="visibilityscope",
        ),
        nullable=False,
        default=VisibilityScope.PRIVATE,
        server_default=VisibilityScope.PRIVATE.value,
    )

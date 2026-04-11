"""Shared resource access rules for teacher-facing resources."""

from typing import Any

from sqlalchemy import or_
from sqlalchemy.sql.elements import ColumnElement

from app.common.data_visibility import VisibilityScope


def can_read_shared_resource(
    *,
    is_platform_admin: bool,
    current_user_id: Any,
    owner_id: Any,
    visibility: VisibilityScope,
) -> bool:
    """Return whether the current user can read a shared resource.

    This helper includes the platform-admin bypass.
    """
    if is_platform_admin:
        return True
    if current_user_id == owner_id:
        return True
    return visibility == VisibilityScope.PLATFORM


def can_write_owned_resource(*, is_platform_admin: bool, current_user_id: Any, owner_id: Any) -> bool:
    """Return whether the current user can write an owned resource."""
    return is_platform_admin or current_user_id == owner_id


def teacher_visible_resource_filter(model: Any, current_user_id: Any) -> ColumnElement[bool]:
    """Return the teacher-scoped SQLAlchemy predicate for visible resources.

    This filter does not include a platform-admin bypass. Callers should branch
    before using it if admins need broader access.
    """
    return or_(model.owner_id == current_user_id, model.visibility == VisibilityScope.PLATFORM)


def teacher_owned_resource_filter(model: Any, current_user_id: Any) -> ColumnElement[bool]:
    """Return the teacher-scoped SQLAlchemy predicate for owned resources."""
    return model.owner_id == current_user_id

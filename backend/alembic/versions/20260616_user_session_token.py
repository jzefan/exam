"""Track the active session token for single-session student logins.

Revision ID: 20260616_user_session_token
Revises: 20260615_course_gradebook
Create Date: 2026-06-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260616_user_session_token"
down_revision: Union[str, None] = "20260615_course_gradebook"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    return any(column["name"] == column_name for column in sa.inspect(op.get_bind()).get_columns(table_name))


def upgrade() -> None:
    if not _has_column("users", "session_token"):
        op.add_column("users", sa.Column("session_token", sa.String(length=64), nullable=True))


def downgrade() -> None:
    if _has_column("users", "session_token"):
        op.drop_column("users", "session_token")

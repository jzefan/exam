"""Track the previous successful login for onboarding reminders.

Revision ID: 20260614_user_last_login_at
Revises: 20260610_material_knowledge_chunks
Create Date: 2026-06-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260614_user_last_login_at"
down_revision: Union[str, None] = "20260610_material_knowledge_chunks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    return any(column["name"] == column_name for column in sa.inspect(op.get_bind()).get_columns(table_name))


def upgrade() -> None:
    if not _has_column("users", "last_login_at"):
        op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    if _has_column("users", "last_login_at"):
        op.drop_column("users", "last_login_at")

"""add dimension_comments to grading_result_snapshots

Revision ID: 20260512_add_dimension_comments
Revises: 20260512_add_must_change_password_to_users
Create Date: 2026-05-12 14:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260512_add_dimension_comments"
down_revision: str | None = "20260512_add_must_change_password_to_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "grading_result_snapshots",
        sa.Column(
            "dimension_comments",
            sa.JSON().with_variant(JSONB, "postgresql"),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.alter_column("grading_result_snapshots", "dimension_comments", server_default=None)


def downgrade() -> None:
    op.drop_column("grading_result_snapshots", "dimension_comments")

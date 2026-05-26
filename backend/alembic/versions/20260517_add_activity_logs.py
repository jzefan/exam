"""add_activity_logs

Revision ID: 20260517_activity_logs
Revises: 20260513_attempt_state
Create Date: 2026-05-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "20260517_activity_logs"
down_revision: Union[str, None] = "20260513_attempt_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("username", sa.String(length=120), nullable=True),
        sa.Column("full_name", sa.String(length=120), nullable=True),
        sa.Column("role_name", sa.String(length=50), nullable=True),
        sa.Column("event_category", sa.String(length=40), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("target_type", sa.String(length=40), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column(
            "metadata",
            sa.JSON().with_variant(JSONB, "postgresql"),
            nullable=True,
        ),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=400), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_activity_logs_user_created", "activity_logs", ["user_id", "created_at"]
    )
    op.create_index(
        "ix_activity_logs_category_created",
        "activity_logs",
        ["event_category", "created_at"],
    )
    op.create_index(
        "ix_activity_logs_role_created", "activity_logs", ["role_name", "created_at"]
    )
    op.create_index("ix_activity_logs_created_at", "activity_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_activity_logs_created_at", "activity_logs")
    op.drop_index("ix_activity_logs_role_created", "activity_logs")
    op.drop_index("ix_activity_logs_category_created", "activity_logs")
    op.drop_index("ix_activity_logs_user_created", "activity_logs")
    op.drop_table("activity_logs")

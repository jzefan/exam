"""add exam show_score flag

Revision ID: 20260719_add_exam_show_score
Revises: 20260702_backfill_choice_multi_flag
Create Date: 2026-07-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260719_add_exam_show_score"
down_revision: str | Sequence[str] | None = "20260702_backfill_choice_multi_flag"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    exam_columns = {column["name"] for column in inspector.get_columns("exams")}
    if "show_score" not in exam_columns:
        op.add_column("exams", sa.Column("show_score", sa.Boolean(), nullable=False, server_default=sa.true()))
        op.alter_column("exams", "show_score", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    exam_columns = {column["name"] for column in inspector.get_columns("exams")}
    if "show_score" in exam_columns:
        op.drop_column("exams", "show_score")

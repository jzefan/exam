"""add exam allow retake flag

Revision ID: 20260421_add_exam_allow_retake
Revises: 20260421_submission_history
Create Date: 2026-04-21 22:40:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260421_add_exam_allow_retake"
down_revision: str | Sequence[str] | None = "20260421_submission_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    exam_columns = {column["name"] for column in inspector.get_columns("exams")}
    if "allow_retake" not in exam_columns:
        op.add_column("exams", sa.Column("allow_retake", sa.Boolean(), nullable=False, server_default=sa.false()))
        op.alter_column("exams", "allow_retake", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    exam_columns = {column["name"] for column in inspector.get_columns("exams")}
    if "allow_retake" in exam_columns:
        op.drop_column("exams", "allow_retake")

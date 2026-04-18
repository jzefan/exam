"""add category to exams

Revision ID: 20260417_add_exam_category
Revises: 20260414_add_exam_question_mode
Create Date: 2026-04-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260417_add_exam_category"
down_revision: Union[str, None] = "20260414_add_exam_question_mode"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "exams",
        sa.Column("category", sa.String(length=20), nullable=False, server_default="exam"),
    )


def downgrade() -> None:
    op.drop_column("exams", "category")

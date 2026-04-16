"""add question mode to exams

Revision ID: 20260414_add_exam_question_mode
Revises: 20260413_job_model_deproject
Create Date: 2026-04-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260414_add_exam_question_mode"
down_revision: Union[str, None] = "20260413_job_model_deproject"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("exams", sa.Column("question_mode", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("exams", "question_mode")

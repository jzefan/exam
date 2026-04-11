"""extend_grading_task_source_business_id

Revision ID: ext_grading_task_src_id
Revises: student_async_grading_workflow
Create Date: 2026-04-10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ext_grading_task_src_id"
down_revision: Union[str, None] = "student_async_grading_workflow"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "grading_tasks",
        "source_business_id",
        existing_type=sa.String(length=100),
        type_=sa.String(length=160),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "grading_tasks",
        "source_business_id",
        existing_type=sa.String(length=160),
        type_=sa.String(length=100),
        existing_nullable=True,
    )

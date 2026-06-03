"""link generated questions to learning resources

Revision ID: 20260603_question_learning_resources
Revises: 20260602_course_semester_major_label
Create Date: 2026-06-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260603_question_learning_resources"
down_revision: Union[str, None] = "20260602_course_semester_major_label"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "question_learning_resources",
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resource_id"], ["learning_resources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("question_id", "resource_id"),
    )
    op.create_index(
        "ix_question_learning_resources_resource_id",
        "question_learning_resources",
        ["resource_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_question_learning_resources_resource_id",
        table_name="question_learning_resources",
    )
    op.drop_table("question_learning_resources")

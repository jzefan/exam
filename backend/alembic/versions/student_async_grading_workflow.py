"""student_async_grading_workflow

Revision ID: student_async_grading_workflow
Revises: add_classes
Create Date: 2026-04-10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "student_async_grading_workflow"
down_revision: Union[str, None] = "add_classes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "exam_students",
        sa.Column("grading_status", sa.String(length=20), nullable=False, server_default="reviewed"),
    )
    op.add_column("exam_students", sa.Column("objective_score", sa.Float(), nullable=True))
    op.add_column("exam_students", sa.Column("subjective_score", sa.Float(), nullable=True))
    op.add_column("exam_students", sa.Column("ai_scored_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("exam_students", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "student_notifications",
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("related_exam_id", sa.UUID(), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["related_exam_id"], ["exams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("student_notifications")
    op.drop_column("exam_students", "reviewed_at")
    op.drop_column("exam_students", "ai_scored_at")
    op.drop_column("exam_students", "subjective_score")
    op.drop_column("exam_students", "objective_score")
    op.drop_column("exam_students", "grading_status")

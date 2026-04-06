"""add_student_exam_runtime_tables

Revision ID: add_student_exam_runtime
Revises: extend_exams_add_positions
Create Date: 2026-03-29
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "add_student_exam_runtime"
down_revision: Union[str, None] = "extend_exams_add_positions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("exam_students", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("exam_students", sa.Column("switch_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("exam_students", sa.Column("saved_answers", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("exam_students", sa.Column("score", sa.Float(), nullable=True))
    op.add_column("exam_students", sa.Column("graded_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "student_exam_answers",
        sa.Column("exam_id", sa.UUID(), nullable=False),
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column("question_id", sa.UUID(), nullable=False),
        sa.Column("answer_content", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("score_awarded", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_correct", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("feedback", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exam_id", "student_id", "question_id", name="uq_student_exam_answer"),
    )

    op.create_table(
        "student_question_progress",
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column("question_id", sa.UUID(), nullable=False),
        sa.Column("last_exam_id", sa.UUID(), nullable=True),
        sa.Column("wrong_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_wrong_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mastered", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("mastered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["last_exam_id"], ["exams.id"]),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("student_id", "question_id", name="uq_student_question_progress"),
    )

    op.create_table(
        "student_exam_appeals",
        sa.Column("exam_id", sa.UUID(), nullable=False),
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column("question_id", sa.UUID(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("teacher_reply", sa.Text(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exam_id", "student_id", "question_id", name="uq_student_exam_appeal"),
    )


def downgrade() -> None:
    op.drop_table("student_exam_appeals")
    op.drop_table("student_question_progress")
    op.drop_table("student_exam_answers")
    op.drop_column("exam_students", "graded_at")
    op.drop_column("exam_students", "score")
    op.drop_column("exam_students", "saved_answers")
    op.drop_column("exam_students", "switch_count")
    op.drop_column("exam_students", "started_at")

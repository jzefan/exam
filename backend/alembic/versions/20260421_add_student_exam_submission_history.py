"""add student exam submission history

Revision ID: 20260421_submission_history
Revises: 20260420_q_import_completed
Create Date: 2026-04-21 21:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260421_submission_history"
down_revision: str | Sequence[str] | None = "20260420_q_import_completed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "student_exam_submissions" not in table_names:
        op.create_table(
            "student_exam_submissions",
            sa.Column("exam_id", sa.Uuid(), nullable=False),
            sa.Column("student_id", sa.Uuid(), nullable=False),
            sa.Column("attempt_no", sa.Integer(), nullable=False),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("grading_status", sa.String(length=20), nullable=False),
            sa.Column("objective_score", sa.Float(), nullable=True),
            sa.Column("subjective_score", sa.Float(), nullable=True),
            sa.Column("score", sa.Float(), nullable=True),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("exam_id", "student_id", "attempt_no", name="uq_student_exam_submission_attempt"),
        )

    if "student_exam_submission_answers" not in table_names:
        op.create_table(
            "student_exam_submission_answers",
            sa.Column("submission_id", sa.Uuid(), nullable=False),
            sa.Column("exam_id", sa.Uuid(), nullable=False),
            sa.Column("student_id", sa.Uuid(), nullable=False),
            sa.Column("question_id", sa.Uuid(), nullable=False),
            sa.Column("answer_content", sa.JSON(), nullable=False),
            sa.Column("score_awarded", sa.Float(), nullable=False),
            sa.Column("is_correct", sa.Boolean(), nullable=False),
            sa.Column("feedback", sa.JSON(), nullable=False),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["submission_id"], ["student_exam_submissions.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("submission_id", "question_id", name="uq_student_exam_submission_answer"),
        )

    exam_student_columns = {column["name"] for column in inspector.get_columns("exam_students")}
    if "submission_count" not in exam_student_columns:
        op.add_column("exam_students", sa.Column("submission_count", sa.Integer(), nullable=False, server_default="0"))
        op.alter_column("exam_students", "submission_count", server_default=None)
    if "latest_submission_id" not in exam_student_columns:
        op.add_column("exam_students", sa.Column("latest_submission_id", sa.Uuid(), nullable=True))

    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("exam_students")}
    if "fk_exam_students_latest_submission_id" not in foreign_keys:
        op.create_foreign_key(
            "fk_exam_students_latest_submission_id",
            "exam_students",
            "student_exam_submissions",
            ["latest_submission_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    op.drop_constraint("fk_exam_students_latest_submission_id", "exam_students", type_="foreignkey")
    op.drop_column("exam_students", "latest_submission_id")
    op.drop_column("exam_students", "submission_count")
    op.drop_table("student_exam_submission_answers")
    op.drop_table("student_exam_submissions")

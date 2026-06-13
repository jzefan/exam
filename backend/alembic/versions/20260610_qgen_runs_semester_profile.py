"""Step 3: question generation runs + semester student profile.

Revision ID: 20260610_qgen_runs_semester_profile
Revises: 20260610_question_gen_templates
Create Date: 2026-06-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260610_qgen_runs_semester_profile"
down_revision: Union[str, None] = "20260610_question_gen_templates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    return any(c["name"] == column_name for c in sa.inspect(op.get_bind()).get_columns(table_name))


def upgrade() -> None:
    if not _has_column("course_semesters", "student_profile"):
        op.add_column("course_semesters", sa.Column("student_profile", sa.JSON(), nullable=True))

    if not _has_table("question_gen_runs"):
        op.create_table(
            "question_gen_runs",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("template_id", sa.Uuid(), nullable=True),
            sa.Column("course_kp_id", sa.Uuid(), nullable=False),
            sa.Column("owner_id", sa.Uuid(), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="running"),
            sa.Column("resolved_snapshot", sa.JSON(), nullable=True),
            sa.Column("generated_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["template_id"], ["question_gen_templates.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        )
        op.create_index("ix_question_gen_runs_template_id", "question_gen_runs", ["template_id"])
        op.create_index("ix_question_gen_runs_course_kp_id", "question_gen_runs", ["course_kp_id"])


def downgrade() -> None:
    if _has_table("question_gen_runs"):
        op.drop_table("question_gen_runs")
    if _has_column("course_semesters", "student_profile"):
        op.drop_column("course_semesters", "student_profile")

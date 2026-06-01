"""Add course semesters + exam-semester assignment join table.

Revision ID: 20260530_course_semesters
Revises: 20260520_oidc_to_users
Create Date: 2026-05-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260530_course_semesters"
down_revision: Union[str, None] = "20260520_oidc_to_users"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "course_semesters",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("course_id", sa.Uuid(), sa.ForeignKey("knowledge_points.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_course_semesters_course_id_deleted_at",
        "course_semesters",
        ["course_id", "deleted_at"],
    )
    op.create_unique_constraint(
        "uq_course_semester_name",
        "course_semesters",
        ["course_id", "name", "deleted_at"],
    )

    op.create_table(
        "exam_semester_assignments",
        sa.Column("exam_id", sa.Uuid(), sa.ForeignKey("exams.id"), primary_key=True),
        sa.Column("course_semester_id", sa.Uuid(), sa.ForeignKey("course_semesters.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_exam_semester_assignments_semester",
        "exam_semester_assignments",
        ["course_semester_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_exam_semester_assignments_semester", table_name="exam_semester_assignments")
    op.drop_table("exam_semester_assignments")
    op.drop_index("ix_course_semesters_course_id_deleted_at", table_name="course_semesters")
    op.drop_constraint("uq_course_semester_name", "course_semesters", type_="unique")
    op.drop_table("course_semesters")

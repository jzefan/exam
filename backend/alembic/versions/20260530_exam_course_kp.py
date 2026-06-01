"""Add exams.course_kp_id linking exams to a course (root knowledge point).

Revision ID: 20260530_exam_course_kp
Revises: 20260530_course_semesters
Create Date: 2026-05-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260530_exam_course_kp"
down_revision: Union[str, None] = "20260530_course_semesters"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "exams",
        sa.Column(
            "course_kp_id",
            sa.Uuid(),
            sa.ForeignKey("knowledge_points.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_exams_course_kp_id",
        "exams",
        ["course_kp_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_exams_course_kp_id", table_name="exams")
    op.drop_column("exams", "course_kp_id")

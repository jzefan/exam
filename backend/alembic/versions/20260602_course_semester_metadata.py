"""Add metadata fields to course semesters.

Revision ID: 20260602_course_semester_metadata
Revises: 20260602_job_course_graph
Create Date: 2026-06-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260602_course_semester_metadata"
down_revision: Union[str, None] = "20260602_job_course_graph"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _has_column("course_semesters", "major_name"):
        op.add_column("course_semesters", sa.Column("major_name", sa.String(200), nullable=True))
    if not _has_column("course_semesters", "major_description"):
        op.add_column("course_semesters", sa.Column("major_description", sa.Text(), nullable=True))
    if not _has_column("course_semesters", "class_ids"):
        op.add_column(
            "course_semesters",
            sa.Column("class_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        )
        op.alter_column("course_semesters", "class_ids", server_default=None)


def downgrade() -> None:
    if _has_column("course_semesters", "class_ids"):
        op.drop_column("course_semesters", "class_ids")
    if _has_column("course_semesters", "major_description"):
        op.drop_column("course_semesters", "major_description")
    if _has_column("course_semesters", "major_name"):
        op.drop_column("course_semesters", "major_name")

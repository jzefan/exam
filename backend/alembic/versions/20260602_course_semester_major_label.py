"""Rename semester major metadata to label fields.

Revision ID: 20260602_course_semester_major_label
Revises: 20260602_course_semester_metadata
Create Date: 2026-06-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260602_course_semester_major_label"
down_revision: Union[str, None] = "20260602_course_semester_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if _has_column("course_semesters", "major_name") and not _has_column(
        "course_semesters", "semester_major_label"
    ):
        op.alter_column("course_semesters", "major_name", new_column_name="semester_major_label")
    if _has_column("course_semesters", "major_description") and not _has_column(
        "course_semesters", "semester_major_description"
    ):
        op.alter_column(
            "course_semesters",
            "major_description",
            new_column_name="semester_major_description",
        )


def downgrade() -> None:
    if _has_column("course_semesters", "semester_major_description") and not _has_column(
        "course_semesters", "major_description"
    ):
        op.alter_column(
            "course_semesters",
            "semester_major_description",
            new_column_name="major_description",
        )
    if _has_column("course_semesters", "semester_major_label") and not _has_column(
        "course_semesters", "major_name"
    ):
        op.alter_column("course_semesters", "semester_major_label", new_column_name="major_name")

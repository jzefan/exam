"""Add course grade weights and manual grade overrides.

Revision ID: 20260615_course_gradebook
Revises: 20260614_user_last_login_at
Create Date: 2026-06-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260615_course_gradebook"
down_revision: Union[str, None] = "20260614_user_last_login_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("course_grade_weights"):
        op.create_table(
            "course_grade_weights",
            sa.Column("course_id", sa.Uuid(), nullable=False),
            sa.Column("weights", sa.JSON(), nullable=False),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["course_id"], ["knowledge_points.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("course_id"),
        )
        op.create_index(
            "ix_course_grade_weights_course_id",
            "course_grade_weights",
            ["course_id"],
        )

    if not _has_table("course_student_grades"):
        op.create_table(
            "course_student_grades",
            sa.Column("course_id", sa.Uuid(), nullable=False),
            sa.Column("student_id", sa.Uuid(), nullable=False),
            sa.Column("semester_scores", sa.JSON(), nullable=False),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["course_id"], ["knowledge_points.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("course_id", "student_id", name="uq_course_student_grade"),
        )
        op.create_index(
            "ix_course_student_grades_course_id",
            "course_student_grades",
            ["course_id"],
        )
        op.create_index(
            "ix_course_student_grades_student_id",
            "course_student_grades",
            ["student_id"],
        )


def downgrade() -> None:
    if _has_table("course_student_grades"):
        op.drop_table("course_student_grades")
    if _has_table("course_grade_weights"):
        op.drop_table("course_grade_weights")

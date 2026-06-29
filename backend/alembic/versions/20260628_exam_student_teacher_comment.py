"""Add teacher_comment to exam_students for whole-paper exam evaluation.

Revision ID: 20260628_exam_student_teacher_comment
Revises: 20260616_user_session_token
Create Date: 2026-06-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260628_exam_student_teacher_comment"
down_revision: Union[str, None] = "20260616_user_session_token"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    return any(column["name"] == column_name for column in sa.inspect(op.get_bind()).get_columns(table_name))


def upgrade() -> None:
    if not _has_column("exam_students", "teacher_comment"):
        op.add_column("exam_students", sa.Column("teacher_comment", sa.Text(), nullable=True))


def downgrade() -> None:
    if _has_column("exam_students", "teacher_comment"):
        op.drop_column("exam_students", "teacher_comment")

"""Add source links to exam questions for teacher-side mock exam provenance.

Revision ID: 20260605_exam_question_source_links
Revises: 20260604_question_source
Create Date: 2026-06-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260605_exam_question_source_links"
down_revision: Union[str, None] = "20260604_question_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _has_column("exam_questions", "source_exam_id"):
        op.add_column("exam_questions", sa.Column("source_exam_id", sa.Uuid(), nullable=True))
    if not _has_column("exam_questions", "source_question_id"):
        op.add_column("exam_questions", sa.Column("source_question_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    if _has_column("exam_questions", "source_question_id"):
        op.drop_column("exam_questions", "source_question_id")
    if _has_column("exam_questions", "source_exam_id"):
        op.drop_column("exam_questions", "source_exam_id")

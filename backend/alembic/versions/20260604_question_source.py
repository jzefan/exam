"""Add source column to questions (manual / ai_generated / imported).

Revision ID: 20260604_question_source
Revises: 20260602_course_semester_major_label
Create Date: 2026-06-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260604_question_source"
down_revision: Union[str, None] = "20260602_course_semester_major_label"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _has_column("questions", "source"):
        op.add_column(
            "questions",
            sa.Column("source", sa.String(length=20), nullable=False, server_default="manual"),
        )
    # 尽力回填历史数据：归属"AI题库"的题目标记为 AI 生成。
    op.execute(
        """
        UPDATE questions
        SET source = 'ai_generated'
        WHERE source = 'manual'
          AND question_bank_id IN (
              SELECT id FROM question_banks WHERE name = 'AI题库'
          )
        """
    )


def downgrade() -> None:
    if _has_column("questions", "source"):
        op.drop_column("questions", "source")

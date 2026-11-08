"""question filter indexes

Revision ID: 20261108_question_filter_idx
Revises: 20261015_course_share
Create Date: 2026-11-08 10:00:00.000000

补齐按知识点 / 标签 / 题型筛选题目时的反向索引：
- question_knowledge_points / question_tags 的主键以 question_id 打头，
  只按 knowledge_point_id / tag_id 查询用不上索引，题库大时全表扫描明显。
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261108_question_filter_idx"
down_revision: Union[str, None] = "20261015_course_share"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if "question_knowledge_points" in inspector.get_table_names():
        names = _index_names(inspector, "question_knowledge_points")
        if "ix_question_knowledge_points_knowledge_point_id" not in names:
            op.create_index(
                "ix_question_knowledge_points_knowledge_point_id",
                "question_knowledge_points",
                ["knowledge_point_id"],
            )

    if "question_tags" in inspector.get_table_names():
        names = _index_names(inspector, "question_tags")
        if "ix_question_tags_tag_id" not in names:
            op.create_index("ix_question_tags_tag_id", "question_tags", ["tag_id"])

    if "questions" in inspector.get_table_names():
        names = _index_names(inspector, "questions")
        if "ix_questions_question_bank_id_type" not in names:
            op.create_index(
                "ix_questions_question_bank_id_type",
                "questions",
                ["question_bank_id", "type"],
            )


def downgrade() -> None:
    op.drop_index("ix_questions_question_bank_id_type", table_name="questions")
    op.drop_index("ix_question_tags_tag_id", table_name="question_tags")
    op.drop_index(
        "ix_question_knowledge_points_knowledge_point_id",
        table_name="question_knowledge_points",
    )

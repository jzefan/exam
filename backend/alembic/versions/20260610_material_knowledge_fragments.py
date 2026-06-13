"""Rename learning_resources.knowledge_tags -> knowledge_fragments (structured).

Revision ID: 20260610_material_knowledge_fragments
Revises: 20260610_material_knowledge_tags
Create Date: 2026-06-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260610_material_knowledge_fragments"
down_revision: Union[str, None] = "20260610_material_knowledge_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    return any(c["name"] == column_name for c in sa.inspect(op.get_bind()).get_columns(table_name))


def upgrade() -> None:
    if _has_column("learning_resources", "knowledge_tags") and not _has_column(
        "learning_resources", "knowledge_fragments"
    ):
        op.alter_column("learning_resources", "knowledge_tags", new_column_name="knowledge_fragments")
    elif not _has_column("learning_resources", "knowledge_fragments"):
        op.add_column("learning_resources", sa.Column("knowledge_fragments", sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_column("learning_resources", "knowledge_fragments"):
        op.alter_column("learning_resources", "knowledge_fragments", new_column_name="knowledge_tags")

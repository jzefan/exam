"""Add knowledge_tags to learning_resources (material chapter key-points).

Revision ID: 20260610_material_knowledge_tags
Revises: 20260610_qgen_runs_semester_profile
Create Date: 2026-06-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260610_material_knowledge_tags"
down_revision: Union[str, None] = "20260610_qgen_runs_semester_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    return any(c["name"] == column_name for c in sa.inspect(op.get_bind()).get_columns(table_name))


def upgrade() -> None:
    if not _has_column("learning_resources", "knowledge_tags"):
        op.add_column("learning_resources", sa.Column("knowledge_tags", sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_column("learning_resources", "knowledge_tags"):
        op.drop_column("learning_resources", "knowledge_tags")

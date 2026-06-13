"""Course KB chunks table + material ingestion status (ArkLoop-style RAG layer).

Revision ID: 20260610_material_knowledge_chunks
Revises: 20260610_material_knowledge_fragments
Create Date: 2026-06-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260610_material_knowledge_chunks"
down_revision: Union[str, None] = "20260610_material_knowledge_fragments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    return any(c["name"] == column_name for c in sa.inspect(op.get_bind()).get_columns(table_name))


def upgrade() -> None:
    if not _has_table("course_material_chunks"):
        op.create_table(
            "course_material_chunks",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("resource_id", sa.Uuid(), nullable=False),
            sa.Column("course_kp_id", sa.Uuid(), nullable=False),
            sa.Column("node_id", sa.Uuid(), nullable=False),
            sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("heading_path", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("chunk_type", sa.String(length=20), nullable=False, server_default="text"),
            sa.Column("text", sa.Text(), nullable=False, server_default=""),
            sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("embedding", sa.JSON(), nullable=True),
            sa.Column("embedding_model", sa.String(length=100), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_course_material_chunks_resource_id", "course_material_chunks", ["resource_id"])
        op.create_index("ix_course_material_chunks_course_kp_id", "course_material_chunks", ["course_kp_id"])
        op.create_index("ix_course_material_chunks_node_id", "course_material_chunks", ["node_id"])

    for column in (
        sa.Column("kb_status", sa.String(length=20), nullable=True),
        sa.Column("kb_error", sa.Text(), nullable=True),
        sa.Column("kb_chunk_count", sa.Integer(), nullable=False, server_default="0"),
    ):
        if not _has_column("learning_resources", column.name):
            op.add_column("learning_resources", column)


def downgrade() -> None:
    for name in ("kb_chunk_count", "kb_error", "kb_status"):
        if _has_column("learning_resources", name):
            op.drop_column("learning_resources", name)
    if _has_table("course_material_chunks"):
        op.drop_table("course_material_chunks")

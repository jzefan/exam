"""add knowledge point sort_order

课程目录（知识点树）原先是按 `created_at` 排的，没有可写的排序字段，
所以「上移 / 下移 / 拖到别的目录下」这类操作无处落地。这里补上 sort_order。

Revision ID: 20260920_add_kp_sort_order
Revises: 20260919_add_exam_remedial_practice
Create Date: 2026-09-20 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260920_add_kp_sort_order"
down_revision: str | Sequence[str] | None = "20260919_add_exam_remedial_practice"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("knowledge_points")}
    if "sort_order" in columns:
        return

    op.add_column(
        "knowledge_points",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_knowledge_points_parent_sort",
        "knowledge_points",
        ["parent_id", "sort_order"],
    )

    # 按迁移前的排序口径（同父节点内 created_at 升序）回填，
    # 保证升级前后目录显示顺序完全一致。
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY created_at, id) - 1 AS rn
                FROM knowledge_points
            )
            UPDATE knowledge_points AS kp
            SET sort_order = ranked.rn
            FROM ranked
            WHERE kp.id = ranked.id
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("knowledge_points")}
    if "sort_order" not in columns:
        return

    op.drop_index("ix_knowledge_points_parent_sort", table_name="knowledge_points")
    op.drop_column("knowledge_points", "sort_order")

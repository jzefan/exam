"""add_knowledge_management

Revision ID: add_knowledge_management
Revises: b2eedb328ff8
Create Date: 2026-03-17

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "add_knowledge_management"
down_revision: Union[str, None] = "b2eedb328ff8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "major",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "direction",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("major_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["major_id"], ["major.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column("knowledge_points", sa.Column("direction_id", sa.Uuid(), nullable=True))
    op.add_column("knowledge_points", sa.Column("tags", postgresql.JSONB(), server_default="[]", nullable=True))
    op.add_column("knowledge_points", sa.Column("difficulty", sa.String(10), nullable=True))
    op.create_foreign_key(
        "fk_kp_direction", "knowledge_points", "direction", ["direction_id"], ["id"], ondelete="SET NULL"
    )
    op.create_check_constraint(
        "ck_kp_difficulty",
        "knowledge_points",
        "difficulty IN ('入门','初级','中级','高级','困难')",
    )
    op.create_table(
        "knowledge_point_prerequisite",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("from_id", sa.Uuid(), nullable=False),
        sa.Column("to_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["from_id"], ["knowledge_points.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_id"], ["knowledge_points.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("from_id", "to_id"),
    )


def downgrade() -> None:
    op.drop_table("knowledge_point_prerequisite")
    op.drop_constraint("ck_kp_difficulty", "knowledge_points", type_="check")
    op.drop_constraint("fk_kp_direction", "knowledge_points", type_="foreignkey")
    op.drop_column("knowledge_points", "difficulty")
    op.drop_column("knowledge_points", "tags")
    op.drop_column("knowledge_points", "direction_id")
    op.drop_table("direction")
    op.drop_table("major")

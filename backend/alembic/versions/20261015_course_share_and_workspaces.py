"""Add course share links and course user workspaces tables.

Revision ID: 20261015_course_share
Revises: 20260925_cx_read_cache
Create Date: 2026-10-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261015_course_share"
down_revision = "20260925_cx_read_cache"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    table_names = set(inspector.get_table_names())

    if "course_share_links" not in table_names:
        op.create_table(
            "course_share_links",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("course_id", sa.Uuid(), sa.ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False),
            sa.Column("share_code", sa.String(32), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("settings", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("share_code", name="uq_course_share_link_code"),
        )
        op.create_index("ix_course_share_links_course_id_active", "course_share_links", ["course_id", "is_active"])
        op.create_index("ix_course_share_links_share_code", "course_share_links", ["share_code"])

    if "course_user_workspaces" not in table_names:
        op.create_table(
            "course_user_workspaces",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("course_id", sa.Uuid(), sa.ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("workspace_key", sa.String(64), nullable=True),
            sa.Column("password_hash", sa.String(255), nullable=True),
            sa.Column("alias_name", sa.String(100), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("course_id", "user_id", name="uq_course_user_workspace"),
        )
        op.create_index("ix_course_user_workspaces_course_key", "course_user_workspaces", ["course_id", "workspace_key"])
        op.create_index("ix_course_user_workspaces_user_id", "course_user_workspaces", ["user_id"])


def downgrade():
    inspector = sa.inspect(op.get_bind())
    table_names = set(inspector.get_table_names())

    if "course_user_workspaces" in table_names:
        op.drop_index("ix_course_user_workspaces_user_id", table_name="course_user_workspaces")
        op.drop_index("ix_course_user_workspaces_course_key", table_name="course_user_workspaces")
        op.drop_table("course_user_workspaces")

    if "course_share_links" in table_names:
        op.drop_index("ix_course_share_links_share_code", table_name="course_share_links")
        op.drop_index("ix_course_share_links_course_id_active", table_name="course_share_links")
        op.drop_table("course_share_links")

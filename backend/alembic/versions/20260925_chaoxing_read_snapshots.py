"""Persist normalized Chaoxing read snapshots without upstream URLs."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260925_cx_read_cache"
down_revision = "20260924_cx_media"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "chaoxing_read_snapshots" in inspector.get_table_names():
        return
    op.create_table(
        "chaoxing_read_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_key", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("scope_key", sa.String(512), nullable=False),
        sa.Column("payload", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fresh_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("purge_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("owner_id", "account_key", "kind", "scope_key", name="uq_cx_read_snapshot_scope"),
    )
    op.create_index("ix_chaoxing_read_snapshots_owner_id", "chaoxing_read_snapshots", ["owner_id"])
    op.create_index("ix_chaoxing_read_snapshots_purge_after", "chaoxing_read_snapshots", ["purge_after"])


def downgrade():
    op.drop_index("ix_chaoxing_read_snapshots_purge_after", table_name="chaoxing_read_snapshots")
    op.drop_index("ix_chaoxing_read_snapshots_owner_id", table_name="chaoxing_read_snapshots")
    op.drop_table("chaoxing_read_snapshots")

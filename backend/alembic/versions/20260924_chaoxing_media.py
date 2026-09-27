"""Preserve external paper rich content and private media."""
from alembic import op
import sqlalchemy as sa

revision = "20260924_cx_media"
down_revision = "20260923_cx_credentials"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    if "rich_content" not in {column["name"] for column in inspector.get_columns("chaoxing_grading_items")}:
        op.add_column("chaoxing_grading_items", sa.Column("rich_content", sa.JSON(), nullable=True))
    # Development startup may already have created the new media table.
    if "chaoxing_media" in inspector.get_table_names():
        return
    op.create_table(
        "chaoxing_media",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_chaoxing_media_owner_id", "chaoxing_media", ["owner_id"])


def downgrade():
    op.drop_index("ix_chaoxing_media_owner_id", table_name="chaoxing_media")
    op.drop_table("chaoxing_media")
    op.drop_column("chaoxing_grading_items", "rich_content")

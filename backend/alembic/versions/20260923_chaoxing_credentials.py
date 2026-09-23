"""Store encrypted Chaoxing credentials per teacher."""

from alembic import op
import sqlalchemy as sa

revision = "20260923_cx_credentials"
down_revision = "20260920_chaoxing_grading"
branch_labels = None
depends_on = None


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "chaoxing_credentials" not in existing:
        op.create_table(
            "chaoxing_credentials",
            sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("encrypted_payload", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "chaoxing_credentials" in existing:
        op.drop_table("chaoxing_credentials")

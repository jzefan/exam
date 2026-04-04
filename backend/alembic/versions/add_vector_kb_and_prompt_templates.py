"""add vector knowledge base and prompt templates

Revision ID: add_vector_kb_and_prompt_templates
Revises: a1b2c3d4e5f6
Create Date: 2026-04-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a9c1d2e8b7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vector_knowledge_base",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("content", sa.String(500), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("industry", sa.String(100), nullable=True),
        sa.Column("standard_name", sa.String(300), nullable=False),
        # TEXT in SQLite; in PostgreSQL this can be manually altered to vector(1536)
        # via: ALTER TABLE vector_knowledge_base ALTER COLUMN embedding TYPE vector(1536)
        # after enabling the pgvector extension.
        sa.Column("embedding", sa.Text(), nullable=False),
        sa.Column("source", sa.String(200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "prompt_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("step", sa.String(50), nullable=False),
        sa.Column("industry", sa.String(100), nullable=True),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("step IN ('extract', 'clean', 'decompose', 'grade')", name="ck_prompt_templates_step"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("prompt_templates")
    op.drop_table("vector_knowledge_base")

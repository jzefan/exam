"""add papers

Revision ID: 20260509_add_papers
Revises: 20260430_add_exam_public_links
Create Date: 2026-05-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260509_add_papers"
down_revision: str | None = "20260430_add_exam_public_links"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    preview_payload_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")

    op.create_table(
        "papers",
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("source_paper_id", sa.Uuid(), nullable=True),
        sa.Column("root_knowledge_point_id", sa.Uuid(), nullable=True),
        sa.Column("is_reusable", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["root_knowledge_point_id"], ["knowledge_points.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_paper_id"], ["papers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_papers_owner_deleted_created", "papers", ["owner_id", "deleted_at", "created_at"], unique=False
    )
    op.create_index("ix_papers_root_knowledge_point_id", "papers", ["root_knowledge_point_id"], unique=False)
    op.create_index("ix_papers_source_type", "papers", ["source_type"], unique=False)

    op.create_table(
        "paper_questions",
        sa.Column("paper_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("score_override", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["paper_id"], ["papers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("paper_id", "question_id"),
        sa.UniqueConstraint("paper_id", "order", name="uq_paper_questions_paper_order"),
    )
    op.create_index("ix_paper_questions_question_id", "paper_questions", ["question_id"], unique=False)

    op.create_table(
        "paper_import_sessions",
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("source_format", sa.String(length=20), nullable=False),
        sa.Column("root_knowledge_point_id", sa.Uuid(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("preview_payload", preview_payload_type, nullable=False),
        sa.Column("created_paper_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_paper_id"], ["papers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["root_knowledge_point_id"], ["knowledge_points.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("paper_import_sessions")
    op.drop_index("ix_paper_questions_question_id", table_name="paper_questions")
    op.drop_table("paper_questions")
    op.drop_index("ix_papers_source_type", table_name="papers")
    op.drop_index("ix_papers_root_knowledge_point_id", table_name="papers")
    op.drop_index("ix_papers_owner_deleted_created", table_name="papers")
    op.drop_table("papers")

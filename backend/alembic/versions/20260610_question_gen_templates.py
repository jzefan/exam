"""Add course question-generation templates (Step 1).

Revision ID: 20260610_question_gen_templates
Revises: 20260605_exam_question_source_links
Create Date: 2026-06-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260610_question_gen_templates"
down_revision: Union[str, None] = "20260605_exam_question_source_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if not _has_table("question_gen_templates"):
        op.create_table(
            "question_gen_templates",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("course_kp_id", sa.Uuid(), nullable=False),
            sa.Column("owner_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("student_profile", sa.JSON(), nullable=True),
            sa.Column("seed_question_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("manual_seed_questions", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("gen_rules", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["course_kp_id"], ["knowledge_points.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        )
        op.create_index("ix_question_gen_templates_course_kp_id", "question_gen_templates", ["course_kp_id"])

    if not _has_table("question_gen_template_materials"):
        op.create_table(
            "question_gen_template_materials",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("template_id", sa.Uuid(), nullable=False),
            sa.Column("resource_id", sa.Uuid(), nullable=False),
            sa.Column("resource_title", sa.String(length=255), nullable=True),
            sa.Column("content_hash", sa.String(length=64), nullable=True),
            sa.Column("text", sa.Text(), nullable=False, server_default=""),
            sa.Column("truncated", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["template_id"], ["question_gen_templates.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_question_gen_template_materials_template_id",
            "question_gen_template_materials",
            ["template_id"],
        )


def downgrade() -> None:
    if _has_table("question_gen_template_materials"):
        op.drop_table("question_gen_template_materials")
    if _has_table("question_gen_templates"):
        op.drop_table("question_gen_templates")

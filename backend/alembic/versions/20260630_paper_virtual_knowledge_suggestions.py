"""Add paper question virtual knowledge suggestions.

Revision ID: 20260630_paper_virtual_knowledge_suggestions
Revises: 20260628_exam_student_teacher_comment
Create Date: 2026-06-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260630_paper_virtual_knowledge_suggestions"
down_revision: Union[str, None] = "20260628_exam_student_teacher_comment"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("paper_question_knowledge_suggestions"):
        return

    op.create_table(
        "paper_question_knowledge_suggestions",
        sa.Column("paper_id", sa.Uuid(), nullable=False),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("suggested_name", sa.String(length=200), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["paper_id"], ["papers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("paper_id", "question_id", name="uq_paper_question_knowledge_suggestion"),
    )
    op.create_index(
        "ix_paper_question_knowledge_suggestions_paper_id",
        "paper_question_knowledge_suggestions",
        ["paper_id"],
    )
    op.create_index(
        "ix_paper_question_knowledge_suggestions_question_id",
        "paper_question_knowledge_suggestions",
        ["question_id"],
    )


def downgrade() -> None:
    if _has_table("paper_question_knowledge_suggestions"):
        op.drop_table("paper_question_knowledge_suggestions")

"""Backfill choice question multi flag.

Revision ID: 20260702_backfill_choice_multi_flag
Revises: 20260630_paper_virtual_knowledge_suggestions
Create Date: 2026-07-02
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260702_backfill_choice_multi_flag"
down_revision: Union[str, None] = "20260630_paper_virtual_knowledge_suggestions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE questions
        SET content = jsonb_set(
            COALESCE(content, '{}'::jsonb),
            '{multi}',
            CASE
                WHEN jsonb_typeof(answer -> 'correct') = 'array' THEN 'true'::jsonb
                ELSE 'false'::jsonb
            END,
            true
        )
        WHERE type = 'CHOICE'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE questions
        SET content = content - 'multi'
        WHERE type = 'CHOICE'
        """
    )

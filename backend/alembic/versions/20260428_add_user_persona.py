"""add user persona

Revision ID: 20260428_add_user_persona
Revises: 20260426_exam_invitations
Create Date: 2026-04-28
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260428_add_user_persona"
down_revision: Union[str, None] = "20260426_exam_invitations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("persona", sa.String(length=20), nullable=False, server_default="teacher"),
    )
    op.alter_column("users", "persona", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "persona")

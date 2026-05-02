"""add exam invitations table

Revision ID: 20260426_exam_invitations
Revises: 20260426_user_ext_guest
Create Date: 2026-04-26
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260426_exam_invitations"
down_revision: Union[str, None] = "20260426_user_ext_guest"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("exam_invitations"):
        op.create_table(
            "exam_invitations",
            sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
            sa.Column("exam_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("token_hash", sa.String(length=128), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
            sa.UniqueConstraint("exam_id", "user_id", name="uq_invitation_exam_user"),
        )

    indexes = {index["name"] for index in inspector.get_indexes("exam_invitations")}
    if "ix_exam_invitations_token_hash" not in indexes:
        op.create_index(
            "ix_exam_invitations_token_hash",
            "exam_invitations",
            ["token_hash"],
        )


def downgrade() -> None:
    op.drop_index("ix_exam_invitations_token_hash", table_name="exam_invitations")
    op.drop_table("exam_invitations")

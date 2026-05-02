"""add teacher ownership for students

Revision ID: 20260411_teacher_owner
Revises: 20260411_teacher_visibility
Create Date: 2026-04-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260411_teacher_owner"
down_revision = "20260411_teacher_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("owner_teacher_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_users_owner_teacher_id_users",
        "users",
        "users",
        ["owner_teacher_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_owner_teacher_id_users", "users", type_="foreignkey")
    op.drop_column("users", "owner_teacher_id")

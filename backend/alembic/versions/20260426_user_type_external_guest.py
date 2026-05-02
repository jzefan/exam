"""add user type and primary organization

Revision ID: 20260426_user_ext_guest
Revises: 20260425_user_org_multi_role
Create Date: 2026-04-26
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260426_user_ext_guest"
down_revision: Union[str, None] = "20260425_user_org_multi_role"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "user_type",
            sa.String(length=20),
            nullable=False,
            server_default="internal",
        ),
    )
    op.add_column("users", sa.Column("primary_org_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_users_primary_org_id",
        "users",
        "organizations",
        ["primary_org_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_users_phone_org_external",
        "users",
        ["phone", "primary_org_id"],
        unique=True,
        postgresql_where=sa.text(
            "deleted_at IS NULL AND user_type = 'external_guest' AND phone IS NOT NULL"
        ),
    )
    op.alter_column("users", "user_type", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_users_phone_org_external", table_name="users")
    op.drop_constraint("fk_users_primary_org_id", "users", type_="foreignkey")
    op.drop_column("users", "primary_org_id")
    op.drop_column("users", "user_type")

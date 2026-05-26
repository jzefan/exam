"""add_oidc_to_users

Adds oidc_subject and provider columns to support OIDC SSO via the ArkLoop
Identity Provider. oidc_subject mirrors the `sub` claim of the OIDC id_token
and identifies the user across SSO logins (the user's email is used as a
fallback for first-time provisioning but is not the primary key).

provider defaults to "internal" for all existing accounts; OIDC-created
users will have provider="arkloop". This lets the auth layer route credential
checks differently without changing the existing login flow.

Revision ID: 20260520_oidc_to_users
Revises: 20260517_activity_logs
Create Date: 2026-05-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260520_oidc_to_users"
down_revision: Union[str, None] = "20260517_activity_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("oidc_subject", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="internal"),
    )
    # Partial unique index: same oidc_subject must not collide among live
    # users, but soft-deleted rows are exempt.
    op.create_index(
        "ix_users_oidc_subject_active",
        "users",
        ["oidc_subject"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND oidc_subject IS NOT NULL"),
    )
    op.create_index(
        "ix_users_provider",
        "users",
        ["provider"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_users_provider", table_name="users")
    op.drop_index("ix_users_oidc_subject_active", table_name="users")
    op.drop_column("users", "provider")
    op.drop_column("users", "oidc_subject")

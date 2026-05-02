"""user_organizations multi-role primary key

Revision ID: 20260425_user_org_multi_role
Revises: 20260423_learning_owner
Create Date: 2026-04-25
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260425_user_org_multi_role"
down_revision: Union[str, None] = "20260423_learning_owner"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_organizations",
        sa.Column(
            "is_primary_role",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint(
            "user_organizations_pkey",
            "user_organizations",
            type_="primary",
        )
        op.create_primary_key(
            "pk_user_organizations",
            "user_organizations",
            ["user_id", "org_id", "role_id"],
        )
    else:
        with op.batch_alter_table("user_organizations", recreate="always") as batch_op:
            batch_op.drop_constraint(None, type_="primary")
            batch_op.create_primary_key(
                "pk_user_organizations",
                ["user_id", "org_id", "role_id"],
            )

    op.alter_column("user_organizations", "is_primary_role", server_default=None)


def downgrade() -> None:
    op.execute("DELETE FROM user_organizations WHERE is_primary_role = false")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint(
            "pk_user_organizations",
            "user_organizations",
            type_="primary",
        )
        op.create_primary_key(
            "user_organizations_pkey",
            "user_organizations",
            ["user_id", "org_id"],
        )
    else:
        with op.batch_alter_table("user_organizations", recreate="always") as batch_op:
            batch_op.drop_constraint(None, type_="primary")
            batch_op.create_primary_key(
                "user_organizations_pkey",
                ["user_id", "org_id"],
            )

    op.drop_column("user_organizations", "is_primary_role")

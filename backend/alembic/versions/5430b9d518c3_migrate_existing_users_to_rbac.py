"""migrate existing users to rbac

Revision ID: 5430b9d518c3
Revises: d03fa48e9172
Create Date: 2026-04-03 13:16:55.831440
"""
from typing import Sequence, Union

import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5430b9d518c3'
down_revision: Union[str, None] = 'd03fa48e9172'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ROLE_MAPPING = {
    "ADMIN": "platform_admin",
    "TEACHER": "teacher",
    "STUDENT": "student",
}


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Create default organization
    default_org_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    conn.execute(
        sa.text(
            "INSERT INTO organizations (id, name, type, description, is_active, created_at, updated_at) "
            "VALUES (:id, :name, :type, :desc, :active, :now, :now)"
        ),
        {
            "id": str(default_org_id),
            "name": "Default Organization",
            "type": "school",
            "desc": "Auto-created during RBAC migration",
            "active": True,
            "now": now,
        },
    )

    # 2. Get system roles (seeded at app startup)
    roles = conn.execute(
        sa.text("SELECT id, name FROM roles WHERE is_system = true AND org_id IS NULL")
    ).fetchall()
    role_map = {row[1]: row[0] for row in roles}

    if not role_map:
        # Roles not seeded yet — users will be migrated on next startup
        return

    # 3. Migrate each user to user_organizations
    users = conn.execute(
        sa.text("SELECT id, role FROM users WHERE deleted_at IS NULL")
    ).fetchall()

    for user_id, old_role in users:
        new_role_name = ROLE_MAPPING.get(old_role, "student")
        role_id = role_map.get(new_role_name)
        if role_id is None:
            continue

        conn.execute(
            sa.text(
                "INSERT INTO user_organizations (user_id, org_id, role_id, is_primary, created_at, updated_at) "
                "VALUES (:uid, :oid, :rid, :primary, :now, :now) "
                "ON CONFLICT DO NOTHING"
            ),
            {
                "uid": str(user_id),
                "oid": str(default_org_id),
                "rid": str(role_id),
                "primary": True,
                "now": now,
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM user_organizations"))
    conn.execute(
        sa.text("DELETE FROM organizations WHERE name = 'Default Organization'")
    )

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password
from app.rbac.dependencies import check_permission
from app.rbac.models import OrgType, Organization, Permission, Role
from app.rbac.service import assign_user_to_org, create_role
from app.rbac.schemas import RoleCreate


async def _create_test_user_with_permission(
    db: AsyncSession, resource: str, action: str
) -> tuple[User, Organization]:
    """Helper to create a user with a specific permission in an org."""
    org = Organization(name="Test Org", type=OrgType.ENTERPRISE.value)
    db.add(org)
    await db.flush()

    perm = Permission(resource=resource, action=action)
    db.add(perm)
    await db.flush()

    role = await create_role(
        db,
        RoleCreate(
            name="test_role",
            display_name="Test Role",
            org_id=org.id,
            permission_ids=[perm.id],
        ),
    )

    user = User(
        username="permuser",
        email="perm@test.com",
        password_hash=hash_password("pass"),
        full_name="Perm User",
    )
    db.add(user)
    await db.flush()

    await assign_user_to_org(db, user.id, org.id, role.id, is_primary=True)
    return user, org


@pytest.mark.asyncio
async def test_check_permission_success(db: AsyncSession) -> None:
    user, org = await _create_test_user_with_permission(db, "job_model", "create")
    # Should not raise
    await check_permission(db, user.id, org.id, "job_model", "create")


@pytest.mark.asyncio
async def test_check_permission_denied(db: AsyncSession) -> None:
    user, org = await _create_test_user_with_permission(db, "job_model", "create")
    with pytest.raises(HTTPException) as exc_info:
        await check_permission(db, user.id, org.id, "job_model", "delete")
    assert exc_info.value.status_code == 403

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import (
    Organization,
    OrgType,
    Permission,
    Role,
    RolePermission,
    UserOrganization,
)


@pytest.mark.asyncio
async def test_create_organization(db: AsyncSession) -> None:
    org = Organization(
        name="Test School",
        type=OrgType.SCHOOL,
        description="A test school",
    )
    db.add(org)
    await db.flush()
    await db.refresh(org)

    assert org.id is not None
    assert org.name == "Test School"
    assert org.type == OrgType.SCHOOL
    assert org.is_active is True


@pytest.mark.asyncio
async def test_create_role_with_permissions(db: AsyncSession) -> None:
    perm = Permission(resource="exam", action="create", description="Create exams")
    db.add(perm)
    await db.flush()

    role = Role(
        name="teacher",
        display_name="Teacher",
        description="School teacher",
        is_system=True,
    )
    db.add(role)
    await db.flush()

    role_perm = RolePermission(role_id=role.id, permission_id=perm.id)
    db.add(role_perm)
    await db.flush()

    result = await db.execute(
        select(RolePermission).where(RolePermission.role_id == role.id)
    )
    perms = result.scalars().all()
    assert len(perms) == 1
    assert perms[0].permission_id == perm.id


@pytest.mark.asyncio
async def test_create_user_organization(db: AsyncSession) -> None:
    from app.auth.models import User
    from app.auth.security import hash_password

    org = Organization(name="Test Org", type=OrgType.ENTERPRISE)
    db.add(org)
    await db.flush()

    role = Role(name="enterprise_admin", display_name="Enterprise Admin", is_system=True)
    db.add(role)
    await db.flush()

    user = User(
        username="testuser",
        email="test@example.com",
        password_hash=hash_password("password123"),
        full_name="Test User",
    )
    db.add(user)
    await db.flush()

    user_org = UserOrganization(
        user_id=user.id,
        org_id=org.id,
        role_id=role.id,
        is_primary=True,
    )
    db.add(user_org)
    await db.flush()

    result = await db.execute(
        select(UserOrganization).where(UserOrganization.user_id == user.id)
    )
    memberships = result.scalars().all()
    assert len(memberships) == 1
    assert memberships[0].org_id == org.id
    assert memberships[0].is_primary is True

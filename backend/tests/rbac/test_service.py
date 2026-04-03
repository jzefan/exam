import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import OrgType, Organization, Permission, Role, UserOrganization
from app.rbac.schemas import OrganizationCreate, OrganizationUpdate, RoleCreate
from app.rbac.service import (
    create_organization,
    get_organization_by_id,
    list_organizations,
    update_organization,
    create_role,
    get_role_by_id,
    list_roles,
    assign_user_to_org,
    get_user_permissions,
    user_has_permission,
)


@pytest.mark.asyncio
async def test_create_organization(db: AsyncSession) -> None:
    data = OrganizationCreate(name="Test School", type="school", description="A school")
    org = await create_organization(db, data)

    assert org.id is not None
    assert org.name == "Test School"
    assert org.type == OrgType.SCHOOL.value


@pytest.mark.asyncio
async def test_get_organization_by_id(db: AsyncSession) -> None:
    data = OrganizationCreate(name="Test Org", type="enterprise")
    org = await create_organization(db, data)

    found = await get_organization_by_id(db, org.id)
    assert found is not None
    assert found.id == org.id


@pytest.mark.asyncio
async def test_list_organizations(db: AsyncSession) -> None:
    await create_organization(db, OrganizationCreate(name="Org A", type="school"))
    await create_organization(db, OrganizationCreate(name="Org B", type="enterprise"))

    orgs = await list_organizations(db)
    assert len(orgs) >= 2


@pytest.mark.asyncio
async def test_update_organization(db: AsyncSession) -> None:
    data = OrganizationCreate(name="Old Name", type="school")
    org = await create_organization(db, data)

    updated = await update_organization(db, org, OrganizationUpdate(name="New Name"))
    assert updated.name == "New Name"


@pytest.mark.asyncio
async def test_create_role_with_permissions(db: AsyncSession) -> None:
    perm1 = Permission(resource="exam", action="create", description="Create exams")
    perm2 = Permission(resource="exam", action="read", description="Read exams")
    db.add_all([perm1, perm2])
    await db.flush()

    data = RoleCreate(
        name="teacher",
        display_name="Teacher",
        permission_ids=[perm1.id, perm2.id],
    )
    role = await create_role(db, data)

    assert role.name == "teacher"
    assert len(role.role_permissions) == 2


@pytest.mark.asyncio
async def test_assign_user_to_org_and_check_permissions(db: AsyncSession) -> None:
    from app.auth.models import User
    from app.auth.security import hash_password

    org = Organization(name="Test Org", type=OrgType.ENTERPRISE.value)
    db.add(org)
    await db.flush()

    perm = Permission(resource="job_model", action="create")
    db.add(perm)
    await db.flush()

    data = RoleCreate(
        name="enterprise_admin",
        display_name="Enterprise Admin",
        org_id=org.id,
        permission_ids=[perm.id],
    )
    role = await create_role(db, data)

    user = User(
        username="testadmin",
        email="admin@test.com",
        password_hash=hash_password("pass"),
        full_name="Test Admin",
    )
    db.add(user)
    await db.flush()

    await assign_user_to_org(db, user.id, org.id, role.id, is_primary=True)

    has = await user_has_permission(db, user.id, org.id, "job_model", "create")
    assert has is True

    has_not = await user_has_permission(db, user.id, org.id, "job_model", "delete")
    assert has_not is False

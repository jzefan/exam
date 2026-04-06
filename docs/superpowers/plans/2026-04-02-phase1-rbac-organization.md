# Phase 1: RBAC Permission System + Organization Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing enum-based role system with a full RBAC permission system and add multi-organization support, preserving backward compatibility with all existing features.

**Architecture:** New `Organization`, `Role`, `Permission`, `RolePermission`, and `UserOrganization` tables. A `require_permission()` dependency replaces the existing `require_roles()`. Existing users are migrated into a default organization. The legacy `User.role` column is kept temporarily for backward compat during migration, then removed in a final cleanup task.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (async), Alembic, pytest, Pydantic v2

**Spec:** `docs/superpowers/specs/2026-04-02-job-competency-model-design.md` (Section 1)

**Subsequent phases** (each gets its own plan):
- Phase 2: Job Model Data + CRUD
- Phase 3: Document Upload + AI Pipeline
- Phase 4: Competency Tree Editor + Graph View
- Phase 5: pgvector Semantic Search
- Phase 6: Course Mapping + Gap Analysis
- Phase 7: Templates + Exports + JD Generation

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `backend/src/app/rbac/models.py` | Organization, Role, Permission, RolePermission, UserOrganization SQLAlchemy models |
| `backend/src/app/rbac/schemas.py` | Pydantic schemas for all RBAC entities |
| `backend/src/app/rbac/service.py` | Business logic: CRUD operations, permission checking, user-org management |
| `backend/src/app/rbac/dependencies.py` | FastAPI dependencies: `require_permission()`, `get_current_org()` |
| `backend/src/app/rbac/router.py` | API routes for organization and role management |
| `backend/src/app/rbac/seed.py` | Seed data: default roles, permissions, default organization |
| `backend/alembic/versions/add_rbac_tables.py` | Migration: create RBAC tables |
| `backend/alembic/versions/migrate_users_to_rbac.py` | Data migration: move existing users into RBAC |
| `backend/alembic/versions/drop_user_role_column.py` | Cleanup migration: remove legacy `User.role` |
| `backend/tests/rbac/test_models.py` | Unit tests for RBAC models |
| `backend/tests/rbac/test_service.py` | Unit tests for RBAC service |
| `backend/tests/rbac/test_router.py` | Integration tests for RBAC API endpoints |
| `backend/tests/rbac/test_dependencies.py` | Tests for permission checking dependencies |
| `backend/tests/rbac/__init__.py` | Package init |
| `frontend/src/types/rbac.ts` | TypeScript types for RBAC entities |
| `frontend/src/pages/admin/organizations/list.tsx` | Organization management page |
| `frontend/src/pages/admin/roles/list.tsx` | Role management page |

### Modified Files

| File | Changes |
|------|---------|
| `backend/src/app/auth/models.py` | Remove `UserRole` enum (after migration) |
| `backend/src/app/auth/dependencies.py` | Update `get_current_user` to load org/role info |
| `backend/src/app/auth/security.py` | Update JWT payload to include org_id |
| `backend/src/app/auth/schemas.py` | Update `UserResponse` to include org/role info |
| `backend/src/app/auth/service.py` | Update `create_user` to assign org/role |
| `backend/src/app/auth/router.py` | Update login/register to use RBAC |
| `backend/src/app/main.py` | Register RBAC router |
| `backend/alembic/env.py` | Import RBAC models |
| `frontend/src/types/index.ts` | Update `IUser` type |
| `frontend/src/App.tsx` | Add organization/role admin routes |

---

## Task 1: RBAC Models

**Files:**
- Create: `backend/src/app/rbac/__init__.py`
- Create: `backend/src/app/rbac/models.py`
- Create: `backend/tests/rbac/__init__.py`
- Create: `backend/tests/rbac/test_models.py`

- [ ] **Step 1: Create the rbac package**

```bash
mkdir -p backend/src/app/rbac
mkdir -p backend/tests/rbac
```

- [ ] **Step 2: Write the failing test for Organization model**

Create `backend/tests/rbac/__init__.py` (empty file).

Create `backend/tests/rbac/test_models.py`:

```python
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
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/rbac/test_models.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.rbac'`

- [ ] **Step 4: Implement the RBAC models**

Create `backend/src/app/rbac/__init__.py` (empty file).

Create `backend/src/app/rbac/models.py`:

```python
"""RBAC models: Organization, Role, Permission, and association tables."""

import enum
import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, BaseModel, TimestampMixin


class OrgType(str, enum.Enum):
    ENTERPRISE = "enterprise"
    SCHOOL = "school"


class Organization(BaseModel):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Permission(BaseModel):
    __tablename__ = "permissions"

    resource: Mapped[str] = mapped_column(String(50), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("resource", "action", name="uq_permission_resource_action"),
    )


class Role(BaseModel):
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("organizations.id"), nullable=True
    )

    organization: Mapped["Organization | None"] = relationship(
        "Organization", foreign_keys=[org_id], lazy="joined"
    )
    role_permissions: Mapped[list["RolePermission"]] = relationship(
        "RolePermission", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        UniqueConstraint("name", "org_id", name="uq_role_name_org"),
    )


class RolePermission(Base, TimestampMixin):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )

    permission: Mapped[Permission] = relationship("Permission", lazy="joined")


class UserOrganization(Base, TimestampMixin):
    __tablename__ = "user_organizations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("roles.id"), nullable=False
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    organization: Mapped[Organization] = relationship("Organization", lazy="joined")
    role: Mapped[Role] = relationship("Role", lazy="joined")
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/rbac/test_models.py -v
```

Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/app/rbac/__init__.py src/app/rbac/models.py tests/rbac/__init__.py tests/rbac/test_models.py
git commit -m "feat(rbac): add Organization, Role, Permission, UserOrganization models"
```

---

## Task 2: RBAC Schemas

**Files:**
- Create: `backend/src/app/rbac/schemas.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/rbac/test_models.py`:

```python
from app.rbac.schemas import (
    OrganizationCreate,
    OrganizationResponse,
    RoleCreate,
    RoleResponse,
    PermissionResponse,
    UserOrganizationResponse,
)


def test_organization_create_schema() -> None:
    data = OrganizationCreate(name="Test School", type="school", description="A school")
    assert data.name == "Test School"
    assert data.type == "school"


def test_organization_response_from_orm(db_sync_org: None) -> None:
    """Test that OrganizationResponse can be created from model attributes."""
    import uuid
    from datetime import datetime, timezone

    response = OrganizationResponse(
        id=uuid.uuid4(),
        name="Test",
        type="school",
        description=None,
        logo_url=None,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    assert response.is_active is True


def test_role_create_schema() -> None:
    data = RoleCreate(name="teacher", display_name="Teacher", description="A teacher role")
    assert data.name == "teacher"


def test_role_response_schema() -> None:
    import uuid
    from datetime import datetime, timezone

    response = RoleResponse(
        id=uuid.uuid4(),
        name="teacher",
        display_name="Teacher",
        description="Teacher role",
        is_system=True,
        org_id=None,
        permissions=[],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    assert response.is_system is True
    assert response.permissions == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/rbac/test_models.py::test_organization_create_schema -v
```

Expected: FAIL with `ImportError`

- [ ] **Step 3: Implement the schemas**

Create `backend/src/app/rbac/schemas.py`:

```python
"""Pydantic schemas for RBAC entities."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

OrgTypeEnum = Literal["enterprise", "school"]
PermissionAction = Literal["create", "read", "update", "delete"]


class OrganizationCreate(BaseModel):
    name: str = Field(max_length=200)
    type: OrgTypeEnum
    description: str | None = None
    logo_url: str | None = None


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    logo_url: str | None = None
    is_active: bool | None = None


class OrganizationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    type: str
    description: str | None
    logo_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PermissionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    resource: str
    action: str
    description: str | None


class RoleCreate(BaseModel):
    name: str = Field(max_length=50)
    display_name: str = Field(max_length=100)
    description: str | None = None
    org_id: uuid.UUID | None = None
    permission_ids: list[uuid.UUID] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    description: str | None = None
    permission_ids: list[uuid.UUID] | None = None


class RoleResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    display_name: str
    description: str | None
    is_system: bool
    org_id: uuid.UUID | None
    permissions: list[PermissionResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class UserOrganizationCreate(BaseModel):
    user_id: uuid.UUID
    org_id: uuid.UUID
    role_id: uuid.UUID
    is_primary: bool = False


class UserOrganizationResponse(BaseModel):
    model_config = {"from_attributes": True}

    user_id: uuid.UUID
    org_id: uuid.UUID
    role_id: uuid.UUID
    is_primary: bool
    organization: OrganizationResponse | None = None
    role: RoleResponse | None = None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/rbac/test_models.py -v -k "schema"
```

Expected: All schema tests PASS

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/app/rbac/schemas.py tests/rbac/test_models.py
git commit -m "feat(rbac): add Pydantic schemas for RBAC entities"
```

---

## Task 3: RBAC Service Layer

**Files:**
- Create: `backend/src/app/rbac/service.py`
- Create: `backend/tests/rbac/test_service.py`

- [ ] **Step 1: Write the failing test for organization CRUD**

Create `backend/tests/rbac/test_service.py`:

```python
import uuid

import pytest
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

    # Create org, role with permission, user
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

    # Check permissions
    has = await user_has_permission(db, user.id, org.id, "job_model", "create")
    assert has is True

    has_not = await user_has_permission(db, user.id, org.id, "job_model", "delete")
    assert has_not is False
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/rbac/test_service.py -v
```

Expected: FAIL with `ImportError: cannot import name 'create_organization' from 'app.rbac.service'`

- [ ] **Step 3: Implement the service**

Create `backend/src/app/rbac/service.py`:

```python
"""Business logic for RBAC operations."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import (
    Organization,
    Permission,
    Role,
    RolePermission,
    UserOrganization,
)
from app.rbac.schemas import (
    OrganizationCreate,
    OrganizationUpdate,
    RoleCreate,
    RoleUpdate,
)


# --- Organization CRUD ---


async def create_organization(db: AsyncSession, data: OrganizationCreate) -> Organization:
    org = Organization(
        name=data.name,
        type=data.type,
        description=data.description,
        logo_url=data.logo_url,
    )
    db.add(org)
    await db.flush()
    await db.refresh(org)
    return org


async def get_organization_by_id(db: AsyncSession, org_id: uuid.UUID) -> Organization | None:
    result = await db.execute(
        select(Organization).where(Organization.id == org_id, Organization.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def list_organizations(db: AsyncSession) -> list[Organization]:
    result = await db.execute(
        select(Organization).where(Organization.deleted_at.is_(None)).order_by(Organization.created_at)
    )
    return list(result.scalars().all())


async def update_organization(
    db: AsyncSession, org: Organization, data: OrganizationUpdate
) -> Organization:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(org, field, value)
    await db.flush()
    await db.refresh(org)
    return org


# --- Role CRUD ---


async def create_role(db: AsyncSession, data: RoleCreate) -> Role:
    role = Role(
        name=data.name,
        display_name=data.display_name,
        description=data.description,
        org_id=data.org_id,
    )
    db.add(role)
    await db.flush()

    for perm_id in data.permission_ids:
        db.add(RolePermission(role_id=role.id, permission_id=perm_id))
    await db.flush()
    await db.refresh(role)
    return role


async def get_role_by_id(db: AsyncSession, role_id: uuid.UUID) -> Role | None:
    result = await db.execute(
        select(Role).where(Role.id == role_id, Role.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def list_roles(db: AsyncSession, org_id: uuid.UUID | None = None) -> list[Role]:
    query = select(Role).where(Role.deleted_at.is_(None))
    if org_id is not None:
        query = query.where((Role.org_id == org_id) | (Role.org_id.is_(None)))
    else:
        query = query.where(Role.org_id.is_(None))
    result = await db.execute(query.order_by(Role.name))
    return list(result.scalars().unique().all())


async def update_role(db: AsyncSession, role: Role, data: RoleUpdate) -> Role:
    if data.display_name is not None:
        role.display_name = data.display_name
    if data.description is not None:
        role.description = data.description
    if data.permission_ids is not None:
        # Clear existing and re-add
        for rp in list(role.role_permissions):
            await db.delete(rp)
        await db.flush()
        for perm_id in data.permission_ids:
            db.add(RolePermission(role_id=role.id, permission_id=perm_id))
    await db.flush()
    await db.refresh(role)
    return role


# --- User-Organization ---


async def assign_user_to_org(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    role_id: uuid.UUID,
    is_primary: bool = False,
) -> UserOrganization:
    user_org = UserOrganization(
        user_id=user_id,
        org_id=org_id,
        role_id=role_id,
        is_primary=is_primary,
    )
    db.add(user_org)
    await db.flush()
    await db.refresh(user_org)
    return user_org


async def get_user_organizations(
    db: AsyncSession, user_id: uuid.UUID
) -> list[UserOrganization]:
    result = await db.execute(
        select(UserOrganization).where(UserOrganization.user_id == user_id)
    )
    return list(result.scalars().unique().all())


async def get_user_primary_org(
    db: AsyncSession, user_id: uuid.UUID
) -> UserOrganization | None:
    result = await db.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.is_primary.is_(True),
        )
    )
    return result.scalars().first()


# --- Permission Checking ---


async def get_user_permissions(
    db: AsyncSession, user_id: uuid.UUID, org_id: uuid.UUID
) -> list[Permission]:
    result = await db.execute(
        select(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    )
    return list(result.scalars().all())


async def user_has_permission(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    resource: str,
    action: str,
) -> bool:
    perms = await get_user_permissions(db, user_id, org_id)
    return any(p.resource == resource and p.action == action for p in perms)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/rbac/test_service.py -v
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/app/rbac/service.py tests/rbac/test_service.py
git commit -m "feat(rbac): add service layer with org/role CRUD and permission checking"
```

---

## Task 4: Permission Dependencies

**Files:**
- Create: `backend/src/app/rbac/dependencies.py`
- Create: `backend/tests/rbac/test_dependencies.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac/test_dependencies.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/rbac/test_dependencies.py -v
```

Expected: FAIL with `ImportError`

- [ ] **Step 3: Implement the dependencies**

Create `backend/src/app/rbac/dependencies.py`:

```python
"""FastAPI dependencies for RBAC permission checking."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.rbac.service import get_user_primary_org, user_has_permission


async def check_permission(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    resource: str,
    action: str,
) -> None:
    """Raise 403 if the user does not have the required permission in the org."""
    has = await user_has_permission(db, user_id, org_id, resource, action)
    if not has:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: {resource}:{action}",
        )


async def get_current_org_id(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_org_id: Annotated[str | None, Header()] = None,
) -> uuid.UUID:
    """Get the current organization ID from header or user's primary org."""
    if x_org_id is not None:
        return uuid.UUID(x_org_id)
    primary = await get_user_primary_org(db, user.id)
    if primary is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No organization context. Set X-Org-Id header or join an organization.",
        )
    return primary.org_id


CurrentOrgId = Annotated[uuid.UUID, Depends(get_current_org_id)]


def require_permission(resource: str, action: str):
    """Dependency factory that checks if the current user has a permission."""

    async def _checker(
        user: CurrentUser,
        org_id: CurrentOrgId,
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> None:
        await check_permission(db, user.id, org_id, resource, action)

    return Depends(_checker)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/rbac/test_dependencies.py -v
```

Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/app/rbac/dependencies.py tests/rbac/test_dependencies.py
git commit -m "feat(rbac): add permission checking dependencies and org context"
```

---

## Task 5: RBAC Router (Organization + Role API)

**Files:**
- Create: `backend/src/app/rbac/router.py`
- Create: `backend/tests/rbac/test_router.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac/test_router.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_list_organizations_unauthenticated() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/organizations")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_create_organization_endpoint(auth_client: AsyncClient) -> None:
    response = await auth_client.post(
        "/api/organizations",
        json={"name": "New School", "type": "school", "description": "Test school"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "New School"
    assert data["type"] == "school"
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_list_organizations_endpoint(auth_client: AsyncClient) -> None:
    # Create one first
    await auth_client.post(
        "/api/organizations",
        json={"name": "Org X", "type": "enterprise"},
    )
    response = await auth_client.get("/api/organizations")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1


@pytest.mark.asyncio
async def test_list_roles_endpoint(auth_client: AsyncClient) -> None:
    response = await auth_client.get("/api/roles")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_list_permissions_endpoint(auth_client: AsyncClient) -> None:
    response = await auth_client.get("/api/permissions")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
```

Note: `auth_client` is a pytest fixture that provides an authenticated `AsyncClient`. If it does not exist yet, create it in `backend/tests/conftest.py`. The fixture should create a platform_admin user and return a client with the auth token set.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/rbac/test_router.py -v
```

Expected: FAIL (404 because router not registered)

- [ ] **Step 3: Implement the router**

Create `backend/src/app/rbac/router.py`:

```python
"""API routes for organization and role management."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.rbac.models import Permission, Role
from app.rbac.schemas import (
    OrganizationCreate,
    OrganizationResponse,
    OrganizationUpdate,
    PermissionResponse,
    RoleCreate,
    RoleResponse,
    RoleUpdate,
)
from app.rbac.service import (
    create_organization,
    create_role,
    get_organization_by_id,
    get_role_by_id,
    list_organizations,
    list_roles,
    update_organization,
    update_role,
)

org_router = APIRouter()
role_router = APIRouter()
permission_router = APIRouter()


# --- Organization Routes ---


@org_router.get("", response_model=list[OrganizationResponse])
async def list_orgs(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> list[OrganizationResponse]:
    orgs = await list_organizations(db)
    return [OrganizationResponse.model_validate(o) for o in orgs]


@org_router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_org(
    body: OrganizationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> OrganizationResponse:
    org = await create_organization(db, body)
    return OrganizationResponse.model_validate(org)


@org_router.get("/{org_id}", response_model=OrganizationResponse)
async def get_org(
    org_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> OrganizationResponse:
    org = await get_organization_by_id(db, org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return OrganizationResponse.model_validate(org)


@org_router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_org(
    org_id: uuid.UUID,
    body: OrganizationUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> OrganizationResponse:
    org = await get_organization_by_id(db, org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    updated = await update_organization(db, org, body)
    return OrganizationResponse.model_validate(updated)


# --- Role Routes ---


@role_router.get("", response_model=list[RoleResponse])
async def list_all_roles(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
    org_id: uuid.UUID | None = None,
) -> list[RoleResponse]:
    roles = await list_roles(db, org_id=org_id)
    result = []
    for role in roles:
        perms = [
            PermissionResponse.model_validate(rp.permission)
            for rp in role.role_permissions
        ]
        resp = RoleResponse.model_validate(role)
        resp.permissions = perms
        result.append(resp)
    return result


@role_router.post("", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
async def create_new_role(
    body: RoleCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> RoleResponse:
    role = await create_role(db, body)
    perms = [
        PermissionResponse.model_validate(rp.permission)
        for rp in role.role_permissions
    ]
    resp = RoleResponse.model_validate(role)
    resp.permissions = perms
    return resp


@role_router.patch("/{role_id}", response_model=RoleResponse)
async def update_existing_role(
    role_id: uuid.UUID,
    body: RoleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> RoleResponse:
    role = await get_role_by_id(db, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify system roles")
    updated = await update_role(db, role, body)
    perms = [
        PermissionResponse.model_validate(rp.permission)
        for rp in updated.role_permissions
    ]
    resp = RoleResponse.model_validate(updated)
    resp.permissions = perms
    return resp


# --- Permission Routes ---


@permission_router.get("", response_model=list[PermissionResponse])
async def list_permissions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> list[PermissionResponse]:
    result = await db.execute(select(Permission).order_by(Permission.resource, Permission.action))
    perms = result.scalars().all()
    return [PermissionResponse.model_validate(p) for p in perms]
```

- [ ] **Step 4: Register the routers in main.py**

Modify `backend/src/app/main.py` — add these imports and router registrations:

Add to imports:
```python
from app.rbac.router import org_router, permission_router, role_router
```

Add after existing `include_router` calls:
```python
app.include_router(org_router, prefix="/api/organizations", tags=["organizations"])
app.include_router(role_router, prefix="/api/roles", tags=["roles"])
app.include_router(permission_router, prefix="/api/permissions", tags=["permissions"])
```

- [ ] **Step 5: Register RBAC models in Alembic env.py**

Modify `backend/alembic/env.py` — add import:

```python
from app.rbac.models import Organization, Role, Permission  # noqa: F401
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/rbac/test_router.py -v
```

Expected: All 5 tests PASS

- [ ] **Step 7: Commit**

```bash
cd backend && git add src/app/rbac/router.py src/app/main.py alembic/env.py tests/rbac/test_router.py
git commit -m "feat(rbac): add organization, role, permission API routes"
```

---

## Task 6: Seed Data (Default Roles and Permissions)

**Files:**
- Create: `backend/src/app/rbac/seed.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/rbac/test_service.py`:

```python
from app.rbac.seed import seed_permissions, seed_roles, SYSTEM_PERMISSIONS, SYSTEM_ROLES


@pytest.mark.asyncio
async def test_seed_permissions(db: AsyncSession) -> None:
    await seed_permissions(db)
    result = await db.execute(select(Permission))
    perms = result.scalars().all()
    assert len(perms) == len(SYSTEM_PERMISSIONS)


@pytest.mark.asyncio
async def test_seed_roles(db: AsyncSession) -> None:
    await seed_permissions(db)
    await seed_roles(db)
    result = await db.execute(select(Role).where(Role.is_system.is_(True)))
    roles = result.scalars().all()
    assert len(roles) == len(SYSTEM_ROLES)

    # Check platform_admin has all permissions
    admin_role = next(r for r in roles if r.name == "platform_admin")
    assert len(admin_role.role_permissions) == len(SYSTEM_PERMISSIONS)


@pytest.mark.asyncio
async def test_seed_is_idempotent(db: AsyncSession) -> None:
    await seed_permissions(db)
    await seed_roles(db)
    # Run again — should not duplicate
    await seed_permissions(db)
    await seed_roles(db)
    result = await db.execute(select(Permission))
    perms = result.scalars().all()
    assert len(perms) == len(SYSTEM_PERMISSIONS)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/rbac/test_service.py -v -k "seed"
```

Expected: FAIL with `ImportError`

- [ ] **Step 3: Implement the seed module**

Create `backend/src/app/rbac/seed.py`:

```python
"""Seed data for RBAC system: default permissions and roles."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Permission, Role, RolePermission


# resource, action, description
SYSTEM_PERMISSIONS: list[tuple[str, str, str]] = [
    # Exam
    ("exam", "create", "Create exams"),
    ("exam", "read", "View exams"),
    ("exam", "update", "Edit exams"),
    ("exam", "delete", "Delete exams"),
    # Question
    ("question", "create", "Create questions"),
    ("question", "read", "View questions"),
    ("question", "update", "Edit questions"),
    ("question", "delete", "Delete questions"),
    # Job Model
    ("job_model", "create", "Create job models"),
    ("job_model", "read", "View job models"),
    ("job_model", "update", "Edit job models"),
    ("job_model", "delete", "Delete job models"),
    # Course
    ("course", "create", "Create courses"),
    ("course", "read", "View courses"),
    ("course", "update", "Edit courses"),
    ("course", "delete", "Delete courses"),
    # Organization
    ("organization", "create", "Create organizations"),
    ("organization", "read", "View organizations"),
    ("organization", "update", "Edit organizations"),
    ("organization", "delete", "Delete organizations"),
    # User management
    ("user", "create", "Create users"),
    ("user", "read", "View users"),
    ("user", "update", "Edit users"),
    ("user", "delete", "Delete users"),
    # Role management
    ("role", "create", "Create roles"),
    ("role", "read", "View roles"),
    ("role", "update", "Edit roles"),
    ("role", "delete", "Delete roles"),
    # Knowledge
    ("knowledge", "create", "Create knowledge points"),
    ("knowledge", "read", "View knowledge points"),
    ("knowledge", "update", "Edit knowledge points"),
    ("knowledge", "delete", "Delete knowledge points"),
    # Vector KB
    ("vector_kb", "create", "Manage vector knowledge base"),
    ("vector_kb", "read", "View vector knowledge base"),
    ("vector_kb", "update", "Edit vector knowledge base"),
    ("vector_kb", "delete", "Delete vector knowledge base"),
    # Gap Analysis
    ("gap_analysis", "create", "Run gap analysis"),
    ("gap_analysis", "read", "View gap analysis"),
    # Export
    ("export", "create", "Export reports"),
]

# role_name, display_name, description, [list of (resource, action)]
SYSTEM_ROLES: list[tuple[str, str, str, list[tuple[str, str]]]] = [
    (
        "platform_admin",
        "Platform Admin",
        "Full platform access",
        [],  # Gets ALL permissions
    ),
    (
        "enterprise_admin",
        "Enterprise Admin",
        "Manage organization job models and members",
        [
            ("job_model", "create"), ("job_model", "read"), ("job_model", "update"), ("job_model", "delete"),
            ("user", "read"), ("user", "create"), ("user", "update"),
            ("export", "create"),
            ("gap_analysis", "read"),
        ],
    ),
    (
        "enterprise_user",
        "Enterprise User",
        "View and edit job models",
        [
            ("job_model", "read"), ("job_model", "update"),
            ("export", "create"),
        ],
    ),
    (
        "school_admin",
        "School Admin",
        "Manage courses, view job models, run gap analysis",
        [
            ("course", "create"), ("course", "read"), ("course", "update"), ("course", "delete"),
            ("job_model", "read"),
            ("gap_analysis", "create"), ("gap_analysis", "read"),
            ("exam", "create"), ("exam", "read"), ("exam", "update"), ("exam", "delete"),
            ("question", "create"), ("question", "read"), ("question", "update"), ("question", "delete"),
            ("knowledge", "create"), ("knowledge", "read"), ("knowledge", "update"), ("knowledge", "delete"),
            ("user", "read"), ("user", "create"), ("user", "update"),
            ("export", "create"),
        ],
    ),
    (
        "teacher",
        "Teacher",
        "Course mapping, exam management",
        [
            ("course", "read"), ("course", "update"),
            ("job_model", "read"),
            ("gap_analysis", "read"),
            ("exam", "create"), ("exam", "read"), ("exam", "update"),
            ("question", "create"), ("question", "read"), ("question", "update"),
            ("knowledge", "read"),
            ("export", "create"),
        ],
    ),
    (
        "student",
        "Student",
        "Take exams, view learning paths",
        [
            ("exam", "read"),
            ("course", "read"),
            ("knowledge", "read"),
        ],
    ),
]


async def seed_permissions(db: AsyncSession) -> dict[tuple[str, str], Permission]:
    """Create all system permissions if they don't exist. Returns a mapping."""
    perm_map: dict[tuple[str, str], Permission] = {}

    for resource, action, description in SYSTEM_PERMISSIONS:
        result = await db.execute(
            select(Permission).where(
                Permission.resource == resource,
                Permission.action == action,
            )
        )
        perm = result.scalar_one_or_none()
        if perm is None:
            perm = Permission(resource=resource, action=action, description=description)
            db.add(perm)
            await db.flush()
        perm_map[(resource, action)] = perm

    return perm_map


async def seed_roles(db: AsyncSession) -> list[Role]:
    """Create all system roles with their permissions."""
    perm_map = await seed_permissions(db)
    all_perm_ids = [p.id for p in perm_map.values()]
    roles: list[Role] = []

    for role_name, display_name, description, role_perms in SYSTEM_ROLES:
        result = await db.execute(
            select(Role).where(Role.name == role_name, Role.org_id.is_(None))
        )
        role = result.scalar_one_or_none()
        if role is None:
            role = Role(
                name=role_name,
                display_name=display_name,
                description=description,
                is_system=True,
            )
            db.add(role)
            await db.flush()

            # Assign permissions
            if not role_perms:
                # platform_admin gets all
                target_ids = all_perm_ids
            else:
                target_ids = [perm_map[key].id for key in role_perms if key in perm_map]

            for pid in target_ids:
                db.add(RolePermission(role_id=role.id, permission_id=pid))
            await db.flush()
            await db.refresh(role)

        roles.append(role)

    return roles
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/rbac/test_service.py -v -k "seed"
```

Expected: All 3 seed tests PASS

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/app/rbac/seed.py tests/rbac/test_service.py
git commit -m "feat(rbac): add seed data for system permissions and roles"
```

---

## Task 7: Database Migration — Create RBAC Tables

**Files:**
- Create: `backend/alembic/versions/add_rbac_tables.py`

- [ ] **Step 1: Generate the migration**

```bash
cd backend && alembic revision --autogenerate -m "add rbac tables"
```

This should detect the new tables: `organizations`, `roles`, `permissions`, `role_permissions`, `user_organizations`.

- [ ] **Step 2: Review the generated migration**

Open the generated file and verify it contains `create_table` calls for all 5 tables with correct columns, foreign keys, and constraints.

- [ ] **Step 3: Apply the migration**

```bash
cd backend && alembic upgrade head
```

Expected: Migration applies successfully.

- [ ] **Step 4: Verify tables exist**

```bash
cd backend && python -c "
import asyncio
from app.database import engine
from sqlalchemy import inspect

async def check():
    async with engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        for t in ['organizations', 'roles', 'permissions', 'role_permissions', 'user_organizations']:
            assert t in tables, f'Missing table: {t}'
        print('All RBAC tables created successfully')

asyncio.run(check())
"
```

- [ ] **Step 5: Commit**

```bash
cd backend && git add alembic/versions/
git commit -m "chore: add migration for RBAC tables"
```

---

## Task 8: Data Migration — Migrate Existing Users to RBAC

**Files:**
- Create: `backend/alembic/versions/migrate_users_to_rbac.py`

This is a data migration that:
1. Creates a default organization
2. Seeds system permissions and roles
3. Migrates existing users into the default org with matching roles

- [ ] **Step 1: Create the data migration**

```bash
cd backend && alembic revision -m "migrate existing users to rbac"
```

Edit the generated file:

```python
"""migrate existing users to rbac

Revision ID: <auto-generated>
Revises: <previous-revision>
Create Date: <auto-generated>
"""
from typing import Sequence, Union

import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = '<auto-generated>'
down_revision: Union[str, None] = '<previous-revision>'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Role name mapping from old enum to new role names
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

    # 2. Get system roles (should already exist from seed or prior migration)
    roles = conn.execute(
        sa.text("SELECT id, name FROM roles WHERE is_system = true AND org_id IS NULL")
    ).fetchall()
    role_map = {row[1]: row[0] for row in roles}

    # If roles don't exist yet, we need to seed them first
    if not role_map:
        # Seed will be run by the application on startup; skip user migration for now
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
    # Remove all user_organizations entries
    conn.execute(sa.text("DELETE FROM user_organizations"))
    # Remove default org
    conn.execute(
        sa.text("DELETE FROM organizations WHERE name = 'Default Organization'")
    )
```

- [ ] **Step 2: Apply the migration**

```bash
cd backend && alembic upgrade head
```

- [ ] **Step 3: Verify migration**

```bash
cd backend && python -c "
import asyncio
from app.database import async_session
from sqlalchemy import select, text

async def check():
    async with async_session() as db:
        result = await db.execute(text('SELECT COUNT(*) FROM user_organizations'))
        count = result.scalar()
        print(f'User-organization entries: {count}')

        result = await db.execute(text('SELECT COUNT(*) FROM organizations'))
        count = result.scalar()
        print(f'Organizations: {count}')

asyncio.run(check())
"
```

- [ ] **Step 4: Commit**

```bash
cd backend && git add alembic/versions/
git commit -m "chore: data migration - move existing users to RBAC system"
```

---

## Task 9: Update Auth System for RBAC

**Files:**
- Modify: `backend/src/app/auth/dependencies.py`
- Modify: `backend/src/app/auth/security.py`
- Modify: `backend/src/app/auth/schemas.py`
- Modify: `backend/src/app/auth/service.py`
- Modify: `backend/src/app/auth/router.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/rbac/test_router.py`:

```python
@pytest.mark.asyncio
async def test_login_returns_org_and_role(auth_client: AsyncClient) -> None:
    """After RBAC migration, login response should include org and role info."""
    response = await auth_client.get("/api/auth/me")
    assert response.status_code == 200
    data = response.json()
    # Should have organization info
    assert "organizations" in data or "primary_org" in data
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/rbac/test_router.py::test_login_returns_org_and_role -v
```

Expected: FAIL (no org info in response)

- [ ] **Step 3: Update UserResponse schema**

Modify `backend/src/app/auth/schemas.py` — add org info to `UserResponse`:

```python
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: str
    org_id: uuid.UUID | None = None
    role_name: str = "student"


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    is_active: bool | None = None


class UserOrgInfo(BaseModel):
    model_config = {"from_attributes": True}

    org_id: uuid.UUID
    org_name: str
    org_type: str
    role_id: uuid.UUID
    role_name: str
    role_display_name: str
    is_primary: bool


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    username: str
    email: str
    full_name: str
    is_active: bool
    primary_org: UserOrgInfo | None = None
    organizations: list[UserOrgInfo] = []
    created_at: datetime
    updated_at: datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
```

- [ ] **Step 4: Update auth dependencies**

Modify `backend/src/app/auth/dependencies.py`:

```python
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import decode_access_token
from app.database import get_db

security = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = uuid.UUID(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*role_names: str):
    """Legacy compatibility: check if user has any of the given role names in their orgs."""
    async def checker(
        user: CurrentUser,
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> User:
        from app.rbac.models import Role, UserOrganization
        result = await db.execute(
            select(Role.name)
            .join(UserOrganization, UserOrganization.role_id == Role.id)
            .where(UserOrganization.user_id == user.id)
        )
        user_roles = {row[0] for row in result.all()}
        if not user_roles.intersection(set(role_names)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return Depends(checker)
```

- [ ] **Step 5: Update auth service to build UserResponse with org info**

Modify `backend/src/app/auth/service.py`:

```python
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.schemas import UserCreate, UserOrgInfo, UserResponse, UserUpdate
from app.auth.security import hash_password, verify_password
from app.rbac.models import UserOrganization


async def create_user(db: AsyncSession, data: UserCreate) -> User:
    user = User(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    # Assign to organization if specified
    if data.org_id and data.role_name:
        from app.rbac.models import Role
        result = await db.execute(
            select(Role).where(Role.name == data.role_name, Role.deleted_at.is_(None))
        )
        role = result.scalar_one_or_none()
        if role:
            user_org = UserOrganization(
                user_id=user.id,
                org_id=data.org_id,
                role_id=role.id,
                is_primary=True,
            )
            db.add(user_org)
            await db.flush()

    return user


async def authenticate_user(db: AsyncSession, username: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        return None
    return user


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    return result.scalar_one_or_none()


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username, User.deleted_at.is_(None)))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email, User.deleted_at.is_(None)))
    return result.scalar_one_or_none()


async def update_user(db: AsyncSession, user: User, data: UserUpdate) -> User:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)
    await db.flush()
    await db.refresh(user)
    return user


async def build_user_response(db: AsyncSession, user: User) -> UserResponse:
    """Build a UserResponse with organization and role info."""
    from app.rbac.models import Organization, Role

    result = await db.execute(
        select(UserOrganization).where(UserOrganization.user_id == user.id)
    )
    memberships = result.scalars().unique().all()

    org_infos: list[UserOrgInfo] = []
    primary_org: UserOrgInfo | None = None

    for m in memberships:
        info = UserOrgInfo(
            org_id=m.org_id,
            org_name=m.organization.name if m.organization else "",
            org_type=m.organization.type if m.organization else "",
            role_id=m.role_id,
            role_name=m.role.name if m.role else "",
            role_display_name=m.role.display_name if m.role else "",
            is_primary=m.is_primary,
        )
        org_infos.append(info)
        if m.is_primary:
            primary_org = info

    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        primary_org=primary_org,
        organizations=org_infos,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )
```

- [ ] **Step 6: Update auth router to use new response builder**

Modify `backend/src/app/auth/router.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.auth.schemas import LoginRequest, TokenResponse, UserCreate, UserResponse
from app.auth.security import create_access_token
from app.auth.service import (
    authenticate_user,
    build_user_response,
    create_user,
    get_user_by_email,
    get_user_by_username,
)
from app.database import get_db

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(data: UserCreate, db: Annotated[AsyncSession, Depends(get_db)]) -> UserResponse:
    if await get_user_by_username(db, data.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    if await get_user_by_email(db, data.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    user = await create_user(db, data)
    return await build_user_response(db, user)


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]) -> TokenResponse:
    user = await authenticate_user(db, data.username, data.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(user.id, "")
    user_response = await build_user_response(db, user)
    return TokenResponse(access_token=token, user=user_response)


@router.get("/me", response_model=UserResponse)
async def get_me(user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]) -> UserResponse:
    return await build_user_response(db, user)
```

- [ ] **Step 7: Run tests**

```bash
cd backend && python -m pytest tests/ -v --timeout=30
```

Expected: All existing tests PASS, new RBAC tests PASS.

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/app/auth/ src/app/rbac/ tests/
git commit -m "feat(rbac): integrate RBAC into auth system - org info in login/me responses"
```

---

## Task 10: Application Startup Seeding

**Files:**
- Modify: `backend/src/app/main.py`

- [ ] **Step 1: Add startup event to seed RBAC data**

Modify `backend/src/app/main.py` — add a startup event:

```python
@app.on_event("startup")
async def seed_rbac_data() -> None:
    """Seed system permissions and roles on application startup."""
    from app.database import async_session
    from app.rbac.seed import seed_permissions, seed_roles

    async with async_session() as db:
        await seed_permissions(db)
        await seed_roles(db)
        await db.commit()
```

Add this after the health check endpoint.

- [ ] **Step 2: Verify startup seeding works**

```bash
cd backend && python -c "
import asyncio
from app.main import app
from app.database import async_session
from sqlalchemy import text

async def check():
    # Trigger startup
    await seed_rbac_data()
    async with async_session() as db:
        result = await db.execute(text('SELECT COUNT(*) FROM permissions'))
        print(f'Permissions: {result.scalar()}')
        result = await db.execute(text('SELECT COUNT(*) FROM roles WHERE is_system = true'))
        print(f'System roles: {result.scalar()}')

from app.main import seed_rbac_data
asyncio.run(check())
"
```

- [ ] **Step 3: Run full test suite**

```bash
cd backend && python -m pytest tests/ -v --timeout=30
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
cd backend && git add src/app/main.py
git commit -m "feat(rbac): seed permissions and roles on application startup"
```

---

## Task 11: Frontend Types Update

**Files:**
- Create: `frontend/src/types/rbac.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Create RBAC types**

Create `frontend/src/types/rbac.ts`:

```typescript
export type OrgType = "enterprise" | "school";

export interface IOrganization {
  id: string;
  name: string;
  type: OrgType;
  description: string | null;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IPermission {
  id: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface IRole {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
  org_id: string | null;
  permissions: IPermission[];
  created_at: string;
  updated_at: string;
}

export interface IUserOrgInfo {
  org_id: string;
  org_name: string;
  org_type: OrgType;
  role_id: string;
  role_name: string;
  role_display_name: string;
  is_primary: boolean;
}
```

- [ ] **Step 2: Update IUser in index.ts**

Modify `frontend/src/types/index.ts` — update the `IUser` interface:

Remove the `role: UserRole` field from `IUser` and replace with:

```typescript
import type { IUserOrgInfo } from "./rbac";

export interface IUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  is_active: boolean;
  primary_org: IUserOrgInfo | null;
  organizations: IUserOrgInfo[];
  created_at: string;
  updated_at: string;
}
```

Also update `UserRole` type to be derived from role names:

```typescript
export type UserRole = "platform_admin" | "enterprise_admin" | "enterprise_user" | "school_admin" | "teacher" | "student";
```

- [ ] **Step 3: Update references**

Search for any code that uses `user.role` directly (which was a string like `"admin"`, `"teacher"`, `"student"`) and update to use `user.primary_org?.role_name`. Key files to check:

- `frontend/src/App.tsx` — role-based routing (`identity?.role === "student"`)
- `frontend/src/providers/access-control.ts` — if it exists
- `frontend/src/components/student-layout.tsx`

For each, replace `user.role` with `user.primary_org?.role_name` or a helper:

```typescript
// Helper function - add to types/rbac.ts
export function getUserRole(user: IUser): string {
  return user.primary_org?.role_name ?? "student";
}
```

- [ ] **Step 4: Verify frontend builds**

```bash
cd frontend && pnpm build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/types/rbac.ts src/types/index.ts src/App.tsx
git commit -m "feat(rbac): update frontend types for RBAC system"
```

---

## Task 12: Cleanup — Remove Legacy User.role Column

**Files:**
- Modify: `backend/src/app/auth/models.py`
- Create: `backend/alembic/versions/drop_user_role_column.py`

This is the final cleanup step. Only do this after verifying all existing features work with the RBAC system.

- [ ] **Step 1: Remove UserRole enum and role column from User model**

Modify `backend/src/app/auth/models.py`:

```python
from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models import BaseModel


class User(BaseModel):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
```

- [ ] **Step 2: Generate migration to drop the column**

```bash
cd backend && alembic revision --autogenerate -m "drop user role column"
```

Review the generated migration to ensure it only drops the `role` column and the `userrole` enum type.

- [ ] **Step 3: Apply migration**

```bash
cd backend && alembic upgrade head
```

- [ ] **Step 4: Run full test suite**

```bash
cd backend && python -m pytest tests/ -v --timeout=30
```

Expected: All tests PASS.

- [ ] **Step 5: Verify the application runs end-to-end**

```bash
cd backend && uvicorn app.main:app --reload &
sleep 3
curl -s http://localhost:8000/api/health | python -m json.tool
curl -s http://localhost:8000/api/organizations -H "Authorization: Bearer <token>" | python -m json.tool
kill %1
```

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/app/auth/models.py alembic/versions/
git commit -m "chore: remove legacy User.role column, fully migrated to RBAC"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] All RBAC tables exist in database (organizations, roles, permissions, role_permissions, user_organizations)
- [ ] System permissions seeded (check `SELECT COUNT(*) FROM permissions`)
- [ ] System roles seeded with correct permissions (check `SELECT r.name, COUNT(rp.*) FROM roles r JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.name`)
- [ ] Existing users migrated to default organization (check `SELECT COUNT(*) FROM user_organizations`)
- [ ] Login returns org/role info in response
- [ ] `/api/auth/me` returns org/role info
- [ ] `/api/organizations` CRUD works
- [ ] `/api/roles` CRUD works
- [ ] `/api/permissions` list works
- [ ] `require_permission()` dependency blocks unauthorized access
- [ ] Frontend builds without type errors
- [ ] All existing features (exams, questions, knowledge) still work
- [ ] All tests pass: `python -m pytest tests/ -v`

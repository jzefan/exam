"""Business logic for RBAC operations."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password
from app.rbac.models import (
    Class,
    Organization,
    Permission,
    Role,
    RolePermission,
    UserOrganization,
)
from app.rbac.schemas import (
    ClassCreate,
    OrganizationCreate,
    OrganizationUpdate,
    RoleCreate,
    RoleUpdate,
    StudentCreate,
)


# --- Class Management ---


async def create_class(db: AsyncSession, org_id: uuid.UUID, data: ClassCreate) -> Class:
    cls = Class(name=data.name, org_id=org_id)
    db.add(cls)
    await db.flush()
    await db.refresh(cls)
    return cls


async def list_org_classes(db: AsyncSession, org_id: uuid.UUID) -> list[Class]:
    result = await db.execute(
        select(Class).where(Class.org_id == org_id, Class.deleted_at.is_(None)).order_by(Class.name)
    )
    return list(result.scalars().all())


async def delete_class(db: AsyncSession, class_id: uuid.UUID) -> None:
    cls = await db.get(Class, class_id)
    if cls:
        await db.delete(cls)
        await db.flush()


# --- Student Management ---


async def list_org_students(db: AsyncSession, org_id: uuid.UUID, class_id: uuid.UUID | None = None) -> list[User]:
    query = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(
            UserOrganization.org_id == org_id,
            Role.name == "student",
            User.deleted_at.is_(None)
        )
    )
    if class_id:
        query = query.where(User.class_id == class_id)
        
    result = await db.execute(query.order_by(User.full_name))
    return list(result.scalars().all())


async def list_teacher_students(
    db: AsyncSession,
    teacher_id: uuid.UUID,
    class_id: uuid.UUID | None = None,
) -> list[User]:
    query = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(
            User.owner_teacher_id == teacher_id,
            Role.name == "student",
            User.deleted_at.is_(None),
        )
    )
    if class_id:
        query = query.where(User.class_id == class_id)

    result = await db.execute(query.order_by(User.full_name))
    return list(result.scalars().all())


async def create_student(
    db: AsyncSession,
    org_id: uuid.UUID,
    data: StudentCreate,
    owner_teacher_id: uuid.UUID | None = None,
) -> User:
    # Use phone as username and password
    password_hash = hash_password(data.phone)
    
    user = User(
        username=data.phone,
        email=f"{data.phone}@example.com", # Default email
        phone=data.phone,
        student_id=data.student_id,
        class_id=data.class_id,
        owner_teacher_id=owner_teacher_id,
        full_name=data.full_name,
        password_hash=password_hash,
        is_active=True
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    # Find student role
    result = await db.execute(
        select(Role).where(Role.name == "student", Role.org_id.is_(None))
    )
    role = result.scalar_one_or_none()
    if not role:
        raise ValueError("Student role not found in system")

    # Assign to org
    db.add(UserOrganization(
        user_id=user.id,
        org_id=org_id,
        role_id=role.id,
        is_primary=True
    ))
    await db.flush()
    
    return user


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

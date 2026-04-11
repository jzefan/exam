"""Business logic for RBAC operations."""

import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password
from app.rbac.models import (
    Class,
    Organization,
    Permission,
    Role,
    RolePermission,
    TeacherStudent,
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


async def create_class(
    db: AsyncSession,
    org_id: uuid.UUID,
    data: ClassCreate,
    created_by: uuid.UUID | None = None,
) -> Class:
    cls = Class(name=data.name, org_id=org_id, created_by=created_by)
    db.add(cls)
    await db.flush()
    await db.refresh(cls)
    return cls


async def list_org_classes(db: AsyncSession, org_id: uuid.UUID) -> list[Class]:
    result = await db.execute(
        select(Class).where(Class.org_id == org_id, Class.deleted_at.is_(None)).order_by(Class.name)
    )
    return list(result.scalars().all())


async def list_teacher_classes(db: AsyncSession, org_id: uuid.UUID, teacher_id: uuid.UUID) -> list[Class]:
    result = await db.execute(
        select(Class)
        .outerjoin(User, User.class_id == Class.id)
        .outerjoin(TeacherStudent, TeacherStudent.student_id == User.id)
        .outerjoin(UserOrganization, UserOrganization.user_id == User.id)
        .outerjoin(Role, Role.id == UserOrganization.role_id)
        .where(
            Class.org_id == org_id,
            Class.deleted_at.is_(None),
            or_(
                Class.created_by == teacher_id,
                and_(
                    TeacherStudent.teacher_id == teacher_id,
                    Role.name == "student",
                    User.deleted_at.is_(None),
                    User.class_id.is_not(None),
                ),
            ),
        )
        .distinct()
        .order_by(Class.name)
    )
    return list(result.scalars().all())


async def delete_class(
    db: AsyncSession,
    class_id: uuid.UUID,
    allowed_creator_id: uuid.UUID | None = None,
) -> None:
    cls = await db.get(Class, class_id)
    if cls is None:
        return
    if allowed_creator_id is not None and cls.created_by not in {None, allowed_creator_id}:
        raise PermissionError("cannot delete a class created by another teacher")
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
    org_id: uuid.UUID,
    teacher_id: uuid.UUID,
    class_id: uuid.UUID | None = None,
) -> list[User]:
    query = (
        select(User)
        .join(TeacherStudent, TeacherStudent.student_id == User.id)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(
            TeacherStudent.teacher_id == teacher_id,
            UserOrganization.org_id == org_id,
            Role.name == "student",
            User.deleted_at.is_(None),
        )
    )
    if class_id:
        query = query.where(User.class_id == class_id)

    result = await db.execute(query.order_by(User.full_name).distinct())
    return list(result.scalars().all())


async def ensure_teacher_student_link(
    db: AsyncSession,
    teacher_id: uuid.UUID,
    student_id: uuid.UUID,
) -> bool:
    existing = await db.get(
        TeacherStudent,
        {"teacher_id": teacher_id, "student_id": student_id},
    )
    if existing is not None:
        return False

    db.add(TeacherStudent(teacher_id=teacher_id, student_id=student_id))
    await db.flush()
    return True


async def replace_student_teacher_links(
    db: AsyncSession,
    student_id: uuid.UUID,
    teacher_ids: list[uuid.UUID],
) -> None:
    existing_links = (
        await db.execute(
            select(TeacherStudent).where(TeacherStudent.student_id == student_id)
        )
    ).scalars().all()
    existing_teacher_ids = {link.teacher_id for link in existing_links}
    next_teacher_ids = list(dict.fromkeys(teacher_ids))

    for link in existing_links:
        if link.teacher_id not in next_teacher_ids:
            await db.delete(link)

    for teacher_id in next_teacher_ids:
        if teacher_id not in existing_teacher_ids:
            db.add(TeacherStudent(teacher_id=teacher_id, student_id=student_id))

    await db.flush()


async def find_existing_student_by_phone(db: AsyncSession, phone: str) -> User | None:
    result = await db.execute(
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(
            User.phone == phone,
            User.deleted_at.is_(None),
            Role.name == "student",
        )
        .distinct()
    )
    return result.scalar_one_or_none()


async def create_or_link_student(
    db: AsyncSession,
    org_id: uuid.UUID,
    data: StudentCreate,
    teacher_id: uuid.UUID,
) -> tuple[User, bool, bool]:
    existing_student = await find_existing_student_by_phone(db, data.phone)
    if existing_student is None:
        student = await create_student(db, org_id, data, owner_teacher_id=teacher_id)
        return student, True, True

    linked = await ensure_teacher_student_link(db, teacher_id, existing_student.id)
    if existing_student.owner_teacher_id is None:
        existing_student.owner_teacher_id = teacher_id
        await db.flush()
    return existing_student, linked, False


async def list_student_teacher_ids(db: AsyncSession, student_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(
        select(TeacherStudent.teacher_id)
        .where(TeacherStudent.student_id == student_id)
        .order_by(TeacherStudent.created_at)
    )
    return list(result.scalars().all())


async def assign_unowned_students_to_single_teacher(db: AsyncSession) -> int:
    teacher_ids = list(
        (
            await db.execute(
                select(User.id)
                .join(UserOrganization, UserOrganization.user_id == User.id)
                .join(Role, Role.id == UserOrganization.role_id)
                .where(
                    User.deleted_at.is_(None),
                    Role.name == "teacher",
                )
                .distinct()
            )
        ).scalars().all()
    )

    if len(teacher_ids) != 1:
        return 0

    sole_teacher_id = teacher_ids[0]
    unowned_student_count = (
        await db.execute(
            select(func.count(User.id))
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .join(Role, Role.id == UserOrganization.role_id)
            .where(
                User.deleted_at.is_(None),
                Role.name == "student",
                User.owner_teacher_id.is_(None),
            )
        )
    ).scalar_one()

    if unowned_student_count == 0:
        return 0

    students = (
        await db.execute(
            select(User)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .join(Role, Role.id == UserOrganization.role_id)
            .where(
                User.deleted_at.is_(None),
                Role.name == "student",
                User.owner_teacher_id.is_(None),
            )
        )
    ).scalars().all()

    for student in students:
        student.owner_teacher_id = sole_teacher_id
        await ensure_teacher_student_link(db, sole_teacher_id, student.id)

    owned_students = (
        await db.execute(
            select(User)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .join(Role, Role.id == UserOrganization.role_id)
            .where(
                User.deleted_at.is_(None),
                Role.name == "student",
                User.owner_teacher_id == sole_teacher_id,
            )
        )
    ).scalars().all()

    for student in owned_students:
        await ensure_teacher_student_link(db, sole_teacher_id, student.id)

    await db.flush()
    return len(students)


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

    if owner_teacher_id is not None:
        await ensure_teacher_student_link(db, owner_teacher_id, user.id)
    
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

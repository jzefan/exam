import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.schemas import UserCreate, UserOrgInfo, UserResponse, UserUpdate
from app.auth.security import hash_password, verify_password
from app.rbac.models import UserOrganization


async def create_user(db: AsyncSession, data: UserCreate) -> User:
    from app.rbac.models import Organization, Role

    user = User(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    # Determine which roles to assign
    role_names = data.role_names if data.role_names else [data.role_name]

    # Determine org: use provided or default
    org_id = data.org_id
    if not org_id:
        org_result = await db.execute(select(Organization).limit(1))
        org = org_result.scalar_one_or_none()
        if org:
            org_id = org.id

    if org_id:
        for i, role_name in enumerate(role_names):
            result = await db.execute(
                select(Role).where(Role.name == role_name, Role.deleted_at.is_(None))
            )
            role = result.scalar_one_or_none()
            if role:
                db.add(UserOrganization(
                    user_id=user.id,
                    org_id=org_id,
                    role_id=role.id,
                    is_primary=(i == 0),
                ))
        await db.flush()

    return user


async def authenticate_user(db: AsyncSession, username: str, password: str) -> User | None:
    # Try login by username OR phone
    from sqlalchemy import or_
    result = await db.execute(
        select(User).where(
            or_(User.username == username, User.phone == username),
            User.deleted_at.is_(None)
        )
    )
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

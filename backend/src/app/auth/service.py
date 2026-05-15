import uuid
import hashlib
import secrets
from enum import StrEnum
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import PasswordResetToken, User
from app.auth.schemas import UserCreate, UserOrgInfo, UserResponse, UserUpdate
from app.auth.security import hash_password, verify_password
from app.config import settings
from app.rbac.models import TeacherStudent, UserOrganization

OPTIONAL_EMAIL_DOMAIN = "optional.local"


class LoginFailureReason(StrEnum):
    USER_NOT_FOUND = "user_not_found"
    WRONG_PASSWORD = "wrong_password"


def _should_force_student_change_password(role_names: list[str]) -> bool:
    return "student" in role_names


def _build_optional_email(username: str) -> str:
    return f"optional+{username}.{uuid.uuid4().hex[:12]}@{OPTIONAL_EMAIL_DOMAIN}"


def _display_email(email: str) -> str:
    return "" if email.endswith(f"@{OPTIONAL_EMAIL_DOMAIN}") else email


def has_real_email(user: User) -> bool:
    return bool(_display_email(user.email))


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if not domain:
        return email
    if len(local) <= 2:
        masked_local = f"{local[0]}***" if local else "***"
    else:
        masked_local = f"{local[0]}***{local[-1]}"
    return f"{masked_local}@{domain}"


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def build_password_reset_url(token: str) -> str:
    base_url = settings.frontend_base_url.rstrip("/")
    return f"{base_url}/reset-password?{urlencode({'token': token})}"


async def create_password_reset_token(db: AsyncSession, user: User) -> tuple[str, PasswordResetToken]:
    token = secrets.token_urlsafe(32)
    reset_token = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_reset_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_token_expire_minutes),
    )
    db.add(reset_token)
    await db.flush()
    return token, reset_token


async def reset_password_with_token(db: AsyncSession, token: str, password: str) -> bool:
    token_hash = hash_reset_token(token)
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.deleted_at.is_(None),
        )
    )
    reset_token = result.scalar_one_or_none()
    if reset_token is None:
        return False

    expires_at = reset_token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        return False

    user = await get_user_by_id(db, reset_token.user_id)
    if user is None or not user.is_active:
        return False

    user.password_hash = hash_password(password)
    reset_token.used_at = now
    await db.flush()
    return True


async def create_user(db: AsyncSession, data: UserCreate) -> User:
    from app.rbac.models import Organization, Role

    role_names = data.role_names if data.role_names else [data.role_name]
    user = User(
        username=data.username,
        email=data.email or _build_optional_email(data.username),
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        persona=data.persona,
        owner_teacher_id=data.owner_teacher_id,
        must_change_password=_should_force_student_change_password(role_names),
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

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
                    is_primary_role=(i == 0),
                ))
        await db.flush()

    return user


async def force_change_password_for_student(db: AsyncSession, user: User, password: str) -> User:
    if len(password) < 6:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="密码至少需要6位")

    user.password_hash = hash_password(password)
    user.must_change_password = False
    await db.flush()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, username: str, password: str) -> User | None:
    user, _reason = await authenticate_user_with_reason(db, username, password)
    return user


async def authenticate_user_with_reason(
    db: AsyncSession,
    username: str,
    password: str,
) -> tuple[User | None, LoginFailureReason | None]:
    # Try login by username OR phone
    result = await db.execute(
        select(User).where(
            or_(User.username == username, User.phone == username),
            User.deleted_at.is_(None)
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        return None, LoginFailureReason.USER_NOT_FOUND
    if user.user_type == "external_guest":
        return user, None
    if not verify_password(password, user.password_hash):
        return None, LoginFailureReason.WRONG_PASSWORD
    return user, None


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    return result.scalar_one_or_none()


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username, User.deleted_at.is_(None)))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email, User.deleted_at.is_(None)))
    return result.scalar_one_or_none()


async def get_user_by_account(db: AsyncSession, account: str) -> User | None:
    normalized = account.strip()
    if not normalized:
        return None
    result = await db.execute(
        select(User).where(
            or_(
                User.username == normalized,
                User.phone == normalized,
                User.email == normalized,
            ),
            User.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def update_user(db: AsyncSession, user: User, data: UserUpdate) -> User:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)
    await db.flush()
    await db.refresh(user)
    return user


async def build_user_response(
    db: AsyncSession,
    user: User,
    *,
    include_relationship_metadata: bool = True,
) -> UserResponse:
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

    primary_role_name = primary_org.role_name if primary_org else ""
    if primary_role_name == "platform_admin":
        system_domain = "platform"
    elif primary_role_name in {"teacher", "student", "evaluator", "assessee"} or (
        not primary_role_name and user.persona in {"teacher", "assessor"}
    ):
        system_domain = "exam"
    else:
        system_domain = "job_model"

    teacher_ids: list[uuid.UUID] = []
    teacher_names: list[str] = []
    owner_teacher_id = user.owner_teacher_id
    owner_teacher_name = None
    if include_relationship_metadata:
        teacher_rows = (
            await db.execute(
                select(User.id, User.full_name)
                .join(TeacherStudent, TeacherStudent.teacher_id == User.id)
                .where(TeacherStudent.student_id == user.id, User.deleted_at.is_(None))
                .order_by(TeacherStudent.created_at, User.full_name)
            )
        ).all()
        teacher_ids = [row[0] for row in teacher_rows]
        teacher_names = [row[1] for row in teacher_rows]
        owner_teacher_id = teacher_ids[0] if teacher_ids else user.owner_teacher_id
        owner_teacher_name = teacher_names[0] if teacher_names else None

    managed_student_count = 0
    if include_relationship_metadata and primary_role_name in {"teacher", "evaluator"}:
        managed_student_count = (
            await db.execute(
                select(func.count(TeacherStudent.student_id.distinct())).where(
                    TeacherStudent.teacher_id == user.id,
                )
            )
        ).scalar_one()

    return UserResponse(
        id=user.id,
        username=user.username,
        email=_display_email(user.email),
        full_name=user.full_name,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        persona=user.persona,
        primary_org=primary_org,
        organizations=org_infos,
        system_domain=system_domain,
        owner_teacher_id=owner_teacher_id,
        owner_teacher_name=owner_teacher_name,
        teacher_ids=teacher_ids,
        teacher_names=teacher_names,
        managed_student_count=managed_student_count,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )

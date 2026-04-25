import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.capabilities import user_has_capability
from app.auth.models import User
from app.auth.security import hash_password
from app.rbac.models import Organization, Role
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user


async def _make_user(db: AsyncSession, username: str) -> User:
    user = User(
        username=username,
        email=f"{username}@x.com",
        password_hash=hash_password("x"),
        full_name=username,
    )
    db.add(user)
    await db.flush()
    return user


async def _role(db: AsyncSession, name: str) -> Role:
    return (
        await db.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    ).scalar_one()


@pytest.mark.asyncio
async def test_evaluator_has_exam_create(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "cap-alice")
    org = Organization(name="Capability School A", type="school", is_active=True)
    db_session.add(org)
    await db_session.flush()
    role = await _role(db_session, "evaluator")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, role.id, is_primary=True)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "exam.create") is True


@pytest.mark.asyncio
async def test_teacher_alias_also_has_exam_create(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "cap-bob")
    org = Organization(name="Capability School B", type="school", is_active=True)
    db_session.add(org)
    await db_session.flush()
    role = await _role(db_session, "teacher")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, role.id, is_primary=True)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "exam.create") is True


@pytest.mark.asyncio
async def test_assessee_lacks_exam_create(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "cap-carol")
    org = Organization(name="Capability School C", type="school", is_active=True)
    db_session.add(org)
    await db_session.flush()
    role = await _role(db_session, "assessee")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, role.id, is_primary=True)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "exam.create") is False


@pytest.mark.asyncio
async def test_multi_role_capability_union(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "cap-dan")
    org = Organization(name="Capability Enterprise", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()
    eval_role = await _role(db_session, "evaluator")
    admin_role = await _role(db_session, "enterprise_admin")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, eval_role.id, is_primary=True)
    await add_role_to_user(db_session, user.id, org.id, admin_role.id, is_primary=False)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "exam.create") is True
    assert await user_has_capability(db_session, user.id, "user.create") is True


@pytest.mark.asyncio
async def test_unknown_capability_returns_false(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "cap-ed")
    org = Organization(name="Capability School D", type="school", is_active=True)
    db_session.add(org)
    await db_session.flush()
    role = await _role(db_session, "evaluator")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, role.id, is_primary=True)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "warp.drive") is False

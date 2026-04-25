import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user, list_user_roles, remove_role_from_user


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


async def _get_role(db: AsyncSession, name: str) -> Role:
    return (
        await db.execute(select(Role).where(Role.name == name, Role.org_id.is_(None)))
    ).scalar_one()


@pytest.mark.asyncio
async def test_attach_two_roles_in_same_org(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "alice")
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()
    eval_role = await _get_role(db_session, "evaluator")
    admin_role = await _get_role(db_session, "enterprise_admin")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, eval_role.id, is_primary=True)
    await add_role_to_user(db_session, user.id, org.id, admin_role.id, is_primary=False)
    await db_session.commit()

    rows = await list_user_roles(db_session, user.id, org.id)
    role_names = {role.name for role in rows}
    assert role_names == {"evaluator", "enterprise_admin"}


@pytest.mark.asyncio
async def test_only_one_primary_role_per_user_org(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "bob")
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()
    eval_role = await _get_role(db_session, "evaluator")
    admin_role = await _get_role(db_session, "enterprise_admin")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, eval_role.id, is_primary=True)
    await add_role_to_user(db_session, user.id, org.id, admin_role.id, is_primary=True)
    await db_session.commit()

    primaries = (
        await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == user.id,
                UserOrganization.org_id == org.id,
                UserOrganization.is_primary_role.is_(True),
            )
        )
    ).scalars().all()
    assert len(primaries) == 1
    assert primaries[0].role_id == admin_role.id


@pytest.mark.asyncio
async def test_remove_role(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "carol")
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()
    eval_role = await _get_role(db_session, "evaluator")
    admin_role = await _get_role(db_session, "enterprise_admin")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, eval_role.id, is_primary=True)
    await add_role_to_user(db_session, user.id, org.id, admin_role.id, is_primary=False)
    await db_session.commit()

    await remove_role_from_user(db_session, user.id, org.id, eval_role.id)
    await db_session.commit()

    rows = await list_user_roles(db_session, user.id, org.id)
    assert {role.name for role in rows} == {"enterprise_admin"}

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Permission, Role, RolePermission
from app.rbac.seed import seed_roles


async def _role_permissions(db_session: AsyncSession, role_name: str) -> set[tuple[str, str]]:
    role = (
        await db_session.execute(
            select(Role).where(Role.name == role_name, Role.org_id.is_(None))
        )
    ).scalar_one()
    rps = (
        await db_session.execute(
            select(RolePermission).where(RolePermission.role_id == role.id)
        )
    ).scalars().all()
    out = set()
    for rp in rps:
        permission = (
            await db_session.execute(
                select(Permission).where(Permission.id == rp.permission_id)
            )
        ).scalar_one()
        out.add((permission.resource, permission.action))
    return out


@pytest.mark.asyncio
async def test_seed_creates_evaluator_and_assessee_roles(db_session: AsyncSession):
    await seed_roles(db_session)
    await db_session.commit()

    result = await db_session.execute(select(Role.name).where(Role.is_system.is_(True)))
    role_names = {row[0] for row in result.all()}
    assert "evaluator" in role_names
    assert "assessee" in role_names


@pytest.mark.asyncio
async def test_seed_evaluator_matches_teacher_permissions(db_session: AsyncSession):
    await seed_roles(db_session)
    await db_session.commit()

    assert await _role_permissions(db_session, "evaluator") == await _role_permissions(
        db_session, "teacher"
    )
    assert await _role_permissions(db_session, "assessee") == await _role_permissions(
        db_session, "student"
    )


@pytest.mark.asyncio
async def test_seed_enterprise_admin_has_exam_permissions(db_session: AsyncSession):
    await seed_roles(db_session)
    await db_session.commit()

    permissions = await _role_permissions(db_session, "enterprise_admin")
    assert ("exam", "create") in permissions
    assert ("question", "create") in permissions
    assert ("knowledge", "read") in permissions


@pytest.mark.asyncio
async def test_seed_is_idempotent(db_session: AsyncSession):
    await seed_roles(db_session)
    await db_session.commit()
    role_count_first = (await db_session.execute(select(Role))).scalars().all()

    await seed_roles(db_session)
    await db_session.commit()
    role_count_second = (await db_session.execute(select(Role))).scalars().all()

    assert len(role_count_first) == len(role_count_second)

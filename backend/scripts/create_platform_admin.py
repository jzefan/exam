"""Create or update a platform admin user."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from sqlalchemy import select

from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.security import hash_password
from app.auth.service import create_user
from app.database import async_session, engine
from app.models import Base
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.seed import seed_permissions, seed_roles


async def ensure_default_org() -> Organization:
    async with async_session() as db:
        org = (await db.execute(select(Organization).order_by(Organization.created_at))).scalar_one_or_none()
        if org is None:
            org = Organization(
                name="Default Organization",
                type="school",
                description="Auto-created for local development bootstrap.",
                is_active=True,
            )
            db.add(org)
            await db.flush()
        await db.commit()
        await db.refresh(org)
        return org


async def upsert_platform_admin(username: str, password: str, full_name: str) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    org = await ensure_default_org()

    async with async_session() as db:
        await seed_permissions(db)
        await seed_roles(db)
        await db.flush()

        role = (
            await db.execute(
                select(Role).where(Role.name == "platform_admin", Role.org_id.is_(None))
            )
        ).scalar_one()

        user = (
            await db.execute(
                select(User).where(User.username == username, User.deleted_at.is_(None))
            )
        ).scalar_one_or_none()

        if user is None:
            user = await create_user(
                db,
                UserCreate(
                    username=username,
                    password=password,
                    full_name=full_name,
                    role_name="platform_admin",
                    org_id=org.id,
                ),
            )
            action = "created"
        else:
            user.password_hash = hash_password(password)
            user.full_name = full_name
            user.is_active = True
            user.persona = "teacher"
            action = "updated"

        assignment = (
            await db.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == user.id,
                    UserOrganization.role_id == role.id,
                    UserOrganization.org_id == org.id,
                )
            )
        ).scalar_one_or_none()

        if assignment is None:
            existing_primary = (
                await db.execute(
                    select(UserOrganization).where(
                        UserOrganization.user_id == user.id,
                        UserOrganization.is_primary.is_(True),
                    )
                )
            ).scalar_one_or_none()
            if existing_primary is not None:
                existing_primary.role_id = role.id
                existing_primary.org_id = org.id
                existing_primary.is_primary_role = True
            else:
                db.add(
                    UserOrganization(
                        user_id=user.id,
                        org_id=org.id,
                        role_id=role.id,
                        is_primary=True,
                        is_primary_role=True,
                    )
                )

        await db.commit()
        print(f"{action}: username={username} role=platform_admin org={org.name}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create or update a platform admin user.")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--full-name", default="Platform Admin")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(upsert_platform_admin(args.username, args.password, args.full_name))

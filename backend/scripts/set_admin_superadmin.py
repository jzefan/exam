"""Set admin user to platform_admin role with all permissions."""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db, async_session
from app.rbac.models import Permission, Role, UserOrganization, Organization, RolePermission
from app.auth.models import User


async def set_admin_superadmin():
    """Set the admin user to platform_admin role."""
    async for db in get_db():
        try:
            # 1. Find admin user
            result = await db.execute(
                select(User).where(
                    (User.email == "admin@example.com") |
                    (User.email == "admin") |
                    (User.username == "admin")
                )
            )
            admin_user = result.scalar_one_or_none()

            if not admin_user:
                print("Admin user not found. Trying to list available users...")
                result = await db.execute(select(User).limit(10))
                users = result.scalars().all()
                print(f"Available users: {[(u.id, u.email, getattr(u, 'username', 'N/A')) for u in users]}")
                sys.exit(1)

            print(f"Found admin user: {admin_user.id} ({admin_user.email})")

            # 2. Find platform_admin role
            result = await db.execute(
                select(Role).where(Role.name == "platform_admin")
            )
            platform_admin_role = result.scalar_one_or_none()

            if not platform_admin_role:
                print("ERROR: platform_admin role not found in database!")
                print("Please run the seed script first or restart the application.")
                sys.exit(1)

            print(f"Found platform_admin role: {platform_admin_role.id}")

            # 3. Find default organization
            result = await db.execute(
                select(Organization).limit(1)
            )
            org = result.scalar_one_or_none()

            if not org:
                print("ERROR: No organization found in database!")
                sys.exit(1)

            print(f"Using organization: {org.id} ({org.name})")

            # 4. Check if user already has a role assignment
            result = await db.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == admin_user.id
                )
            )
            existing = result.scalar_one_or_none()

            if existing:
                print(f"Updating existing role assignment from {existing.role_id} to {platform_admin_role.id}")
                existing.role_id = platform_admin_role.id
                existing.org_id = org.id
                existing.is_primary = True
            else:
                print("Creating new role assignment")
                new_assignment = UserOrganization(
                    user_id=admin_user.id,
                    org_id=org.id,
                    role_id=platform_admin_role.id,
                    is_primary=True
                )
                db.add(new_assignment)

            await db.commit()

            # 5. Verify the change
            result = await db.execute(
                select(UserOrganization).where(UserOrganization.user_id == admin_user.id)
            )
            assignment = result.scalar_one_or_none()

            if assignment:
                print(f"\nSuccess! Admin user is now assigned to role: {assignment.role_id}")
                print(f"Organization: {assignment.org_id}")
                print(f"Role name: {platform_admin_role.name}")
                print(f"Display name: {platform_admin_role.display_name}")

                # Count permissions
                result = await db.execute(
                    select(Permission)
                    .join(RolePermission)
                    .where(RolePermission.role_id == platform_admin_role.id)
                )
                perms = result.scalars().all()
                print(f"Total permissions: {len(perms)}")
            else:
                print("ERROR: Failed to assign role")
                sys.exit(1)

            break
        except Exception as e:
            print(f"ERROR: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(set_admin_superadmin())

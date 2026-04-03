"""Seed data for RBAC system: default permissions and roles."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Permission, Role, RolePermission


# resource, action, description
SYSTEM_PERMISSIONS: list[tuple[str, str, str]] = [
    ("exam", "create", "Create exams"),
    ("exam", "read", "View exams"),
    ("exam", "update", "Edit exams"),
    ("exam", "delete", "Delete exams"),
    ("question", "create", "Create questions"),
    ("question", "read", "View questions"),
    ("question", "update", "Edit questions"),
    ("question", "delete", "Delete questions"),
    ("job_model", "create", "Create job models"),
    ("job_model", "read", "View job models"),
    ("job_model", "update", "Edit job models"),
    ("job_model", "delete", "Delete job models"),
    ("course", "create", "Create courses"),
    ("course", "read", "View courses"),
    ("course", "update", "Edit courses"),
    ("course", "delete", "Delete courses"),
    ("organization", "create", "Create organizations"),
    ("organization", "read", "View organizations"),
    ("organization", "update", "Edit organizations"),
    ("organization", "delete", "Delete organizations"),
    ("user", "create", "Create users"),
    ("user", "read", "View users"),
    ("user", "update", "Edit users"),
    ("user", "delete", "Delete users"),
    ("role", "create", "Create roles"),
    ("role", "read", "View roles"),
    ("role", "update", "Edit roles"),
    ("role", "delete", "Delete roles"),
    ("knowledge", "create", "Create knowledge points"),
    ("knowledge", "read", "View knowledge points"),
    ("knowledge", "update", "Edit knowledge points"),
    ("knowledge", "delete", "Delete knowledge points"),
    ("vector_kb", "create", "Manage vector knowledge base"),
    ("vector_kb", "read", "View vector knowledge base"),
    ("vector_kb", "update", "Edit vector knowledge base"),
    ("vector_kb", "delete", "Delete vector knowledge base"),
    ("gap_analysis", "create", "Run gap analysis"),
    ("gap_analysis", "read", "View gap analysis"),
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

            if not role_perms:
                target_ids = all_perm_ids
            else:
                target_ids = [perm_map[key].id for key in role_perms if key in perm_map]

            for pid in target_ids:
                db.add(RolePermission(role_id=role.id, permission_id=pid))
            await db.flush()
            await db.refresh(role)

        roles.append(role)

    return roles

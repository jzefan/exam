# Multi-Persona Roles & External Candidate Invitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abstract business roles `evaluator`/`assessee` so the same exam workflow serves teachers/students AND enterprise HR/candidates, plus add an external-candidate invitation flow (link + one-time token) for enterprise recruitment exams.

**Architecture:** Five sequential PRs build incrementally. PR-1+2 land the RBAC refactor (multi-role + role aliases) without changing user-visible behavior. PR-3 adds the data model and backend API for invitations. PR-4+5 add the frontend (HR import flow + standalone candidate landing page). Existing teacher/student flows must keep zero regression throughout.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async) + Alembic + pytest backend; React + Vite + TanStack Query + Vitest + Playwright frontend.

**Reference spec:** [docs/superpowers/specs/2026-04-25-multi-persona-roles-design.md](docs/superpowers/specs/2026-04-25-multi-persona-roles-design.md)

---

## File Structure

### Backend (created)

| File | Responsibility |
|---|---|
| `backend/alembic/versions/20260425_user_org_multi_role.py` | Migration: UserOrganization composite PK + is_primary_role |
| `backend/alembic/versions/20260426_user_type_external_guest.py` | Migration: User.user_type, User.primary_org_id, conditional unique idx |
| `backend/alembic/versions/20260426_exam_invitations.py` | Migration: exam_invitations table |
| `backend/src/app/auth/capabilities.py` | `user_has_capability` + `require_capability` dependency |
| `backend/src/app/exams/invitation_models.py` | `ExamInvitation` ORM model |
| `backend/src/app/exams/invitation_schemas.py` | Pydantic schemas |
| `backend/src/app/exams/invitation_service.py` | Token gen, redeem, revoke, candidate user provisioning |
| `backend/src/app/exams/invitation_router.py` | `/exams/{id}/invitations*` endpoints + `/exam-invite/redeem` |
| `backend/src/app/auth/invitation_security.py` | Short-lived `exam_take` JWT issuer + decoder |
| `backend/src/app/auth/external_guest_dependencies.py` | `require_internal_or_invitation` middleware |
| `backend/tests/auth/test_capabilities.py` | Capability tests |
| `backend/tests/rbac/test_user_org_multi_role.py` | Multi-role tests |
| `backend/tests/rbac/test_seed_idempotent.py` | Seed idempotency + alias parity |
| `backend/tests/exams/test_invitation_service.py` | Invitation service tests |
| `backend/tests/exams/test_invitation_router.py` | API tests |
| `backend/tests/exams/test_external_guest_access.py` | Access guard tests |
| `backend/tests/integration/test_recruitment_flow.py` | End-to-end happy path |

### Backend (modified)

| File | Why |
|---|---|
| `backend/src/app/rbac/models.py` | UserOrganization composite PK + is_primary_role |
| `backend/src/app/rbac/seed.py` | Add evaluator/assessee roles + extend enterprise_admin |
| `backend/src/app/auth/models.py` | User.user_type, User.primary_org_id |
| `backend/src/app/auth/dependencies.py` | Re-export capability helpers, keep legacy compat |
| `backend/src/app/auth/router.py` (login) | Reject external_guest from password login |
| `backend/src/app/exams/router.py:75-81,712-714` | Replace `_is_exam_admin`/`_is_student_user` with role+alias checks |
| `backend/src/app/exams/positions_router.py:50,80` | Allow enterprise_admin to create system positions |
| `backend/src/app/grading/router.py:47` | Replace hardcoded role list |
| `backend/src/app/learning/router.py:33,37` | Replace hardcoded role list |
| `backend/src/app/analytics/router.py:50` | Replace hardcoded role list |
| `backend/src/app/rbac/students_router.py:33` | Replace hardcoded role list |
| `backend/src/app/main.py` | Mount invitation router |

### Frontend (created)

| File | Responsibility |
|---|---|
| `frontend/src/lib/role-display.ts` | OrgKind-aware role label resolver |
| `frontend/src/lib/role-display.test.ts` | Vitest |
| `frontend/src/lib/capabilities.ts` | Client-side capability resolver |
| `frontend/src/components/RequireCapability.tsx` | Route guard |
| `frontend/src/pages/exams/components/ExternalCandidateImport.tsx` | Tab content for HR import |
| `frontend/src/pages/exams/components/ExternalCandidateImport.test.tsx` | Vitest |
| `frontend/src/pages/exams/components/InvitationManagement.tsx` | Invitation tab on exam detail |
| `frontend/src/pages/exam-invite/landing.tsx` | Candidate landing page |
| `frontend/src/pages/exam-invite/take.tsx` | Wraps existing exam-taking with guest auth |
| `frontend/src/pages/exam-invite/done.tsx` | Post-submit thank-you page |
| `frontend/e2e/recruitment-flow.spec.ts` | Playwright HR flow |
| `frontend/e2e/candidate-flow.spec.ts` | Playwright candidate flow |
| `frontend/e2e/regression-school.spec.ts` | Existing teacher/student smoke |

### Frontend (modified)

| File | Why |
|---|---|
| `frontend/src/App.tsx` | Mount `/exam-invite/*` routes; bypass app shell for guest |
| `frontend/src/utils/role-routing.ts` | Add EVALUATOR/ASSESSEE constants and aliases |
| `frontend/src/pages/exams/students.tsx` | Wrap existing UI in Tab; add "External Candidates" tab when org=enterprise |
| `frontend/src/pages/exams/view.tsx` | Add "Invitations" tab when org=enterprise |
| `frontend/src/pages/gwmx/workbench.tsx` | Add "招聘考试" entry card |
| `frontend/src/components/student-layout.tsx` | Hide layout when external_guest |

---

## PR-1: RBAC Foundation (Multi-Role + New System Roles)

**Goal:** Allow a user to hold multiple roles in the same org; introduce `evaluator`/`assessee` system roles; extend `enterprise_admin` permissions. No behavior change for existing users.

### Task 1.1: Add `is_primary_role` column to UserOrganization

**Files:**
- Modify: `backend/src/app/rbac/models.py:95-110`

- [ ] **Step 1: Add the column to the ORM model**

Edit `backend/src/app/rbac/models.py` — within `UserOrganization` class, add after `is_primary` line:

```python
class UserOrganization(Base, TimestampMixin):
    __tablename__ = "user_organizations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("roles.id", ondelete="RESTRICT"), primary_key=True
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_primary_role: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    organization: Mapped[Organization] = relationship("Organization", lazy="joined")
    role: Mapped[Role] = relationship("Role", lazy="joined")
```

Note: `role_id` moves up into the primary key — was previously a single `mapped_column` not in PK.

- [ ] **Step 2: Commit**

```bash
git add backend/src/app/rbac/models.py
git commit -m "feat(rbac): make UserOrganization role composite key + is_primary_role"
```

---

### Task 1.2: Write the alembic migration for multi-role PK

**Files:**
- Create: `backend/alembic/versions/20260425_user_org_multi_role.py`

- [ ] **Step 1: Create the migration file**

```python
"""user_organizations multi-role primary key

Revision ID: 20260425_user_org_multi_role
Revises: 20260423_add_learning_structure_ownership
Create Date: 2026-04-25
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260425_user_org_multi_role"
down_revision: Union[str, None] = "20260423_add_learning_structure_ownership"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add is_primary_role with default true for all existing rows.
    op.add_column(
        "user_organizations",
        sa.Column(
            "is_primary_role",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    # Drop the existing PK and recreate with role_id included.
    with op.batch_alter_table("user_organizations") as batch_op:
        batch_op.drop_constraint("pk_user_organizations", type_="primary")
        batch_op.create_primary_key(
            "pk_user_organizations",
            ["user_id", "org_id", "role_id"],
        )


def downgrade() -> None:
    # Reduce to one row per (user, org): keep is_primary_role=true rows.
    op.execute(
        """
        DELETE FROM user_organizations
        WHERE is_primary_role = false
        """
    )
    with op.batch_alter_table("user_organizations") as batch_op:
        batch_op.drop_constraint("pk_user_organizations", type_="primary")
        batch_op.create_primary_key(
            "pk_user_organizations",
            ["user_id", "org_id"],
        )
    op.drop_column("user_organizations", "is_primary_role")
```

- [ ] **Step 2: Run migration on a test sqlite DB**

```bash
cd backend && uv run alembic upgrade head
```

Expected: no error, head moves to `20260425_user_org_multi_role`.

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/20260425_user_org_multi_role.py
git commit -m "feat(rbac): migrate user_organizations to composite role PK"
```

---

### Task 1.3: Add evaluator/assessee roles + extend enterprise_admin in seed

**Files:**
- Modify: `backend/src/app/rbac/seed.py`
- Test: `backend/tests/rbac/test_seed_idempotent.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac/test_seed_idempotent.py`:

```python
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Permission, Role, RolePermission
from app.rbac.seed import seed_roles


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

    async def perms(role_name: str) -> set[tuple[str, str]]:
        role = (await db_session.execute(
            select(Role).where(Role.name == role_name, Role.org_id.is_(None))
        )).scalar_one()
        rps = (await db_session.execute(
            select(RolePermission).where(RolePermission.role_id == role.id)
        )).scalars().all()
        out = set()
        for rp in rps:
            p = (await db_session.execute(
                select(Permission).where(Permission.id == rp.permission_id)
            )).scalar_one()
            out.add((p.resource, p.action))
        return out

    assert await perms("evaluator") == await perms("teacher")
    assert await perms("assessee") == await perms("student")


@pytest.mark.asyncio
async def test_seed_enterprise_admin_has_exam_permissions(db_session: AsyncSession):
    await seed_roles(db_session)
    await db_session.commit()

    role = (await db_session.execute(
        select(Role).where(Role.name == "enterprise_admin", Role.org_id.is_(None))
    )).scalar_one()
    rps = (await db_session.execute(
        select(RolePermission).where(RolePermission.role_id == role.id)
    )).scalars().all()
    perms = set()
    for rp in rps:
        p = (await db_session.execute(
            select(Permission).where(Permission.id == rp.permission_id)
        )).scalar_one()
        perms.add((p.resource, p.action))

    assert ("exam", "create") in perms
    assert ("question", "create") in perms
    assert ("knowledge", "read") in perms


@pytest.mark.asyncio
async def test_seed_is_idempotent(db_session: AsyncSession):
    await seed_roles(db_session)
    await db_session.commit()
    role_count_first = (await db_session.execute(select(Role))).scalars().all()

    await seed_roles(db_session)
    await db_session.commit()
    role_count_second = (await db_session.execute(select(Role))).scalars().all()

    assert len(role_count_first) == len(role_count_second)
```

- [ ] **Step 2: Run the test, expect failure**

```bash
cd backend && uv run pytest tests/rbac/test_seed_idempotent.py -v
```

Expected: FAIL — "evaluator" / "assessee" roles missing, enterprise_admin missing exam permissions.

- [ ] **Step 3: Modify seed.py to add the new roles + permissions**

Edit `backend/src/app/rbac/seed.py`. Replace the `enterprise_admin` entry in `SYSTEM_ROLES` and add `evaluator`/`assessee` entries:

```python
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
        "Manage organization job models, members, and recruitment exams",
        [
            ("job_model", "create"), ("job_model", "read"), ("job_model", "update"), ("job_model", "delete"),
            ("user", "read"), ("user", "create"), ("user", "update"),
            ("export", "create"),
            ("gap_analysis", "read"),
            ("exam", "create"), ("exam", "read"), ("exam", "update"), ("exam", "delete"),
            ("question", "create"), ("question", "read"), ("question", "update"), ("question", "delete"),
            ("knowledge", "read"),
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
        "evaluator",
        "Evaluator",
        "Generic role for exam authors (alias of teacher across orgs)",
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
    (
        "assessee",
        "Assessee",
        "Generic role for exam takers (alias of student across orgs)",
        [
            ("exam", "read"),
            ("course", "read"),
            ("knowledge", "read"),
        ],
    ),
]
```

- [ ] **Step 4: Run the tests, expect pass**

```bash
cd backend && uv run pytest tests/rbac/test_seed_idempotent.py -v
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/rbac/seed.py backend/tests/rbac/test_seed_idempotent.py
git commit -m "feat(rbac): add evaluator/assessee system roles, extend enterprise_admin"
```

---

### Task 1.4: Multi-role attach service + tests

**Files:**
- Modify: `backend/src/app/rbac/service.py`
- Test: `backend/tests/rbac/test_user_org_multi_role.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rbac/test_user_org_multi_role.py`:

```python
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user, list_user_roles, remove_role_from_user


async def _make_user(db: AsyncSession, username: str) -> User:
    u = User(username=username, email=f"{username}@x.com",
             password_hash=hash_password("x"), full_name=username)
    db.add(u)
    await db.flush()
    return u


async def _get_role(db: AsyncSession, name: str) -> Role:
    return (await db.execute(
        select(Role).where(Role.name == name, Role.org_id.is_(None))
    )).scalar_one()


@pytest.mark.asyncio
async def test_attach_two_roles_in_same_org(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "alice")
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db_session.add(org); await db_session.flush()
    eval_role = await _get_role(db_session, "evaluator")
    admin_role = await _get_role(db_session, "enterprise_admin")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, eval_role.id, is_primary=True)
    await add_role_to_user(db_session, user.id, org.id, admin_role.id, is_primary=False)
    await db_session.commit()

    rows = await list_user_roles(db_session, user.id, org.id)
    role_names = {r.name for r in rows}
    assert role_names == {"evaluator", "enterprise_admin"}


@pytest.mark.asyncio
async def test_only_one_primary_role_per_user_org(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "bob")
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db_session.add(org); await db_session.flush()
    eval_role = await _get_role(db_session, "evaluator")
    admin_role = await _get_role(db_session, "enterprise_admin")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, eval_role.id, is_primary=True)
    await add_role_to_user(db_session, user.id, org.id, admin_role.id, is_primary=True)
    await db_session.commit()

    primaries = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user.id,
            UserOrganization.org_id == org.id,
            UserOrganization.is_primary_role.is_(True),
        )
    )).scalars().all()
    assert len(primaries) == 1
    assert primaries[0].role_id == admin_role.id


@pytest.mark.asyncio
async def test_remove_role(db_session: AsyncSession):
    await seed_roles(db_session)
    user = await _make_user(db_session, "carol")
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db_session.add(org); await db_session.flush()
    eval_role = await _get_role(db_session, "evaluator")
    admin_role = await _get_role(db_session, "enterprise_admin")
    await db_session.commit()

    await add_role_to_user(db_session, user.id, org.id, eval_role.id, is_primary=True)
    await add_role_to_user(db_session, user.id, org.id, admin_role.id, is_primary=False)
    await db_session.commit()

    await remove_role_from_user(db_session, user.id, org.id, eval_role.id)
    await db_session.commit()

    rows = await list_user_roles(db_session, user.id, org.id)
    assert {r.name for r in rows} == {"enterprise_admin"}
```

- [ ] **Step 2: Run, expect failure**

```bash
cd backend && uv run pytest tests/rbac/test_user_org_multi_role.py -v
```

Expected: FAIL — service helpers don't exist.

- [ ] **Step 3: Implement service helpers**

Append to `backend/src/app/rbac/service.py`:

```python
import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Role, UserOrganization


async def add_role_to_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    role_id: uuid.UUID,
    *,
    is_primary: bool = False,
) -> UserOrganization:
    existing = (await db.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
            UserOrganization.role_id == role_id,
        )
    )).scalar_one_or_none()

    if is_primary:
        await db.execute(
            update(UserOrganization)
            .where(
                UserOrganization.user_id == user_id,
                UserOrganization.org_id == org_id,
            )
            .values(is_primary_role=False)
        )

    if existing is None:
        link = UserOrganization(
            user_id=user_id, org_id=org_id, role_id=role_id,
            is_primary=False, is_primary_role=is_primary,
        )
        db.add(link)
        await db.flush()
        return link

    if is_primary:
        existing.is_primary_role = True
        await db.flush()
    return existing


async def remove_role_from_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    role_id: uuid.UUID,
) -> None:
    await db.execute(
        delete(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
            UserOrganization.role_id == role_id,
        )
    )


async def list_user_roles(
    db: AsyncSession, user_id: uuid.UUID, org_id: uuid.UUID
) -> list[Role]:
    rows = (await db.execute(
        select(Role)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().all()
    return list(rows)
```

- [ ] **Step 4: Run, expect pass**

```bash
cd backend && uv run pytest tests/rbac/test_user_org_multi_role.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/rbac/service.py backend/tests/rbac/test_user_org_multi_role.py
git commit -m "feat(rbac): add multi-role service helpers with primary-role invariant"
```

---

### Task 1.5: Run full backend regression after PR-1

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && uv run pytest -x
```

Expected: PASS. If any existing test fails because of the PK change, inspect and fix — likely a fixture that does `INSERT INTO user_organizations` and didn't supply `role_id`. Such fixtures should now supply `role_id`.

- [ ] **Step 2: Push PR-1**

```bash
git push origin claude/zealous-jennings-eafc0d
```

Open PR titled `feat(rbac): multi-role + evaluator/assessee system roles`.

---

## PR-2: Capability-Based Authorization

**Goal:** Introduce `user_has_capability` / `require_capability`. Replace hardcoded role checks across modules with capability checks (or alias-aware role checks). No user-visible behavior change.

### Task 2.1: Capability helper + tests

**Files:**
- Create: `backend/src/app/auth/capabilities.py`
- Test: `backend/tests/auth/test_capabilities.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/auth/test_capabilities.py`:

```python
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.capabilities import user_has_capability
from app.auth.models import User
from app.auth.security import hash_password
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user
from sqlalchemy import select


async def _make_user(db: AsyncSession, name: str) -> User:
    u = User(username=name, email=f"{name}@x.com",
             password_hash=hash_password("x"), full_name=name)
    db.add(u); await db.flush()
    return u


async def _role(db: AsyncSession, name: str) -> Role:
    return (await db.execute(
        select(Role).where(Role.name == name, Role.org_id.is_(None))
    )).scalar_one()


@pytest.mark.asyncio
async def test_evaluator_has_exam_create(db_session):
    await seed_roles(db_session)
    user = await _make_user(db_session, "alice")
    org = Organization(name="X", type="school", is_active=True)
    db_session.add(org); await db_session.flush()
    role = await _role(db_session, "evaluator")
    await db_session.commit()
    await add_role_to_user(db_session, user.id, org.id, role.id, is_primary=True)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "exam.create") is True


@pytest.mark.asyncio
async def test_teacher_alias_also_has_exam_create(db_session):
    await seed_roles(db_session)
    user = await _make_user(db_session, "bob")
    org = Organization(name="X", type="school", is_active=True)
    db_session.add(org); await db_session.flush()
    role = await _role(db_session, "teacher")
    await db_session.commit()
    await add_role_to_user(db_session, user.id, org.id, role.id, is_primary=True)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "exam.create") is True


@pytest.mark.asyncio
async def test_assessee_lacks_exam_create(db_session):
    await seed_roles(db_session)
    user = await _make_user(db_session, "carol")
    org = Organization(name="X", type="school", is_active=True)
    db_session.add(org); await db_session.flush()
    role = await _role(db_session, "assessee")
    await db_session.commit()
    await add_role_to_user(db_session, user.id, org.id, role.id, is_primary=True)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "exam.create") is False


@pytest.mark.asyncio
async def test_multi_role_capability_union(db_session):
    await seed_roles(db_session)
    user = await _make_user(db_session, "dan")
    org = Organization(name="X", type="enterprise", is_active=True)
    db_session.add(org); await db_session.flush()
    eval_role = await _role(db_session, "evaluator")
    admin_role = await _role(db_session, "enterprise_admin")
    await db_session.commit()
    await add_role_to_user(db_session, user.id, org.id, eval_role.id, is_primary=True)
    await add_role_to_user(db_session, user.id, org.id, admin_role.id, is_primary=False)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "exam.create") is True
    assert await user_has_capability(db_session, user.id, "user.create") is True


@pytest.mark.asyncio
async def test_unknown_capability_returns_false(db_session):
    await seed_roles(db_session)
    user = await _make_user(db_session, "ed")
    org = Organization(name="X", type="school", is_active=True)
    db_session.add(org); await db_session.flush()
    role = await _role(db_session, "evaluator")
    await db_session.commit()
    await add_role_to_user(db_session, user.id, org.id, role.id, is_primary=True)
    await db_session.commit()

    assert await user_has_capability(db_session, user.id, "warp.drive") is False
```

- [ ] **Step 2: Run, expect failure**

```bash
cd backend && uv run pytest tests/auth/test_capabilities.py -v
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement capabilities.py**

Create `backend/src/app/auth/capabilities.py`:

```python
"""Capability-based authorization helpers."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.rbac.models import Permission, Role, RolePermission, UserOrganization


def _parse(capability: str) -> tuple[str, str]:
    resource, _, action = capability.partition(".")
    if not resource or not action:
        raise ValueError(f"Capability must be 'resource.action', got {capability!r}")
    return resource, action


async def user_has_capability(
    db: AsyncSession, user_id: uuid.UUID, *capabilities: str
) -> bool:
    """Return True if user holds at least one of the given capabilities."""
    if not capabilities:
        return True

    pairs = {_parse(c) for c in capabilities}

    rows = (await db.execute(
        select(Permission.resource, Permission.action)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .where(UserOrganization.user_id == user_id)
    )).all()
    held = {(r, a) for r, a in rows}

    # platform_admin gets all permissions; treat as wildcard.
    is_platform_admin = (await db.execute(
        select(Role.id)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .where(
            UserOrganization.user_id == user_id,
            Role.name == "platform_admin",
        )
        .limit(1)
    )).scalar_one_or_none()
    if is_platform_admin is not None:
        return True

    return bool(held.intersection(pairs))


def require_capability(*capabilities: str):
    """FastAPI dependency: 403 unless current user holds any of the capabilities."""

    async def checker(
        user: CurrentUser,
        db: Annotated[AsyncSession, Depends(get_db)],
    ):
        if not await user_has_capability(db, user.id, *capabilities):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return Depends(checker)
```

- [ ] **Step 4: Run, expect pass**

```bash
cd backend && uv run pytest tests/auth/test_capabilities.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/auth/capabilities.py backend/tests/auth/test_capabilities.py
git commit -m "feat(auth): add user_has_capability + require_capability helpers"
```

---

### Task 2.2: Replace exams/router.py role checks

**Files:**
- Modify: `backend/src/app/exams/router.py:75-81,712-714`
- Test: `backend/tests/test_exam_list_scope.py` (existing, must keep green)

- [ ] **Step 1: Read current implementation to confirm change scope**

```bash
cd backend && grep -n "_is_exam_admin\|_is_student_user" src/app/exams/router.py
```

Expected output should match the lines listed in File Structure.

- [ ] **Step 2: Modify the helpers**

Edit `backend/src/app/exams/router.py:75-81` (the two helper functions):

```python
async def _is_exam_admin(db: AsyncSession, user_id: uuid.UUID) -> bool:
    return await user_has_role(
        db, user_id,
        "platform_admin", "school_admin", "admin", "enterprise_admin",
    )


async def _is_student_user(db: AsyncSession, user_id: uuid.UUID) -> bool:
    return await user_has_role(db, user_id, "student", "assessee")
```

`enterprise_admin` is included so HR can see and manage their org's exams.

- [ ] **Step 3: Run existing exam tests**

```bash
cd backend && uv run pytest tests/test_exam_list_scope.py tests/test_exam_analysis.py -v
```

Expected: PASS. If anything fails, the regression must be fixed before continuing.

- [ ] **Step 4: Commit**

```bash
git add backend/src/app/exams/router.py
git commit -m "refactor(exams): allow enterprise_admin and assessee aliases in role checks"
```

---

### Task 2.3: Replace positions_router.py role checks

**Files:**
- Modify: `backend/src/app/exams/positions_router.py:50,80`

- [ ] **Step 1: Modify is_admin check at both call sites**

Edit `backend/src/app/exams/positions_router.py`. At lines 50 and 80, change:

```python
is_admin = await user_has_role(db, user.id, "platform_admin", "school_admin")
```

to:

```python
is_admin = await user_has_role(
    db, user.id, "platform_admin", "school_admin", "enterprise_admin"
)
```

- [ ] **Step 2: Run tests**

```bash
cd backend && uv run pytest tests/ -k "position" -v
```

Expected: PASS (or no tests collected, which is acceptable — coverage gap noted).

- [ ] **Step 3: Commit**

```bash
git add backend/src/app/exams/positions_router.py
git commit -m "refactor(exams): allow enterprise_admin to manage system positions"
```

---

### Task 2.4: Replace remaining hardcoded role checks

**Files:**
- Modify: `backend/src/app/grading/router.py:47`
- Modify: `backend/src/app/learning/router.py:33,37`
- Modify: `backend/src/app/analytics/router.py:50`
- Modify: `backend/src/app/rbac/students_router.py:33`

- [ ] **Step 1: grading/router.py**

Edit `backend/src/app/grading/router.py:47`. Change:

```python
return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin")
```

to:

```python
return await user_has_role(
    db, user.id, "platform_admin", "school_admin", "admin", "enterprise_admin"
)
```

- [ ] **Step 2: learning/router.py**

Edit `backend/src/app/learning/router.py:33`. Change `WriteUser`:

```python
WriteUser = Annotated[
    User,
    require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator"),
]
```

And line 37:

```python
return await user_has_role(
    db, user.id, "platform_admin", "school_admin", "admin", "enterprise_admin"
)
```

- [ ] **Step 3: analytics/router.py**

Edit `backend/src/app/analytics/router.py:50`. Change:

```python
is_teacher = await user_has_role(db, user.id, "teacher")
```

to:

```python
is_teacher = await user_has_role(db, user.id, "teacher", "evaluator")
```

- [ ] **Step 4: rbac/students_router.py**

Edit `backend/src/app/rbac/students_router.py:33`. Change:

```python
return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin")
```

to:

```python
return await user_has_role(
    db, user.id, "platform_admin", "school_admin", "admin", "enterprise_admin"
)
```

- [ ] **Step 5: Run full backend test suite**

```bash
cd backend && uv run pytest -x
```

Expected: All previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/grading/router.py backend/src/app/learning/router.py \
        backend/src/app/analytics/router.py backend/src/app/rbac/students_router.py
git commit -m "refactor: include evaluator/enterprise_admin aliases in role gates"
```

---

### Task 2.5: Push PR-2 and verify regression

- [ ] **Step 1: Push**

```bash
git push origin claude/zealous-jennings-eafc0d
```

- [ ] **Step 2: Manual smoke (record results)**

Pull the branch into staging and verify:
- Teacher can still create/edit/publish exams
- Student can still take exams and view wrong-answers
- school_admin can still manage classes
- enterprise_admin (existing) can still manage job models AND now sees exam menu items

If any regression: STOP, file a follow-up task before merging.

---

## PR-3: User Type + Invitation Data Model + API

**Goal:** Add `User.user_type`, `User.primary_org_id`, the `exam_invitations` table, the `invitation_service` and the HTTP API for HR to bulk-import candidates and for candidates to redeem tokens.

### Task 3.1: Add user_type and primary_org_id columns

**Files:**
- Modify: `backend/src/app/auth/models.py`
- Create: `backend/alembic/versions/20260426_user_type_external_guest.py`

- [ ] **Step 1: Update User model**

Edit `backend/src/app/auth/models.py`. Replace the `User` class with:

```python
import uuid
from sqlalchemy import Boolean, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import BaseModel


class User(BaseModel):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    student_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True
    )
    owner_teacher_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    user_type: Mapped[str] = mapped_column(String(20), nullable=False, default="internal")
    primary_org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )

    student_class: Mapped["app.rbac.models.Class | None"] = relationship(
        "Class", back_populates="students", lazy="joined", foreign_keys=[class_id],
    )
    owner_teacher: Mapped["User | None"] = relationship("User", remote_side="User.id")

    __table_args__ = (
        Index("ix_users_username_active", "username", unique=True,
              postgresql_where="deleted_at IS NULL"),
        Index("ix_users_email_active", "email", unique=True,
              postgresql_where="deleted_at IS NULL"),
        Index("ix_users_phone_active", "phone", unique=True,
              postgresql_where="deleted_at IS NULL AND phone IS NOT NULL"),
        Index(
            "ix_users_phone_org_external", "phone", "primary_org_id", unique=True,
            postgresql_where="deleted_at IS NULL AND user_type = 'external_guest' "
                             "AND phone IS NOT NULL",
        ),
    )
```

- [ ] **Step 2: Create the migration**

Create `backend/alembic/versions/20260426_user_type_external_guest.py`:

```python
"""add user.user_type and primary_org_id

Revision ID: 20260426_user_type_external_guest
Revises: 20260425_user_org_multi_role
Create Date: 2026-04-26
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260426_user_type_external_guest"
down_revision: Union[str, None] = "20260425_user_org_multi_role"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("user_type", sa.String(length=20), nullable=False,
                  server_default="internal"),
    )
    op.add_column(
        "users",
        sa.Column("primary_org_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_primary_org_id",
        "users", "organizations",
        ["primary_org_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_users_phone_org_external",
        "users",
        ["phone", "primary_org_id"],
        unique=True,
        postgresql_where=sa.text(
            "deleted_at IS NULL AND user_type = 'external_guest' AND phone IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_users_phone_org_external", table_name="users")
    op.drop_constraint("fk_users_primary_org_id", "users", type_="foreignkey")
    op.drop_column("users", "primary_org_id")
    op.drop_column("users", "user_type")
```

- [ ] **Step 3: Run migration on test DB**

```bash
cd backend && uv run alembic upgrade head
```

Expected: head moves to `20260426_user_type_external_guest`.

- [ ] **Step 4: Run all backend tests**

```bash
cd backend && uv run pytest -x
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/auth/models.py \
        backend/alembic/versions/20260426_user_type_external_guest.py
git commit -m "feat(auth): add User.user_type and primary_org_id"
```

---

### Task 3.2: Reject external_guest from password login

**Files:**
- Modify: `backend/src/app/auth/router.py` (login endpoint)
- Test: `backend/tests/test_auth.py`

- [ ] **Step 1: Locate login endpoint**

```bash
cd backend && grep -n "def login\|/login" src/app/auth/router.py
```

- [ ] **Step 2: Add rejection clause**

After the user-fetch step in `login`, before bcrypt verify, add:

```python
if user.user_type == "external_guest":
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="External guests must use invitation links to access exams",
    )
```

(Adapt to existing variable names; the check belongs after the user is fetched and before `verify_password`.)

- [ ] **Step 3: Add test**

In `backend/tests/test_auth.py`, append:

```python
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import hash_password


@pytest.mark.asyncio
async def test_external_guest_cannot_password_login(client, db_session: AsyncSession):
    user = User(
        username="extguest",
        email="ext@example.com",
        password_hash=hash_password("realpw"),
        full_name="Ext",
        user_type="external_guest",
    )
    db_session.add(user)
    await db_session.commit()

    resp = await client.post(
        "/api/auth/login",
        json={"username": "extguest", "password": "realpw"},
    )
    assert resp.status_code == 401
    assert "invitation" in resp.json()["detail"].lower()
```

- [ ] **Step 4: Run test**

```bash
cd backend && uv run pytest tests/test_auth.py::test_external_guest_cannot_password_login -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/auth/router.py backend/tests/test_auth.py
git commit -m "feat(auth): reject external_guest user_type at password login"
```

---

### Task 3.3: ExamInvitation model + migration

**Files:**
- Create: `backend/src/app/exams/invitation_models.py`
- Create: `backend/alembic/versions/20260426_exam_invitations.py`
- Modify: `backend/src/app/main.py` (import the model so SQLAlchemy registers it)

- [ ] **Step 1: Create the ORM model**

Create `backend/src/app/exams/invitation_models.py`:

```python
"""ExamInvitation: external candidate access to a specific exam via token."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models import BaseModel


class ExamInvitation(BaseModel):
    __tablename__ = "exam_invitations"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("exam_id", "user_id", name="uq_invitation_exam_user"),
        Index("ix_exam_invitations_token_hash", "token_hash"),
    )
```

- [ ] **Step 2: Create the migration**

Create `backend/alembic/versions/20260426_exam_invitations.py`:

```python
"""add exam_invitations table

Revision ID: 20260426_exam_invitations
Revises: 20260426_user_type_external_guest
Create Date: 2026-04-26
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260426_exam_invitations"
down_revision: Union[str, None] = "20260426_user_type_external_guest"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "exam_invitations",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("exam_id", sa.Uuid(),
                  sa.ForeignKey("exams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("exam_id", "user_id", name="uq_invitation_exam_user"),
    )
    op.create_index(
        "ix_exam_invitations_token_hash",
        "exam_invitations",
        ["token_hash"],
    )


def downgrade() -> None:
    op.drop_index("ix_exam_invitations_token_hash", table_name="exam_invitations")
    op.drop_table("exam_invitations")
```

- [ ] **Step 3: Register model in main.py**

Edit `backend/src/app/main.py`. Find the existing model imports and add:

```python
from app.exams.invitation_models import ExamInvitation  # noqa: F401
```

- [ ] **Step 4: Run migration**

```bash
cd backend && uv run alembic upgrade head
```

Expected: head moves to `20260426_exam_invitations`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/exams/invitation_models.py \
        backend/alembic/versions/20260426_exam_invitations.py \
        backend/src/app/main.py
git commit -m "feat(exams): add ExamInvitation model and migration"
```

---

### Task 3.4: Invitation token security helpers + tests

**Files:**
- Create: `backend/src/app/auth/invitation_security.py`
- Test: `backend/tests/auth/test_invitation_security.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/auth/test_invitation_security.py`:

```python
import uuid
from datetime import datetime, timezone, timedelta

import pytest

from app.auth.invitation_security import (
    create_exam_take_token,
    decode_exam_take_token,
    generate_invitation_token,
    hash_invitation_token,
)


def test_generate_token_has_minimum_entropy():
    t = generate_invitation_token()
    assert len(t) >= 40
    assert t == t.strip()


def test_hash_is_deterministic_and_long():
    t = "abc123"
    assert hash_invitation_token(t) == hash_invitation_token(t)
    assert len(hash_invitation_token(t)) == 64


def test_exam_take_jwt_roundtrip():
    user_id = uuid.uuid4()
    exam_id = uuid.uuid4()
    expires = datetime.now(timezone.utc) + timedelta(hours=1)

    token = create_exam_take_token(user_id, exam_id, expires)
    payload = decode_exam_take_token(token)

    assert payload["sub"] == str(user_id)
    assert payload["exam_id"] == str(exam_id)
    assert payload["scope"] == "exam_take"


def test_exam_take_jwt_expired():
    user_id = uuid.uuid4()
    exam_id = uuid.uuid4()
    expires = datetime.now(timezone.utc) - timedelta(seconds=1)

    token = create_exam_take_token(user_id, exam_id, expires)
    assert decode_exam_take_token(token) is None
```

- [ ] **Step 2: Run, expect failure**

```bash
cd backend && uv run pytest tests/auth/test_invitation_security.py -v
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `backend/src/app/auth/invitation_security.py`:

```python
"""Token generation, hashing, and short-lived JWT for invitation flow."""

import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from jose import JWTError, jwt

from app.config import settings

ALGORITHM = "HS256"
SCOPE_EXAM_TAKE = "exam_take"


def generate_invitation_token() -> str:
    """Returns a 43-character base64url token (32 random bytes)."""
    return secrets.token_urlsafe(32)


def hash_invitation_token(token: str) -> str:
    """Returns SHA-256 hex digest (64 chars)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_exam_take_token(
    user_id: uuid.UUID, exam_id: uuid.UUID, expires_at: datetime
) -> str:
    payload = {
        "sub": str(user_id),
        "exam_id": str(exam_id),
        "scope": SCOPE_EXAM_TAKE,
        "exp": int(expires_at.timestamp()),
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_exam_take_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("scope") != SCOPE_EXAM_TAKE:
        return None
    return payload
```

- [ ] **Step 4: Run, expect pass**

```bash
cd backend && uv run pytest tests/auth/test_invitation_security.py -v
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/auth/invitation_security.py \
        backend/tests/auth/test_invitation_security.py
git commit -m "feat(auth): add invitation token gen/hash and exam-take JWT"
```

---

### Task 3.5: Invitation service + tests

**Files:**
- Create: `backend/src/app/exams/invitation_schemas.py`
- Create: `backend/src/app/exams/invitation_service.py`
- Test: `backend/tests/exams/test_invitation_service.py`

- [ ] **Step 1: Schemas**

Create `backend/src/app/exams/invitation_schemas.py`:

```python
"""Pydantic schemas for invitation API."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class CandidateImportItem(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=5, max_length=20)
    email: EmailStr | None = None


class InvitationCreated(BaseModel):
    user_id: uuid.UUID
    invitation_id: uuid.UUID
    invite_url: str


class InvitationListItem(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    candidate_name: str
    candidate_phone: str
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None


class RedeemRequest(BaseModel):
    token: str = Field(min_length=20)


class RedeemResponse(BaseModel):
    access_token: str
    exam_id: uuid.UUID
    candidate_name: str
```

- [ ] **Step 2: Write the failing service test**

Create `backend/tests/exams/test_invitation_service.py`:

```python
import uuid
from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.invitation_security import hash_invitation_token
from app.auth.models import User
from app.auth.security import hash_password
from app.exams.invitation_models import ExamInvitation
from app.exams.invitation_schemas import CandidateImportItem
from app.exams.invitation_service import (
    create_invitation,
    redeem_token,
    revoke_invitation,
    InvitationError,
)
from app.exams.models import Exam, ExamStatus
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user


async def _setup_hr_with_exam(db: AsyncSession) -> tuple[User, Exam, Organization]:
    await seed_roles(db)
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db.add(org); await db.flush()

    hr = User(username="hr1", email="hr@acme.com",
             password_hash=hash_password("x"), full_name="HR One",
             user_type="internal", primary_org_id=org.id)
    db.add(hr); await db.flush()

    eval_role = (await db.execute(
        select(Role).where(Role.name == "evaluator", Role.org_id.is_(None))
    )).scalar_one()
    await add_role_to_user(db, hr.id, org.id, eval_role.id, is_primary=True)

    exam = Exam(
        title="Recruitment Q1",
        owner_id=hr.id,
        created_by=hr.id,
        duration_minutes=60,
        total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(exam); await db.flush()
    return hr, exam, org


@pytest.mark.asyncio
async def test_create_invitation_creates_external_guest_user(db_session):
    hr, exam, org = await _setup_hr_with_exam(db_session)
    await db_session.commit()

    result = await create_invitation(
        db_session, exam, CandidateImportItem(
            full_name="Cand A", phone="13800000001", email="a@x.com",
        ), hr,
    )
    await db_session.commit()

    user = (await db_session.execute(
        select(User).where(User.id == result.user_id)
    )).scalar_one()
    assert user.user_type == "external_guest"
    assert user.primary_org_id == org.id
    assert user.phone == "13800000001"


@pytest.mark.asyncio
async def test_create_invitation_dedupes_by_phone(db_session):
    hr, exam, org = await _setup_hr_with_exam(db_session)
    await db_session.commit()

    r1 = await create_invitation(
        db_session, exam,
        CandidateImportItem(full_name="A", phone="13800000001"), hr,
    )
    await db_session.commit()

    other_exam = Exam(
        title="Recruitment Q2",
        owner_id=hr.id, created_by=hr.id,
        duration_minutes=60, total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(other_exam); await db_session.flush()

    r2 = await create_invitation(
        db_session, other_exam,
        CandidateImportItem(full_name="A", phone="13800000001"), hr,
    )
    await db_session.commit()

    assert r1.user_id == r2.user_id


@pytest.mark.asyncio
async def test_create_invitation_rejects_non_enterprise(db_session):
    await seed_roles(db_session)
    school_org = Organization(name="School", type="school", is_active=True)
    db_session.add(school_org); await db_session.flush()
    teacher = User(username="t", email="t@s.com",
                   password_hash=hash_password("x"), full_name="T",
                   user_type="internal", primary_org_id=school_org.id)
    db_session.add(teacher); await db_session.flush()
    teacher_role = (await db_session.execute(
        select(Role).where(Role.name == "teacher", Role.org_id.is_(None))
    )).scalar_one()
    await add_role_to_user(db_session, teacher.id, school_org.id, teacher_role.id, is_primary=True)
    exam = Exam(title="X", owner_id=teacher.id, created_by=teacher.id,
                duration_minutes=60, total_score=100.0,
                status=ExamStatus.UPCOMING.value,
                end_time=datetime.now(timezone.utc) + timedelta(days=1))
    db_session.add(exam); await db_session.flush()
    await db_session.commit()

    with pytest.raises(InvitationError, match="enterprise"):
        await create_invitation(
            db_session, exam,
            CandidateImportItem(full_name="A", phone="13800000001"), teacher,
        )


@pytest.mark.asyncio
async def test_redeem_token_returns_jwt_for_valid(db_session):
    hr, exam, _ = await _setup_hr_with_exam(db_session)
    await db_session.commit()

    result = await create_invitation(
        db_session, exam,
        CandidateImportItem(full_name="A", phone="13800000001"), hr,
    )
    await db_session.commit()
    raw_token = result.invite_url.rsplit("token=", 1)[1]

    response = await redeem_token(db_session, raw_token)
    await db_session.commit()
    assert response.exam_id == exam.id
    assert response.candidate_name == "A"
    assert response.access_token


@pytest.mark.asyncio
async def test_redeem_revoked_invitation_fails(db_session):
    hr, exam, _ = await _setup_hr_with_exam(db_session)
    await db_session.commit()

    result = await create_invitation(
        db_session, exam,
        CandidateImportItem(full_name="A", phone="13800000001"), hr,
    )
    await db_session.commit()
    raw_token = result.invite_url.rsplit("token=", 1)[1]

    await revoke_invitation(db_session, result.invitation_id, hr)
    await db_session.commit()

    with pytest.raises(InvitationError, match="revoked"):
        await redeem_token(db_session, raw_token)


@pytest.mark.asyncio
async def test_redeem_expired_invitation_fails(db_session):
    hr, exam, _ = await _setup_hr_with_exam(db_session)
    exam.end_time = datetime.now(timezone.utc) - timedelta(days=1)
    await db_session.commit()

    result = await create_invitation(
        db_session, exam,
        CandidateImportItem(full_name="A", phone="13800000001"), hr,
    )
    await db_session.commit()
    raw_token = result.invite_url.rsplit("token=", 1)[1]

    with pytest.raises(InvitationError, match="expired"):
        await redeem_token(db_session, raw_token)
```

- [ ] **Step 3: Run, expect failure**

```bash
cd backend && uv run pytest tests/exams/test_invitation_service.py -v
```

Expected: FAIL — service module missing.

- [ ] **Step 4: Implement service**

Create `backend/src/app/exams/invitation_service.py`:

```python
"""Service: create/list/revoke invitations, redeem tokens, provision external_guest users."""

import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.invitation_security import (
    create_exam_take_token,
    generate_invitation_token,
    hash_invitation_token,
)
from app.auth.models import User
from app.config import settings
from app.exams.invitation_models import ExamInvitation
from app.exams.invitation_schemas import (
    CandidateImportItem,
    InvitationCreated,
    RedeemResponse,
)
from app.exams.models import Exam, ExamStudent
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.service import add_role_to_user


class InvitationError(Exception):
    """Raised when invitation operation cannot proceed (used→4xx mapping)."""


_TAKE_TOKEN_BUFFER = timedelta(minutes=30)


def _build_invite_url(token: str) -> str:
    base = (getattr(settings, "frontend_base_url", None)
            or "http://localhost:5173").rstrip("/")
    return f"{base}/exam-invite?token={token}"


async def _resolve_evaluator_enterprise_org(
    db: AsyncSession, evaluator: User
) -> Organization:
    row = (await db.execute(
        select(Organization)
        .join(UserOrganization, UserOrganization.org_id == Organization.id)
        .where(
            UserOrganization.user_id == evaluator.id,
            UserOrganization.is_primary_role.is_(True),
            Organization.type == "enterprise",
            Organization.is_active.is_(True),
        )
        .limit(1)
    )).scalar_one_or_none()
    if row is None:
        raise InvitationError(
            "Only evaluators of an enterprise organization can issue invitations"
        )
    return row


async def _find_or_create_external_guest(
    db: AsyncSession, candidate: CandidateImportItem, org: Organization
) -> User:
    existing = (await db.execute(
        select(User).where(
            User.user_type == "external_guest",
            User.primary_org_id == org.id,
            User.phone == candidate.phone,
            User.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if existing is not None:
        return existing

    user = User(
        username=f"guest_{uuid.uuid4().hex[:12]}",
        email=candidate.email or f"guest_{uuid.uuid4().hex[:8]}@invite.local",
        phone=candidate.phone,
        password_hash="!",
        full_name=candidate.full_name,
        is_active=True,
        user_type="external_guest",
        primary_org_id=org.id,
    )
    db.add(user)
    await db.flush()

    assessee_role = (await db.execute(
        select(Role).where(Role.name == "assessee", Role.org_id.is_(None))
    )).scalar_one()
    await add_role_to_user(db, user.id, org.id, assessee_role.id, is_primary=True)
    return user


async def create_invitation(
    db: AsyncSession,
    exam: Exam,
    candidate: CandidateImportItem,
    evaluator: User,
) -> InvitationCreated:
    if exam.end_time is None:
        raise InvitationError("Exam must have an end_time before issuing invitations")

    org = await _resolve_evaluator_enterprise_org(db, evaluator)
    guest = await _find_or_create_external_guest(db, candidate, org)

    existing_es = (await db.execute(
        select(ExamStudent).where(
            ExamStudent.exam_id == exam.id,
            ExamStudent.student_id == guest.id,
        )
    )).scalar_one_or_none()
    if existing_es is None:
        db.add(ExamStudent(exam_id=exam.id, student_id=guest.id))
        await db.flush()

    raw = generate_invitation_token()
    invitation = ExamInvitation(
        exam_id=exam.id,
        user_id=guest.id,
        token_hash=hash_invitation_token(raw),
        expires_at=exam.end_time + _TAKE_TOKEN_BUFFER,
        created_by=evaluator.id,
    )
    db.add(invitation)
    await db.flush()

    return InvitationCreated(
        user_id=guest.id,
        invitation_id=invitation.id,
        invite_url=_build_invite_url(raw),
    )


async def revoke_invitation(
    db: AsyncSession, invitation_id: uuid.UUID, evaluator: User
) -> None:
    inv = (await db.execute(
        select(ExamInvitation).where(ExamInvitation.id == invitation_id)
    )).scalar_one_or_none()
    if inv is None:
        raise InvitationError("Invitation not found")
    inv.revoked_at = datetime.now(timezone.utc)
    await db.flush()


async def redeem_token(db: AsyncSession, raw_token: str) -> RedeemResponse:
    th = hash_invitation_token(raw_token)
    inv = (await db.execute(
        select(ExamInvitation).where(ExamInvitation.token_hash == th)
    )).scalar_one_or_none()
    if inv is None:
        raise InvitationError("Token not recognized")

    now = datetime.now(timezone.utc)
    if inv.revoked_at is not None:
        raise InvitationError("Invitation revoked")
    expires = inv.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        raise InvitationError("Invitation expired")

    if inv.used_at is None:
        inv.used_at = now
        await db.flush()

    user = (await db.execute(
        select(User).where(User.id == inv.user_id)
    )).scalar_one()
    jwt_token = create_exam_take_token(user.id, inv.exam_id, expires)
    return RedeemResponse(
        access_token=jwt_token,
        exam_id=inv.exam_id,
        candidate_name=user.full_name,
    )
```

- [ ] **Step 5: Run, expect pass**

```bash
cd backend && uv run pytest tests/exams/test_invitation_service.py -v
```

Expected: 6 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/exams/invitation_schemas.py \
        backend/src/app/exams/invitation_service.py \
        backend/tests/exams/test_invitation_service.py
git commit -m "feat(exams): invitation service for external candidates"
```

---

### Task 3.6: Invitation router (HR-facing endpoints)

**Files:**
- Create: `backend/src/app/exams/invitation_router.py`
- Modify: `backend/src/app/main.py` (mount router)
- Test: `backend/tests/exams/test_invitation_router.py`

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/exams/test_invitation_router.py`:

```python
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import create_access_token, hash_password
from app.exams.models import Exam, ExamStatus
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user
from datetime import datetime, timezone, timedelta


async def _setup_hr_exam(db: AsyncSession) -> tuple[User, str, Exam]:
    await seed_roles(db)
    org = Organization(name="ACME", type="enterprise", is_active=True)
    db.add(org); await db.flush()
    hr = User(username="hr", email="hr@x.com",
             password_hash=hash_password("x"), full_name="HR",
             user_type="internal", primary_org_id=org.id)
    db.add(hr); await db.flush()
    eval_role = (await db.execute(
        select(Role).where(Role.name == "evaluator", Role.org_id.is_(None))
    )).scalar_one()
    await add_role_to_user(db, hr.id, org.id, eval_role.id, is_primary=True)
    exam = Exam(
        title="Recruit", owner_id=hr.id, created_by=hr.id,
        duration_minutes=60, total_score=100.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(exam); await db.flush()
    await db.commit()
    return hr, create_access_token(hr.id, "evaluator"), exam


@pytest.mark.asyncio
async def test_bulk_invitation_creates_invites(client, db_session):
    hr, token, exam = await _setup_hr_exam(db_session)

    resp = await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {token}"},
        json=[
            {"full_name": "Cand A", "phone": "13800000001"},
            {"full_name": "Cand B", "phone": "13800000002"},
        ],
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body) == 2
    for item in body:
        assert "invite_url" in item
        assert "token=" in item["invite_url"]


@pytest.mark.asyncio
async def test_list_invitations(client, db_session):
    hr, token, exam = await _setup_hr_exam(db_session)
    await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {token}"},
        json=[{"full_name": "A", "phone": "13800000001"}],
    )

    resp = await client.get(
        f"/api/exams/{exam.id}/invitations",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_redeem_endpoint(client, db_session):
    hr, token, exam = await _setup_hr_exam(db_session)
    bulk = await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {token}"},
        json=[{"full_name": "A", "phone": "13800000001"}],
    )
    raw_token = bulk.json()[0]["invite_url"].rsplit("token=", 1)[1]

    resp = await client.post("/api/exam-invite/redeem", json={"token": raw_token})
    assert resp.status_code == 200
    assert "access_token" in resp.json()
    assert resp.json()["exam_id"] == str(exam.id)


@pytest.mark.asyncio
async def test_non_enterprise_evaluator_forbidden(client, db_session):
    await seed_roles(db_session)
    school = Organization(name="S", type="school", is_active=True)
    db_session.add(school); await db_session.flush()
    teacher = User(username="t", email="t@s.com",
                   password_hash=hash_password("x"), full_name="T",
                   user_type="internal", primary_org_id=school.id)
    db_session.add(teacher); await db_session.flush()
    teacher_role = (await db_session.execute(
        select(Role).where(Role.name == "teacher", Role.org_id.is_(None))
    )).scalar_one()
    await add_role_to_user(db_session, teacher.id, school.id, teacher_role.id, is_primary=True)
    exam = Exam(title="X", owner_id=teacher.id, created_by=teacher.id,
                duration_minutes=60, total_score=100.0,
                status=ExamStatus.UPCOMING.value,
                end_time=datetime.now(timezone.utc) + timedelta(days=1))
    db_session.add(exam); await db_session.flush()
    await db_session.commit()

    token = create_access_token(teacher.id, "teacher")
    resp = await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {token}"},
        json=[{"full_name": "A", "phone": "13800000001"}],
    )
    assert resp.status_code == 400
    assert "enterprise" in resp.json()["detail"].lower()
```

- [ ] **Step 2: Run, expect failure**

```bash
cd backend && uv run pytest tests/exams/test_invitation_router.py -v
```

Expected: FAIL — endpoints missing.

- [ ] **Step 3: Implement router**

Create `backend/src/app/exams/invitation_router.py`:

```python
"""HTTP endpoints for exam invitations."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.capabilities import require_capability
from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.exams.invitation_models import ExamInvitation
from app.exams.invitation_schemas import (
    CandidateImportItem,
    InvitationCreated,
    InvitationListItem,
    RedeemRequest,
    RedeemResponse,
)
from app.exams.invitation_service import (
    InvitationError,
    create_invitation,
    redeem_token,
    revoke_invitation,
)
from app.exams.models import Exam
from app.auth.models import User

router = APIRouter()
public_router = APIRouter()


async def _exam_or_404(db: AsyncSession, exam_id: uuid.UUID) -> Exam:
    exam = (await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    return exam


@router.post(
    "/exams/{exam_id}/invitations/bulk",
    response_model=list[InvitationCreated],
    status_code=status.HTTP_201_CREATED,
)
async def bulk_invite(
    exam_id: uuid.UUID,
    candidates: list[CandidateImportItem],
    user: Annotated[User, require_capability("exam.create")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[InvitationCreated]:
    exam = await _exam_or_404(db, exam_id)
    if exam.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not exam owner")

    out: list[InvitationCreated] = []
    for c in candidates:
        try:
            out.append(await create_invitation(db, exam, c, user))
        except InvitationError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    await db.commit()
    return out


@router.get("/exams/{exam_id}/invitations", response_model=list[InvitationListItem])
async def list_invitations(
    exam_id: uuid.UUID,
    user: Annotated[User, require_capability("exam.read")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[InvitationListItem]:
    exam = await _exam_or_404(db, exam_id)
    rows = (await db.execute(
        select(ExamInvitation, User)
        .join(User, User.id == ExamInvitation.user_id)
        .where(ExamInvitation.exam_id == exam.id)
        .order_by(ExamInvitation.created_at.desc())
    )).all()
    return [
        InvitationListItem(
            id=inv.id,
            user_id=inv.user_id,
            candidate_name=u.full_name,
            candidate_phone=u.phone or "",
            expires_at=inv.expires_at,
            used_at=inv.used_at,
            revoked_at=inv.revoked_at,
        )
        for inv, u in rows
    ]


@router.delete("/exams/{exam_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invitation(
    exam_id: uuid.UUID,
    invitation_id: uuid.UUID,
    user: Annotated[User, require_capability("exam.update")],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    try:
        await revoke_invitation(db, invitation_id, user)
    except InvitationError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await db.commit()


@public_router.post("/exam-invite/redeem", response_model=RedeemResponse)
async def redeem(
    body: RedeemRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RedeemResponse:
    try:
        result = await redeem_token(db, body.token)
    except InvitationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    await db.commit()
    return result
```

- [ ] **Step 4: Mount in main.py**

Edit `backend/src/app/main.py`. Where existing routers are included, add:

```python
from app.exams.invitation_router import (
    router as invitation_router,
    public_router as invitation_public_router,
)

app.include_router(invitation_router, prefix="/api", tags=["invitations"])
app.include_router(invitation_public_router, prefix="/api", tags=["invitations-public"])
```

- [ ] **Step 5: Run, expect pass**

```bash
cd backend && uv run pytest tests/exams/test_invitation_router.py -v
```

Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/exams/invitation_router.py backend/src/app/main.py \
        backend/tests/exams/test_invitation_router.py
git commit -m "feat(exams): HR invitation API + candidate redeem endpoint"
```

---

### Task 3.7: External guest access middleware + tests

**Files:**
- Create: `backend/src/app/auth/external_guest_dependencies.py`
- Test: `backend/tests/exams/test_external_guest_access.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/exams/test_external_guest_access.py`:

```python
import uuid
from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.invitation_security import create_exam_take_token
from app.auth.models import User
from app.auth.security import create_access_token, hash_password
from app.exams.models import Exam, ExamStatus
from app.rbac.models import Organization
from app.rbac.seed import seed_roles


async def _make_external_guest(db: AsyncSession) -> tuple[User, Exam]:
    await seed_roles(db)
    org = Organization(name="X", type="enterprise", is_active=True)
    db.add(org); await db.flush()
    guest = User(
        username=f"guest_{uuid.uuid4().hex[:8]}",
        email="g@x.com", phone="13800000099",
        password_hash="!", full_name="Guest",
        user_type="external_guest", primary_org_id=org.id,
    )
    db.add(guest); await db.flush()
    exam = Exam(title="X", owner_id=guest.id, created_by=guest.id,
                duration_minutes=60, total_score=100.0,
                status=ExamStatus.UPCOMING.value,
                end_time=datetime.now(timezone.utc) + timedelta(days=1))
    db.add(exam); await db.flush()
    await db.commit()
    return guest, exam


@pytest.mark.asyncio
async def test_external_guest_jwt_blocked_from_user_management(client, db_session):
    guest, exam = await _make_external_guest(db_session)
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    token = create_exam_take_token(guest.id, exam.id, expires)

    resp = await client.get(
        "/api/users",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_external_guest_cannot_access_other_exam(client, db_session):
    guest, exam = await _make_external_guest(db_session)
    other_exam = Exam(title="Other", owner_id=guest.id, created_by=guest.id,
                     duration_minutes=60, total_score=100.0,
                     status=ExamStatus.UPCOMING.value,
                     end_time=datetime.now(timezone.utc) + timedelta(days=1))
    db_session.add(other_exam); await db_session.flush()
    await db_session.commit()

    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    token = create_exam_take_token(guest.id, exam.id, expires)

    resp = await client.get(
        f"/api/exams/{other_exam.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (401, 403)
```

- [ ] **Step 2: Run, expect failure**

```bash
cd backend && uv run pytest tests/exams/test_external_guest_access.py -v
```

Expected: FAIL — guards not in place.

- [ ] **Step 3: Implement middleware**

Create `backend/src/app/auth/external_guest_dependencies.py`:

```python
"""Dependencies enforcing the boundary between internal and external_guest sessions."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.invitation_security import decode_exam_take_token
from app.auth.models import User
from app.auth.security import decode_access_token
from app.database import get_db

bearer = HTTPBearer()


async def get_actor_for_exam(
    exam_id: uuid.UUID,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Accept either internal user JWT or invitation exam_take JWT bound to exam_id."""
    raw = credentials.credentials

    payload = decode_exam_take_token(raw)
    if payload is not None:
        if payload.get("exam_id") != str(exam_id):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Token not valid for this exam"
            )
        user_id = uuid.UUID(payload["sub"])
        user = (await db.execute(
            select(User).where(User.id == user_id, User.deleted_at.is_(None))
        )).scalar_one_or_none()
        if user is None or user.user_type != "external_guest":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
        return user

    payload2 = decode_access_token(raw)
    if payload2 is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user_id = uuid.UUID(payload2["sub"])
    user = (await db.execute(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )).scalar_one_or_none()
    if user is None or not user.is_active or user.user_type == "external_guest":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    return user
```

Edit `backend/src/app/auth/dependencies.py`. In `get_current_user`, after fetching user, add:

```python
if user.user_type == "external_guest":
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="External guests must use exam invitation tokens",
    )
```

This ensures any internal-only endpoint (which uses `CurrentUser`) rejects exam_take tokens, because `decode_access_token` will reject the invitation-scoped JWT (different scope claim required) and even if it didn't, the user_type check catches it.

- [ ] **Step 4: Run, expect pass**

```bash
cd backend && uv run pytest tests/exams/test_external_guest_access.py -v
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/auth/external_guest_dependencies.py \
        backend/src/app/auth/dependencies.py \
        backend/tests/exams/test_external_guest_access.py
git commit -m "feat(auth): block external_guest from internal-only endpoints"
```

---

### Task 3.8: End-to-end recruitment integration test

**Files:**
- Test: `backend/tests/integration/test_recruitment_flow.py`

- [ ] **Step 1: Write the integration test**

Create `backend/tests/integration/test_recruitment_flow.py`:

```python
"""End-to-end recruitment exam flow:
HR creates exam → bulk invites candidate → candidate redeems → submits → HR sees results.
"""
import uuid
from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import create_access_token, hash_password
from app.exams.invitation_models import ExamInvitation
from app.exams.models import Exam, ExamStatus
from app.questions.models import Question
from app.rbac.models import Organization, Role
from app.rbac.seed import seed_roles
from app.rbac.service import add_role_to_user


@pytest.mark.asyncio
async def test_recruitment_happy_path(client, db_session: AsyncSession):
    await seed_roles(db_session)

    org = Organization(name="ACME", type="enterprise", is_active=True)
    db_session.add(org); await db_session.flush()

    hr = User(username="hr", email="hr@acme.com",
              password_hash=hash_password("x"), full_name="HR",
              user_type="internal", primary_org_id=org.id)
    db_session.add(hr); await db_session.flush()

    eval_role = (await db_session.execute(
        select(Role).where(Role.name == "evaluator", Role.org_id.is_(None))
    )).scalar_one()
    await add_role_to_user(db_session, hr.id, org.id, eval_role.id, is_primary=True)

    q = Question(
        title="Pick A or B",
        type="single_choice",
        content={"text": "Q?"},
        options=[{"label": "A"}, {"label": "B"}],
        answer={"correct": "A"},
        difficulty=1, score=10.0, created_by=hr.id, owner_id=hr.id,
    )
    db_session.add(q); await db_session.flush()

    exam = Exam(
        title="Recruitment", owner_id=hr.id, created_by=hr.id,
        duration_minutes=60, total_score=10.0,
        status=ExamStatus.UPCOMING.value,
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(exam); await db_session.flush()
    await db_session.commit()

    hr_token = create_access_token(hr.id, "evaluator")

    bulk_resp = await client.post(
        f"/api/exams/{exam.id}/invitations/bulk",
        headers={"Authorization": f"Bearer {hr_token}"},
        json=[{"full_name": "Cand A", "phone": "13900000001"}],
    )
    assert bulk_resp.status_code == 201
    raw_token = bulk_resp.json()[0]["invite_url"].rsplit("token=", 1)[1]

    redeem_resp = await client.post(
        "/api/exam-invite/redeem", json={"token": raw_token},
    )
    assert redeem_resp.status_code == 200
    candidate_jwt = redeem_resp.json()["access_token"]

    list_resp = await client.get(
        f"/api/exams/{exam.id}/invitations",
        headers={"Authorization": f"Bearer {hr_token}"},
    )
    assert list_resp.status_code == 200
    body = list_resp.json()
    assert body[0]["used_at"] is not None
```

- [ ] **Step 2: Run**

```bash
cd backend && uv run pytest tests/integration/test_recruitment_flow.py -v
```

Expected: PASS.

- [ ] **Step 3: Commit and push PR-3**

```bash
git add backend/tests/integration/test_recruitment_flow.py
git commit -m "test(integration): recruitment exam happy path"
git push origin claude/zealous-jennings-eafc0d
```

Open PR titled `feat(exams): external candidate invitations and external_guest user type`.

---

## PR-4: Frontend — HR Flow

**Goal:** Add the role-display alias layer and the HR-side UI: Tab in exam students page for "external candidates" + invitation management Tab on exam detail.

### Task 4.1: Role-display alias library

**Files:**
- Create: `frontend/src/lib/role-display.ts`
- Test: `frontend/src/lib/role-display.test.ts`

- [ ] **Step 1: Write failing vitest**

Create `frontend/src/lib/role-display.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { displayRole, displayAssesseeNoun, displayEvaluatorNoun } from "./role-display"

describe("displayRole", () => {
  it("shows 教师 for evaluator in school", () => {
    expect(displayRole("school", "evaluator")).toBe("教师")
  })

  it("shows HR for evaluator in enterprise", () => {
    expect(displayRole("enterprise", "evaluator")).toBe("HR")
  })

  it("shows 学生 for assessee in school", () => {
    expect(displayRole("school", "assessee")).toBe("学生")
  })

  it("shows 候选人 for assessee in enterprise", () => {
    expect(displayRole("enterprise", "assessee")).toBe("候选人")
  })
})

describe("displayAssesseeNoun", () => {
  it("returns 学生 for school", () => {
    expect(displayAssesseeNoun("school")).toBe("学生")
  })
  it("returns 候选人 for enterprise", () => {
    expect(displayAssesseeNoun("enterprise")).toBe("候选人")
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
cd frontend && pnpm vitest run src/lib/role-display.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/role-display.ts`:

```typescript
export type OrgKind = "school" | "enterprise"
export type BusinessRole = "evaluator" | "assessee"

const TABLE: Record<OrgKind, Record<BusinessRole, string>> = {
  school:     { evaluator: "教师", assessee: "学生" },
  enterprise: { evaluator: "HR",   assessee: "候选人" },
}

export function displayRole(orgKind: OrgKind, role: BusinessRole): string {
  return TABLE[orgKind][role]
}

export function displayAssesseeNoun(orgKind: OrgKind): string {
  return TABLE[orgKind].assessee
}

export function displayEvaluatorNoun(orgKind: OrgKind): string {
  return TABLE[orgKind].evaluator
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd frontend && pnpm vitest run src/lib/role-display.test.ts
```

Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/role-display.ts frontend/src/lib/role-display.test.ts
git commit -m "feat(frontend): role-display alias layer (school vs enterprise)"
```

---

### Task 4.2: Capability resolver + RequireCapability guard

**Files:**
- Create: `frontend/src/lib/capabilities.ts`
- Create: `frontend/src/components/RequireCapability.tsx`

- [ ] **Step 1: Implement client-side resolver**

Create `frontend/src/lib/capabilities.ts`:

```typescript
const ROLE_CAPABILITIES: Record<string, ReadonlyArray<string>> = {
  platform_admin: ["*"],
  school_admin: [
    "exam.create", "exam.read", "exam.update", "exam.delete",
    "question.create", "question.read", "question.update", "question.delete",
    "course.create", "course.read", "course.update", "course.delete",
    "knowledge.create", "knowledge.read", "knowledge.update", "knowledge.delete",
    "user.create", "user.read", "user.update",
    "job_model.read", "gap_analysis.create", "gap_analysis.read", "export.create",
  ],
  enterprise_admin: [
    "exam.create", "exam.read", "exam.update", "exam.delete",
    "question.create", "question.read", "question.update", "question.delete",
    "knowledge.read",
    "job_model.create", "job_model.read", "job_model.update", "job_model.delete",
    "user.create", "user.read", "user.update",
    "gap_analysis.read", "export.create",
  ],
  enterprise_user: ["job_model.read", "job_model.update", "export.create"],
  teacher: [
    "exam.create", "exam.read", "exam.update",
    "question.create", "question.read", "question.update",
    "course.read", "course.update", "knowledge.read",
    "job_model.read", "gap_analysis.read", "export.create",
  ],
  evaluator: [
    "exam.create", "exam.read", "exam.update",
    "question.create", "question.read", "question.update",
    "course.read", "course.update", "knowledge.read",
    "job_model.read", "gap_analysis.read", "export.create",
  ],
  student: ["exam.read", "course.read", "knowledge.read"],
  assessee: ["exam.read", "course.read", "knowledge.read"],
}

export function userHasCapability(roles: ReadonlyArray<string>, capability: string): boolean {
  for (const role of roles) {
    const caps = ROLE_CAPABILITIES[role]
    if (!caps) continue
    if (caps.includes("*") || caps.includes(capability)) return true
  }
  return false
}
```

- [ ] **Step 2: Implement guard component**

Create `frontend/src/components/RequireCapability.tsx`:

```tsx
import { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { useAuth } from "@/providers/auth"
import { userHasCapability } from "@/lib/capabilities"

interface Props {
  capability: string
  fallbackRoute?: string
  children: ReactNode
}

export function RequireCapability({ capability, fallbackRoute = "/", children }: Props) {
  const { roles } = useAuth()
  if (!userHasCapability(roles ?? [], capability)) {
    return <Navigate to={fallbackRoute} replace />
  }
  return <>{children}</>
}
```

(If `useAuth` returns a different shape — e.g. `{ role: string }` not `{ roles: string[] }` — adapt to whatever exists in `frontend/src/providers/auth.tsx`. Open that file first to confirm.)

- [ ] **Step 3: Run typecheck**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/capabilities.ts frontend/src/components/RequireCapability.tsx
git commit -m "feat(frontend): client-side capability resolver and route guard"
```

---

### Task 4.3: External-candidate import Tab

**Files:**
- Create: `frontend/src/pages/exams/components/ExternalCandidateImport.tsx`
- Test: `frontend/src/pages/exams/components/ExternalCandidateImport.test.tsx`
- Modify: `frontend/src/pages/exams/students.tsx`

- [ ] **Step 1: Write failing component test**

Create `frontend/src/pages/exams/components/ExternalCandidateImport.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ExternalCandidateImport } from "./ExternalCandidateImport"

describe("ExternalCandidateImport", () => {
  it("renders header and import button", () => {
    render(
      <ExternalCandidateImport
        examId="00000000-0000-0000-0000-000000000001"
        onImported={() => {}}
      />
    )
    expect(screen.getByText(/外部候选人/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /添加候选人/i })).toBeInTheDocument()
  })

  it("validates phone before submit", async () => {
    render(
      <ExternalCandidateImport
        examId="00000000-0000-0000-0000-000000000001"
        onImported={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /添加候选人/i }))
    await waitFor(() => {
      expect(screen.getByText(/请填写姓名和手机号/)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
cd frontend && pnpm vitest run src/pages/exams/components/ExternalCandidateImport.test.tsx
```

Expected: FAIL — component missing.

- [ ] **Step 3: Implement component**

Create `frontend/src/pages/exams/components/ExternalCandidateImport.tsx`:

```tsx
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { apiClient } from "@/lib/api"

interface CandidateRow {
  full_name: string
  phone: string
  email?: string
}

interface Props {
  examId: string
  onImported: (urls: { invite_url: string; user_id: string }[]) => void
}

export function ExternalCandidateImport({ examId, onImported }: Props) {
  const [rows, setRows] = useState<CandidateRow[]>([{ full_name: "", phone: "" }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const updateRow = (i: number, patch: Partial<CandidateRow>) => {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  const addRow = () => setRows(prev => [...prev, { full_name: "", phone: "" }])
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))

  const submit = async () => {
    const valid = rows.filter(r => r.full_name.trim() && r.phone.trim())
    if (valid.length === 0) {
      setError("请填写姓名和手机号")
      return
    }
    setError(null); setSubmitting(true)
    try {
      const resp = await apiClient.post(
        `/api/exams/${examId}/invitations/bulk`, valid,
      )
      onImported(resp.data)
      toast({ title: `已发送邀请 ${resp.data.length} 条` })
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })
        .response?.data?.detail ?? "导入失败"
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">外部候选人</h3>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Input
              placeholder="姓名"
              value={r.full_name}
              onChange={e => updateRow(i, { full_name: e.target.value })}
            />
            <Input
              placeholder="手机号"
              value={r.phone}
              onChange={e => updateRow(i, { phone: e.target.value })}
            />
            <Input
              placeholder="邮箱(选填)"
              value={r.email ?? ""}
              onChange={e => updateRow(i, { email: e.target.value })}
            />
            <Button variant="ghost" onClick={() => removeRow(i)}>移除</Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={addRow}>新增一行</Button>
        <Button onClick={submit} disabled={submitting}>添加候选人</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
```

If the project's `apiClient` module is at a different path or named differently (e.g. `@/api/client`), inspect `frontend/src/lib/api.ts` and adjust the import.

- [ ] **Step 4: Run vitest**

```bash
cd frontend && pnpm vitest run src/pages/exams/components/ExternalCandidateImport.test.tsx
```

Expected: 2 PASS.

- [ ] **Step 5: Wire into students.tsx as a tab**

Edit `frontend/src/pages/exams/students.tsx`. Wrap existing content in a Tabs container; add a second tab visible only when current org is enterprise:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExternalCandidateImport } from "./components/ExternalCandidateImport"
import { useAuth } from "@/providers/auth"

// inside the component, where the existing student-picker UI lives, wrap it:
const { orgType } = useAuth()
return (
  <Tabs defaultValue="internal">
    <TabsList>
      <TabsTrigger value="internal">从系统选择 / 班级导入</TabsTrigger>
      {orgType === "enterprise" && (
        <TabsTrigger value="external">导入外部候选人</TabsTrigger>
      )}
    </TabsList>
    <TabsContent value="internal">
      {/* existing students-picker JSX */}
    </TabsContent>
    {orgType === "enterprise" && (
      <TabsContent value="external">
        <ExternalCandidateImport
          examId={examId}
          onImported={() => { /* refresh list */ }}
        />
      </TabsContent>
    )}
  </Tabs>
)
```

(If `useAuth` does not yet expose `orgType`, add it to the auth provider context — read the user's primary org type from `/api/auth/me`.)

- [ ] **Step 6: Run all frontend tests**

```bash
cd frontend && pnpm vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/exams/students.tsx \
        frontend/src/pages/exams/components/ExternalCandidateImport.tsx \
        frontend/src/pages/exams/components/ExternalCandidateImport.test.tsx
git commit -m "feat(frontend): external-candidate import tab on exam students page"
```

---

### Task 4.4: Invitation management Tab on exam detail

**Files:**
- Create: `frontend/src/pages/exams/components/InvitationManagement.tsx`
- Modify: `frontend/src/pages/exams/view.tsx`

- [ ] **Step 1: Implement component**

Create `frontend/src/pages/exams/components/InvitationManagement.tsx`:

```tsx
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { apiClient } from "@/lib/api"

interface Invitation {
  id: string
  user_id: string
  candidate_name: string
  candidate_phone: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

function statusLabel(inv: Invitation): string {
  if (inv.revoked_at) return "已作废"
  if (inv.used_at) return "已访问"
  if (new Date(inv.expires_at) < new Date()) return "已过期"
  return "已发送"
}

export function InvitationManagement({ examId }: { examId: string }) {
  const [items, setItems] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await apiClient.get<Invitation[]>(`/api/exams/${examId}/invitations`)
      setItems(r.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [examId])

  const revoke = async (id: string) => {
    await apiClient.delete(`/api/exams/${examId}/invitations/${id}`)
    toast({ title: "已作废" })
    await refresh()
  }

  if (loading) return <div className="text-sm text-muted-foreground">加载中…</div>
  if (items.length === 0) return <div className="text-sm text-muted-foreground">暂无邀请</div>

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left">
          <th className="py-2">姓名</th>
          <th>手机号</th>
          <th>状态</th>
          <th>到期</th>
          <th className="text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        {items.map(inv => (
          <tr key={inv.id} className="border-t">
            <td className="py-2">{inv.candidate_name}</td>
            <td>{inv.candidate_phone}</td>
            <td>{statusLabel(inv)}</td>
            <td>{new Date(inv.expires_at).toLocaleString()}</td>
            <td className="text-right">
              {!inv.revoked_at && (
                <Button variant="ghost" size="sm" onClick={() => revoke(inv.id)}>
                  作废
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 2: Wire into exam detail view**

Edit `frontend/src/pages/exams/view.tsx`. In the existing Tabs (or Tab-like control) on the exam detail page, add an "邀请记录" tab visible only for enterprise org:

```tsx
import { InvitationManagement } from "./components/InvitationManagement"
// ...
{orgType === "enterprise" && (
  <TabsContent value="invitations">
    <InvitationManagement examId={examId} />
  </TabsContent>
)}
```

And add the matching `<TabsTrigger value="invitations">邀请记录</TabsTrigger>`.

- [ ] **Step 3: Typecheck**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/exams/view.tsx \
        frontend/src/pages/exams/components/InvitationManagement.tsx
git commit -m "feat(frontend): invitation management tab on exam detail"
```

---

### Task 4.5: Workbench recruitment shortcut + push PR-4

**Files:**
- Modify: `frontend/src/pages/gwmx/workbench.tsx`

- [ ] **Step 1: Add the entry card**

Edit `frontend/src/pages/gwmx/workbench.tsx`. Locate the workbench card grid and add (within the loop or alongside existing cards):

```tsx
import { useAuth } from "@/providers/auth"
// ...
const { roles, orgType } = useAuth()
const showRecruitment = orgType === "enterprise" &&
  roles.some(r => ["evaluator", "enterprise_admin"].includes(r))

{showRecruitment && (
  <Link to="/exams?category=recruitment" className="...existing card classes...">
    <h3 className="font-semibold">招聘考试</h3>
    <p className="text-sm text-muted-foreground">发布招聘笔试，邀请候选人</p>
  </Link>
)}
```

- [ ] **Step 2: Run frontend build to confirm no type errors**

```bash
cd frontend && pnpm build
```

Expected: success.

- [ ] **Step 3: Commit and push**

```bash
git add frontend/src/pages/gwmx/workbench.tsx
git commit -m "feat(frontend): recruitment exam shortcut on enterprise workbench"
git push origin claude/zealous-jennings-eafc0d
```

Open PR titled `feat(frontend): HR external-candidate import and invitation management`.

---

## PR-5: Candidate Landing & Standalone Exam Entry

**Goal:** Standalone `/exam-invite/*` routes for external candidates: redeem token, take exam (reuse existing exam-taking component), thank-you page on submit. Hide app shell for external_guest.

### Task 5.1: Candidate landing page

**Files:**
- Create: `frontend/src/pages/exam-invite/landing.tsx`
- Test: `frontend/src/pages/exam-invite/landing.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/pages/exam-invite/landing.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { CandidateLanding } from "./landing"

vi.mock("@/lib/api", () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({
      data: {
        access_token: "jwt.token.here",
        exam_id: "11111111-1111-1111-1111-111111111111",
        candidate_name: "Cand A",
      },
    }),
  },
}))

describe("CandidateLanding", () => {
  it("redeems token from URL and shows welcome", async () => {
    render(
      <MemoryRouter initialEntries={["/exam-invite?token=abc123abc123abc123abc"]}>
        <CandidateLanding />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText(/Cand A/)).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: /开始考试/ })).toBeInTheDocument()
  })

  it("shows error on bad token", async () => {
    const { apiClient } = await import("@/lib/api")
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      response: { data: { detail: "Invitation revoked" } },
    })
    render(
      <MemoryRouter initialEntries={["/exam-invite?token=bad"]}>
        <CandidateLanding />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText(/Invitation revoked/)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
cd frontend && pnpm vitest run src/pages/exam-invite/landing.test.tsx
```

Expected: FAIL — component missing.

- [ ] **Step 3: Implement landing page**

Create `frontend/src/pages/exam-invite/landing.tsx`:

```tsx
import { useEffect, useState } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { apiClient } from "@/lib/api"
import { setGuestSession } from "./guest-session"

interface RedeemResponse {
  access_token: string
  exam_id: string
  candidate_name: string
}

export function CandidateLanding() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [state, setState] = useState<RedeemResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = params.get("token")
    if (!token) { setError("缺少邀请令牌"); return }
    apiClient
      .post<RedeemResponse>("/api/exam-invite/redeem", { token })
      .then(r => {
        setState(r.data)
        setGuestSession(r.data.access_token, r.data.exam_id)
      })
      .catch(e => {
        setError(e?.response?.data?.detail ?? "邀请无效或已过期")
      })
  }, [params])

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">无法进入考试</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </main>
    )
  }
  if (!state) {
    return <main className="p-6 text-sm">正在验证邀请…</main>
  }
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold">欢迎，{state.candidate_name}</h1>
        <p className="text-sm text-muted-foreground">
          请仔细阅读考试注意事项，准备好后点击开始。
        </p>
        <Button onClick={() => navigate(`/exam-invite/take/${state.exam_id}`)}>
          开始考试
        </Button>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Implement in-memory guest session**

Create `frontend/src/pages/exam-invite/guest-session.ts`:

```typescript
let token: string | null = null
let examId: string | null = null

export function setGuestSession(t: string, eid: string): void {
  token = t; examId = eid
}
export function getGuestToken(): string | null { return token }
export function getGuestExamId(): string | null { return examId }
export function clearGuestSession(): void { token = null; examId = null }
```

- [ ] **Step 5: Run test, expect pass**

```bash
cd frontend && pnpm vitest run src/pages/exam-invite/landing.test.tsx
```

Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/exam-invite/landing.tsx \
        frontend/src/pages/exam-invite/landing.test.tsx \
        frontend/src/pages/exam-invite/guest-session.ts
git commit -m "feat(frontend): candidate landing page redeems invitation token"
```

---

### Task 5.2: Standalone exam-take page for guest

**Files:**
- Create: `frontend/src/pages/exam-invite/take.tsx`

- [ ] **Step 1: Implement wrapper**

Create `frontend/src/pages/exam-invite/take.tsx`:

```tsx
import { useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ExamTakingPage } from "@/pages/student/exam-taking"
import { getGuestExamId, getGuestToken } from "./guest-session"

export function GuestExamTakePage() {
  const { examId } = useParams<{ examId: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!getGuestToken() || getGuestExamId() !== examId) {
      navigate("/exam-invite", { replace: true })
    }
  }, [examId, navigate])

  if (!examId) return null
  return <ExamTakingPage examIdOverride={examId} onSubmitted={() => navigate("/exam-invite/done")} />
}
```

If the existing `ExamTakingPage` doesn't accept `examIdOverride` / `onSubmitted` props, the minimal change in `frontend/src/pages/student/exam-taking.tsx` is to read examId from props with a fallback to `useParams()`, and accept an optional callback called on successful submit. Apply that change in this same task.

Also: the `apiClient` HTTP layer needs to attach the guest token instead of the regular session JWT when present. Edit `frontend/src/lib/api.ts` (or the file that creates the axios instance) to add an interceptor:

```typescript
import { getGuestToken } from "@/pages/exam-invite/guest-session"

apiClient.interceptors.request.use(config => {
  const guestToken = getGuestToken()
  if (guestToken && config.url?.includes("/api/exams/")) {
    config.headers.Authorization = `Bearer ${guestToken}`
  }
  return config
})
```

(Adjust import path / axios instance name as appropriate.)

- [ ] **Step 2: Typecheck**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/exam-invite/take.tsx \
        frontend/src/pages/student/exam-taking.tsx \
        frontend/src/lib/api.ts
git commit -m "feat(frontend): guest exam-take wraps existing component with token auth"
```

---

### Task 5.3: Thank-you page

**Files:**
- Create: `frontend/src/pages/exam-invite/done.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/pages/exam-invite/done.tsx`:

```tsx
import { useEffect } from "react"
import { clearGuestSession } from "./guest-session"

export function CandidateDonePage() {
  useEffect(() => { clearGuestSession() }, [])
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-semibold">已交卷</h1>
        <p className="text-sm text-muted-foreground">
          感谢您参与本次考试，结果将由招聘方审阅，无需在此页面等待。
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/exam-invite/done.tsx
git commit -m "feat(frontend): candidate post-submit thank-you page"
```

---

### Task 5.4: Mount routes + bypass app shell

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add the public routes**

Edit `frontend/src/App.tsx`. Inside `<Routes>`, before the protected routes, add:

```tsx
<Route path="/exam-invite" element={<CandidateLanding />} />
<Route path="/exam-invite/take/:examId" element={<GuestExamTakePage />} />
<Route path="/exam-invite/done" element={<CandidateDonePage />} />
```

And add the imports near the top:

```tsx
import { CandidateLanding } from "@/pages/exam-invite/landing"
import { GuestExamTakePage } from "@/pages/exam-invite/take"
import { CandidateDonePage } from "@/pages/exam-invite/done"
```

These routes are NOT wrapped in any auth guard or layout — they handle their own state via `guest-session`.

- [ ] **Step 2: Run frontend build**

```bash
cd frontend && pnpm build
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): mount /exam-invite/* public routes (no app shell)"
```

---

### Task 5.5: Playwright E2E flows

**Files:**
- Create: `frontend/e2e/recruitment-flow.spec.ts`
- Create: `frontend/e2e/candidate-flow.spec.ts`

- [ ] **Step 1: Recruitment flow**

Create `frontend/e2e/recruitment-flow.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

test("HR creates recruitment exam and imports external candidate", async ({ page }) => {
  await page.goto("/login")
  await page.fill('input[name="username"]', "hr1")
  await page.fill('input[name="password"]', "password")
  await page.click('button[type="submit"]')

  await page.goto("/exams/new")
  await page.fill('input[name="title"]', "E2E Recruit")
  // ... continue with the existing exam creation flow steps
  await page.click('button:has-text("保存")')

  // Navigate to students tab and open external import
  await page.click('button:has-text("考生")')
  await page.click('button:has-text("导入外部候选人")')
  await page.fill('input[placeholder="姓名"]', "Cand A")
  await page.fill('input[placeholder="手机号"]', "13800000001")
  await page.click('button:has-text("添加候选人")')

  await expect(page.getByText(/已发送邀请/)).toBeVisible()
})
```

(Adapt selectors to match actual rendered DOM — open the app and verify each step before committing.)

- [ ] **Step 2: Candidate flow**

Create `frontend/e2e/candidate-flow.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

test("candidate redeems invitation and reaches start screen", async ({ page, request }) => {
  // Use API request fixture to seed an invitation, then navigate to its URL.
  // Pre-condition: a fixture script ran prior to this suite to create exam + invitation.
  const inviteUrl = process.env.E2E_INVITE_URL!
  await page.goto(inviteUrl)
  await expect(page.getByRole("button", { name: /开始考试/ })).toBeVisible()
})
```

This test depends on a seeded invitation URL passed via env. Add a setup step in `playwright.config.ts` or a global-setup script that creates the invitation before tests run. The exact wiring is project-specific; document the env requirement clearly.

- [ ] **Step 3: Smoke regression for school side**

Create `frontend/e2e/regression-school.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

test("teacher can still publish an exam", async ({ page }) => {
  await page.goto("/login")
  await page.fill('input[name="username"]', "teacher1")
  await page.fill('input[name="password"]', "password")
  await page.click('button[type="submit"]')
  await expect(page.getByText(/我的考试|考试列表|题库/)).toBeVisible()
})

test("student can still see their exams", async ({ page }) => {
  await page.goto("/login")
  await page.fill('input[name="username"]', "student1")
  await page.fill('input[name="password"]', "password")
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/student/)
  await expect(page.getByText(/欢迎|我的考试/)).toBeVisible()
})
```

- [ ] **Step 4: Commit and push**

```bash
git add frontend/e2e/recruitment-flow.spec.ts \
        frontend/e2e/candidate-flow.spec.ts \
        frontend/e2e/regression-school.spec.ts
git commit -m "test(e2e): recruitment + candidate flows + school regression"
git push origin claude/zealous-jennings-eafc0d
```

Open the final PR titled `feat(frontend): standalone candidate exam entry`.

---

## Final Verification Checklist

Before declaring the feature complete, run through the full checklist on staging:

- [ ] All migrations applied cleanly (PR-1, PR-3 set)
- [ ] `cd backend && uv run pytest -x` ALL PASS
- [ ] `cd frontend && pnpm vitest run` ALL PASS
- [ ] `cd frontend && pnpm build` succeeds
- [ ] `cd frontend && pnpm playwright test` (or selected suites) PASS
- [ ] **Manual school regression:** teacher creates exam, student takes exam, school_admin lists classes — same as before
- [ ] **Manual enterprise smoke:**
  - enterprise_admin can now see exam menu items
  - HR (evaluator in enterprise org) can create an exam
  - HR imports 2 external candidates → emails / link copies work
  - Open invite URL in incognito → candidate landing → exam → submit → thank-you
  - HR sees the candidate's submission status update in invitation list
- [ ] Negative tests:
  - external_guest cannot login via `/login`
  - external_guest JWT cannot call `/api/users` or other admin endpoints
  - Revoked invitation URL returns "Invitation revoked"
  - Expired invitation URL returns "Invitation expired"

If all green: the multi-persona refactor and external-candidate flow are shipped.

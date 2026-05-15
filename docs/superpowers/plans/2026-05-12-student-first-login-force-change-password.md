# Student First Login Force-Change Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a student-only first-login password change flow that blocks student pages until a newly created or admin-reset student changes their password.

**Architecture:** Add a persistent `must_change_password` flag to auth users, expose it through login and `/me`, enforce it through a dedicated authenticated password-change endpoint, and gate student routes on the frontend using the returned user state. Existing students are migrated to `false`, while new/admin-reset student accounts set the flag to `true`.

**Tech Stack:** FastAPI, SQLAlchemy/Alembic, Refine auth provider, React Router, Vitest, pytest

---

## File Map

### Backend
- Create: `backend/alembic/versions/20260512_add_must_change_password_to_users.py` — schema migration for the new flag
- Modify: `backend/src/app/auth/models.py` — add `must_change_password` column to `User`
- Modify: `backend/src/app/auth/schemas.py` — expose flag in `UserResponse`; add force-change request schema
- Modify: `backend/src/app/auth/service.py` — set flag on create/reset flows and implement first-login password change service logic
- Modify: `backend/src/app/auth/router.py` — include flag in login response and add force-change-password endpoint
- Modify: `backend/src/app/auth/users_router.py` — re-arm the flag when admin resets a student password
- Test: `backend/tests/test_auth_force_change_password.py` — backend behavior coverage for create/login/force change/admin reset

### Frontend
- Modify: `frontend/src/types/index.ts` — add `must_change_password` to `IUser`
- Modify: `frontend/src/providers/auth-provider.ts` — redirect flagged students to force-change-password route and persist updated user state
- Modify: `frontend/src/App.tsx` — add the dedicated route and student route guard
- Create: `frontend/src/pages/auth/student-force-change-password.tsx` — minimal forced password change page for students
- Modify: `frontend/src/pages/auth/login.tsx` — keep current login flow intact; no major UX changes required
- Test: `frontend/src/providers/auth-provider.test.ts` — redirect and local user-state handling
- Test: `frontend/src/App.student-force-change-password.test.tsx` — route guarding behavior
- Test: `frontend/src/pages/auth/student-force-change-password.test.tsx` — form submit success/failure behavior

---

### Task 1: Add backend schema and service support

**Files:**
- Create: `backend/alembic/versions/20260512_add_must_change_password_to_users.py`
- Modify: `backend/src/app/auth/models.py`
- Modify: `backend/src/app/auth/schemas.py`
- Modify: `backend/src/app/auth/service.py`
- Test: `backend/tests/test_auth_force_change_password.py`

- [ ] **Step 1: Write the failing backend tests for the new flag and force-change service path**

```python
import uuid

import pytest
from sqlalchemy import select

from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.service import build_user_response, create_user, force_change_password_for_student
from app.rbac.models import Role


@pytest.mark.asyncio
async def test_create_student_sets_must_change_password_true(db_session):
    student_role = (await db_session.execute(select(Role).where(Role.name == "student"))).scalar_one()
    user = await create_user(
        db_session,
        UserCreate(
            username="student-new",
            email="student-new@example.com",
            password="init1234",
            full_name="New Student",
            role_name=student_role.name,
            persona="teacher",
        ),
    )
    await db_session.commit()
    assert user.must_change_password is True


@pytest.mark.asyncio
async def test_create_teacher_keeps_must_change_password_false(db_session):
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-new",
            email="teacher-new@example.com",
            password="init1234",
            full_name="New Teacher",
            role_name="teacher",
            persona="teacher",
        ),
    )
    await db_session.commit()
    assert teacher.must_change_password is False


@pytest.mark.asyncio
async def test_force_change_password_clears_student_flag(db_session, student_user):
    student_user.must_change_password = True
    await db_session.flush()

    updated = await force_change_password_for_student(db_session, student_user, "newpass123")

    assert updated.must_change_password is False


@pytest.mark.asyncio
async def test_user_response_includes_must_change_password(db_session, student_user):
    student_user.must_change_password = True
    await db_session.flush()

    response = await build_user_response(db_session, student_user)

    assert response.must_change_password is True
```

- [ ] **Step 2: Run the backend test file to verify it fails**

Run:
```bash
cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_auth_force_change_password.py -q
```

Expected: FAIL because `User.must_change_password`, `force_change_password_for_student`, and the response schema field do not exist yet.

- [ ] **Step 3: Add the database column and backend types**

```python
# backend/src/app/auth/models.py
must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

```python
# backend/src/app/auth/schemas.py
class UserResponse(BaseModel):
    ...
    must_change_password: bool = False


class ForceChangePasswordRequest(BaseModel):
    password: str
    confirm_password: str | None = None
```

```python
# backend/alembic/versions/20260512_add_must_change_password_to_users.py
from alembic import op
import sqlalchemy as sa

revision = "20260512_add_must_change_password_to_users"
down_revision = "<fill with current head>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=True, server_default=sa.false()))
    op.execute("UPDATE users SET must_change_password = false WHERE must_change_password IS NULL")
    op.alter_column("users", "must_change_password", nullable=False, server_default=sa.false())


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
```

- [ ] **Step 4: Implement minimal service logic**

```python
# backend/src/app/auth/service.py
from fastapi import HTTPException, status


def _should_force_student_change_password(role_names: list[str]) -> bool:
    return "student" in role_names


async def create_user(db: AsyncSession, data: UserCreate) -> User:
    ...
    role_names = data.role_names if data.role_names else [data.role_name]
    user = User(
        ...,
        must_change_password=_should_force_student_change_password(role_names),
    )
    ...


async def force_change_password_for_student(db: AsyncSession, user: User, password: str) -> User:
    if len(password) < 6:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="密码至少需要6位")
    user.password_hash = hash_password(password)
    user.must_change_password = False
    await db.flush()
    await db.refresh(user)
    return user
```

- [ ] **Step 5: Run the backend test file to verify it passes**

Run:
```bash
cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_auth_force_change_password.py -q
```

Expected: PASS for the schema/service-level tests.

- [ ] **Step 6: Commit backend schema/service groundwork**

```bash
git add backend/alembic/versions/20260512_add_must_change_password_to_users.py backend/src/app/auth/models.py backend/src/app/auth/schemas.py backend/src/app/auth/service.py backend/tests/test_auth_force_change_password.py
git commit -m "feat: add student password change flag"
```

---

### Task 2: Add login response, force-change endpoint, and admin reset behavior

**Files:**
- Modify: `backend/src/app/auth/router.py`
- Modify: `backend/src/app/auth/users_router.py`
- Modify: `backend/tests/test_auth_force_change_password.py`

- [ ] **Step 1: Extend backend tests to cover endpoint and admin reset behavior**

```python
@pytest.mark.asyncio
async def test_login_response_includes_force_change_flag(client, student_user):
    student_user.must_change_password = True
    ...
    response = await client.post("/api/auth/login", json={"username": student_user.username, "password": "student123"})
    assert response.status_code == 200
    assert response.json()["user"]["must_change_password"] is True


@pytest.mark.asyncio
async def test_force_change_password_endpoint_clears_flag(authenticated_student_client, student_user):
    student_user.must_change_password = True
    response = await authenticated_student_client.post(
        "/api/auth/force-change-password",
        json={"password": "newpass123", "confirm_password": "newpass123"},
    )
    assert response.status_code == 200
    assert response.json()["user"]["must_change_password"] is False


@pytest.mark.asyncio
async def test_force_change_password_rejects_non_student(authenticated_teacher_client):
    response = await authenticated_teacher_client.post(
        "/api/auth/force-change-password",
        json={"password": "newpass123", "confirm_password": "newpass123"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_password_reset_rearms_student_flag(admin_client, student_user):
    response = await admin_client.put(
        f"/api/users/{student_user.id}",
        json={"password": "reset1234"},
    )
    assert response.status_code == 200
    assert response.json()["must_change_password"] is True
```

- [ ] **Step 2: Run the backend test file to verify it fails on missing endpoint behavior**

Run:
```bash
cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_auth_force_change_password.py -q
```

Expected: FAIL because `/api/auth/force-change-password` does not exist yet and login/admin responses do not include the right behavior.

- [ ] **Step 3: Implement the auth endpoint and login payload support**

```python
# backend/src/app/auth/router.py
from app.auth.schemas import ForceChangePasswordRequest
from app.auth.service import force_change_password_for_student

@router.post("/force-change-password", response_model=TokenResponse | UserResponse)
async def force_change_password(
    data: ForceChangePasswordRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if data.confirm_password is not None and data.password != data.confirm_password:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="两次输入的密码不一致")
    user_response = await build_user_response(db, user)
    role_names = {org.role_name for org in user_response.organizations}
    if "student" not in role_names:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅学生账号需要执行首次改密")
    if not user.must_change_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前账号无需首次改密")
    updated_user = await force_change_password_for_student(db, user, data.password)
    return {"message": "密码修改成功", "user": await build_user_response(db, updated_user)}
```

Keep `/login` as-is structurally, but rely on the updated `UserResponse` to surface the flag in `TokenResponse`.

- [ ] **Step 4: Re-arm the flag during admin student password reset**

```python
# backend/src/app/auth/users_router.py
if data.password is not None and data.password:
    user.password_hash = hash_password(data.password)
    effective_role_names = data.role_names if data.role_names is not None else [org.role_name for org in (await build_user_response(db, user)).organizations]
    if "student" in effective_role_names:
        user.must_change_password = True
```

Prefer extracting `effective_role_names` once so the logic is not duplicated.

- [ ] **Step 5: Run the backend auth test file and a focused auth suite**

Run:
```bash
cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_auth_force_change_password.py tests/test_auth_router.py -q
```

Expected: PASS for login response, forced-change endpoint, and admin reset behavior.

- [ ] **Step 6: Commit backend endpoint/admin reset changes**

```bash
git add backend/src/app/auth/router.py backend/src/app/auth/users_router.py backend/tests/test_auth_force_change_password.py
git commit -m "feat: enforce student first login password change"
```

---

### Task 3: Add frontend auth state and student route guard

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/providers/auth-provider.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/providers/auth-provider.test.ts`
- Test: `frontend/src/App.student-force-change-password.test.tsx`

- [ ] **Step 1: Write failing frontend tests for redirect and route guarding**

```tsx
it("redirects flagged student logins to the force-change-password route", async () => {
  axios.post.mockResolvedValue({
    data: {
      access_token: "token",
      user: { ...studentUser, must_change_password: true },
    },
  });

  const result = await authProvider.login({ username: "student", password: "student123" });

  expect(result.redirectTo).toBe("/student/force-change-password");
});

it("redirects flagged students away from protected student routes", async () => {
  localStorage.setItem("access_token", "token");
  localStorage.setItem("user", JSON.stringify({ ...studentUser, must_change_password: true }));

  render(<AppWithStudentRoute initialEntry="/student" />);

  expect(screen.getByRole("heading", { name: /首次登录，请先修改密码/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run:
```bash
cd frontend && CI=1 pnpm exec vitest run src/providers/auth-provider.test.ts src/App.student-force-change-password.test.tsx --reporter=verbose
```

Expected: FAIL because the user type lacks the flag and there is no redirect/guard yet.

- [ ] **Step 3: Implement the auth state and route guard**

```ts
// frontend/src/types/index.ts
export interface IUser {
  ...
  must_change_password: boolean;
}
```

```ts
// frontend/src/providers/auth-provider.ts
if (data.user.primary_org?.role_name === "student" && data.user.must_change_password) {
  return { success: true, redirectTo: "/student/force-change-password" };
}
```

```tsx
// frontend/src/App.tsx
function StudentForcePasswordGuard() {
  const { data: identity, isLoading } = useGetIdentity<IUser>();
  if (isLoading) return null;
  const role = identity ? getUserRole(identity) : "";
  const mustChange = role === "student" && identity?.must_change_password;
  const location = useLocation();
  if (mustChange && location.pathname !== "/student/force-change-password") {
    return <Navigate to="/student/force-change-password" replace />;
  }
  return <Outlet />;
}
```

Wrap student routes and the exam-taking route with this guard so all student business pages are blocked until password change completes.

- [ ] **Step 4: Run the frontend tests and type-check**

Run:
```bash
cd frontend && CI=1 pnpm exec vitest run src/providers/auth-provider.test.ts src/App.student-force-change-password.test.tsx --reporter=verbose
cd frontend && pnpm exec tsc --noEmit --pretty false
```

Expected: PASS for redirect and guarding, and TypeScript stays clean.

- [ ] **Step 5: Commit auth provider and route guard changes**

```bash
git add frontend/src/types/index.ts frontend/src/providers/auth-provider.ts frontend/src/App.tsx frontend/src/providers/auth-provider.test.ts frontend/src/App.student-force-change-password.test.tsx
git commit -m "feat: guard student routes until password change"
```

---

### Task 4: Add the student force-change-password page and success flow

**Files:**
- Create: `frontend/src/pages/auth/student-force-change-password.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/providers/auth-provider.ts`
- Test: `frontend/src/pages/auth/student-force-change-password.test.tsx`

- [ ] **Step 1: Write failing UI tests for the dedicated page**

```tsx
it("submits a new password and updates the local user state", async () => {
  axios.post.mockResolvedValue({
    data: {
      message: "密码修改成功",
      user: { ...studentUser, must_change_password: false },
    },
  });

  render(<StudentForceChangePasswordPage />);

  await user.type(screen.getByLabelText("新密码"), "newpass123");
  await user.type(screen.getByLabelText("确认密码"), "newpass123");
  await user.click(screen.getByRole("button", { name: "确认修改" }));

  await waitFor(() => {
    expect(localStorage.getItem("user")).toContain('"must_change_password":false');
  });
});
```

- [ ] **Step 2: Run the page test to verify it fails**

Run:
```bash
cd frontend && CI=1 pnpm exec vitest run src/pages/auth/student-force-change-password.test.tsx --reporter=verbose
```

Expected: FAIL because the page does not exist yet.

- [ ] **Step 3: Implement the minimal page and success handling**

```tsx
// frontend/src/pages/auth/student-force-change-password.tsx
export function StudentForceChangePasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 6) return setError("密码至少需要6位");
    if (password !== confirmPassword) return setError("两次输入的密码不一致");
    setSubmitting(true);
    try {
      const { data } = await axios.post("/api/auth/force-change-password", {
        password,
        confirm_password: confirmPassword,
      });
      localStorage.setItem("user", JSON.stringify(data.user));
      navigate("/student", { replace: true });
    } catch (err) {
      setError(resolveErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (...minimal form...);
}
```

The page should use the existing auth shell style where practical, but must avoid showing unrelated student navigation.

- [ ] **Step 4: Wire the route and rerun tests**

Run:
```bash
cd frontend && CI=1 pnpm exec vitest run src/pages/auth/student-force-change-password.test.tsx src/App.student-force-change-password.test.tsx --reporter=verbose
cd frontend && pnpm exec tsc --noEmit --pretty false
```

Expected: PASS for the page submit flow and guarded redirect behavior.

- [ ] **Step 5: Commit the force-change-password page**

```bash
git add frontend/src/pages/auth/student-force-change-password.tsx frontend/src/pages/auth/student-force-change-password.test.tsx frontend/src/App.tsx frontend/src/providers/auth-provider.ts
git commit -m "feat: add student force password change page"
```

---

### Task 5: Full verification and documentation sync

**Files:**
- Modify: `docs/superpowers/specs/2026-05-12-student-first-login-force-change-password-design.md` (only if implementation reveals a needed clarification)
- Modify: `docs/superpowers/plans/2026-05-12-student-first-login-force-change-password.md` (check off steps during execution if desired)

- [ ] **Step 1: Run backend verification suite**

Run:
```bash
cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_auth_force_change_password.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend verification suite**

Run:
```bash
cd frontend && CI=1 pnpm exec vitest run src/providers/auth-provider.test.ts src/App.student-force-change-password.test.tsx src/pages/auth/student-force-change-password.test.tsx --reporter=verbose
```

Expected: PASS.

- [ ] **Step 3: Run project-level type checks for touched app layers**

Run:
```bash
cd frontend && pnpm exec tsc --noEmit --pretty false
cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m compileall src/app/auth
```

Expected: PASS without type or syntax errors.

- [ ] **Step 4: Review docs for drift and update only if implementation differed from the spec**

```md
If implementation matched spec, no doc edits are required.
If implementation forced a small change (for example, exact route path naming), update the spec to match reality before finishing.
```

- [ ] **Step 5: Commit final verification pass**

```bash
git add docs/superpowers/specs/2026-05-12-student-first-login-force-change-password-design.md docs/superpowers/plans/2026-05-12-student-first-login-force-change-password.md
git commit -m "docs: finalize student first login password change plan"
```

---

## Self-Review

- **Spec coverage:** covered data model, new student default behavior, existing student migration default, login response, dedicated endpoint, admin reset behavior, frontend redirect, route guard, dedicated page, and test coverage.
- **Placeholder scan:** removed TODO/TBD markers; only the Alembic `down_revision` needs to be filled using the current repo head during implementation.
- **Type consistency:** uses a single field name `must_change_password` across model, schema, API, frontend user type, and route guard.

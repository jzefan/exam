# Multi-Teacher Student Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support one student profile being associated with multiple teachers while keeping exams, answer sheets, and results private to the creating teacher.

**Architecture:** Add a `teacher_students` association table as the new source of truth for teacher-student visibility, migrate legacy `owner_teacher_id` data into it, then switch student reads, writes, and admin editing to the association model. Keep `users.owner_teacher_id` for compatibility during rollout but stop depending on it for permission checks.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Alembic, React, Refine, shadcn/ui, Vitest, pytest

---

### Task 1: Add association persistence

**Files:**
- Create: `backend/alembic/versions/20260411_teacher_students_association.py`
- Modify: `backend/src/app/rbac/models.py`
- Modify: `backend/src/app/auth/models.py`
- Test: `backend/tests/test_teacher_student_association.py`

- [ ] **Step 1: Write the failing backend tests**

```python
@pytest.mark.asyncio
async def test_teacher_student_association_migrates_owner_teacher_links(client: AsyncClient, db_session):
    ...
    associations = await db_session.execute(
        select(TeacherStudent).where(TeacherStudent.teacher_id == teacher.id)
    )
    assert [row.student_id for row in associations.scalars().all()] == [student.id]


@pytest.mark.asyncio
async def test_teacher_student_unique_constraint_prevents_duplicate_links(db_session):
    ...
    db_session.add(TeacherStudent(teacher_id=teacher.id, student_id=student.id))
    await db_session.flush()
    db_session.add(TeacherStudent(teacher_id=teacher.id, student_id=student.id))
    with pytest.raises(IntegrityError):
        await db_session.flush()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_teacher_student_association.py -q`
Expected: FAIL because `TeacherStudent` model and migration do not exist yet.

- [ ] **Step 3: Add the new table and ORM model**

```python
class TeacherStudent(Base, TimestampMixin):
    __tablename__ = "teacher_students"

    teacher_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )

    teacher: Mapped["app.auth.models.User"] = relationship(
        "User", foreign_keys=[teacher_id], lazy="joined"
    )
    student: Mapped["app.auth.models.User"] = relationship(
        "User", foreign_keys=[student_id], lazy="joined"
    )
```

```python
def upgrade() -> None:
    op.create_table(
        "teacher_students",
        sa.Column("teacher_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("teacher_id", "student_id"),
    )
    op.execute(
        """
        INSERT INTO teacher_students (teacher_id, student_id, created_at, updated_at)
        SELECT owner_teacher_id, id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM users
        WHERE owner_teacher_id IS NOT NULL
        ON CONFLICT (teacher_id, student_id) DO NOTHING
        """
    )
```

- [ ] **Step 4: Run tests and migration verification**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run alembic upgrade head`
Expected: migration applies cleanly and creates `teacher_students`.

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_teacher_student_association.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/20260411_teacher_students_association.py backend/src/app/rbac/models.py backend/src/app/auth/models.py backend/tests/test_teacher_student_association.py
git commit -m "feat: add teacher student associations"
```

### Task 2: Switch teacher student visibility reads

**Files:**
- Modify: `backend/src/app/rbac/service.py`
- Modify: `backend/src/app/rbac/students_router.py`
- Modify: `backend/src/app/analytics/router.py`
- Modify: `backend/src/app/auth/service.py`
- Test: `backend/tests/test_student_teacher_scope.py`
- Test: `backend/tests/test_dashboard_stats_scope.py`
- Test: `backend/tests/test_user_management_metadata.py`

- [ ] **Step 1: Write the failing read-path tests**

```python
@pytest.mark.asyncio
async def test_teacher_sees_student_when_associated_through_teacher_students(...):
    ...
    response = await client.get("/api/rbac/students")
    assert [item["id"] for item in response.json()] == [student.id]


@pytest.mark.asyncio
async def test_teacher_dashboard_counts_associated_students_only(...):
    ...
    response = await client.get("/api/analytics/dashboard-stats")
    assert response.json()["total_students"] == 2
```

- [ ] **Step 2: Run tests to verify current failures**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_student_teacher_scope.py tests/test_dashboard_stats_scope.py tests/test_user_management_metadata.py -q`
Expected: FAIL because reads still depend on `owner_teacher_id`.

- [ ] **Step 3: Move read queries to the association table**

```python
async def list_teacher_students(...):
    query = (
        select(User)
        .join(TeacherStudent, TeacherStudent.student_id == User.id)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(
            TeacherStudent.teacher_id == teacher_id,
            UserOrganization.org_id == org_id,
            Role.name == "student",
            User.deleted_at.is_(None),
        )
    )
```

```python
managed_student_count = (
    await db.execute(
        select(func.count())
        .select_from(TeacherStudent)
        .where(TeacherStudent.teacher_id == user.id)
    )
).scalar_one()
```

- [ ] **Step 4: Run read-path tests**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_student_teacher_scope.py tests/test_dashboard_stats_scope.py tests/test_user_management_metadata.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/rbac/service.py backend/src/app/rbac/students_router.py backend/src/app/analytics/router.py backend/src/app/auth/service.py backend/tests/test_student_teacher_scope.py backend/tests/test_dashboard_stats_scope.py backend/tests/test_user_management_metadata.py
git commit -m "refactor: read student access from associations"
```

### Task 3: Switch student creation and import to reuse existing students

**Files:**
- Modify: `backend/src/app/rbac/service.py`
- Modify: `backend/src/app/rbac/students_router.py`
- Test: `backend/tests/test_teacher_student_association.py`

- [ ] **Step 1: Write the failing creation/import tests**

```python
@pytest.mark.asyncio
async def test_teacher_add_student_reuses_existing_student_by_phone(...):
    ...
    response = await client.post("/api/rbac/students", json=payload)
    assert response.status_code == 201
    assert response.json()["id"] == str(existing_student.id)


@pytest.mark.asyncio
async def test_batch_import_links_existing_student_instead_of_failing(...):
    ...
    response = await client.post("/api/rbac/students/batch", json=[payload])
    assert response.json()["success_count"] == 1
    assert response.json()["failed_count"] == 0
```

- [ ] **Step 2: Run tests to verify failures**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_teacher_student_association.py -q`
Expected: FAIL because existing phone numbers currently hard-fail.

- [ ] **Step 3: Implement student reuse and association writes**

```python
async def ensure_teacher_student_link(db: AsyncSession, teacher_id: uuid.UUID, student_id: uuid.UUID) -> bool:
    existing = await db.get(TeacherStudent, {"teacher_id": teacher_id, "student_id": student_id})
    if existing is not None:
        return False
    db.add(TeacherStudent(teacher_id=teacher_id, student_id=student_id))
    await db.flush()
    return True
```

```python
async def create_or_link_student(...):
    existing_student = await find_student_by_phone(db, data.phone)
    if existing_student is None:
        student = await create_student_profile(...)
    else:
        student = existing_student
    linked = await ensure_teacher_student_link(db, teacher_id, student.id)
    return student, linked, existing_student is None
```

- [ ] **Step 4: Run creation/import tests**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_teacher_student_association.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/rbac/service.py backend/src/app/rbac/students_router.py backend/tests/test_teacher_student_association.py
git commit -m "feat: reuse students across teachers"
```

### Task 4: Let platform admins manage multiple associated teachers

**Files:**
- Modify: `backend/src/app/auth/schemas.py`
- Modify: `backend/src/app/auth/service.py`
- Modify: `backend/src/app/auth/users_router.py`
- Test: `backend/tests/test_user_management_metadata.py`

- [ ] **Step 1: Write the failing admin API tests**

```python
@pytest.mark.asyncio
async def test_user_response_includes_teacher_ids_for_student(...):
    ...
    assert set(response.json()["teacher_ids"]) == {str(teacher_a.id), str(teacher_b.id)}


@pytest.mark.asyncio
async def test_platform_admin_can_replace_student_teacher_links(...):
    ...
    response = await client.put(f"/api/users/{student.id}", json={"teacher_ids": [str(teacher_b.id)]})
    assert set(response.json()["teacher_ids"]) == {str(teacher_b.id)}
```

- [ ] **Step 2: Run tests to verify failures**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_user_management_metadata.py -q`
Expected: FAIL because user payload only supports a single `owner_teacher_id`.

- [ ] **Step 3: Change student-teacher admin payloads**

```python
class UserResponse(BaseModel):
    ...
    teacher_ids: list[uuid.UUID] = []
    teacher_names: list[str] = []


class UserUpdate(BaseModel):
    ...
    teacher_ids: list[uuid.UUID] | None = None
```

```python
if "student" in effective_role_names and data.teacher_ids is not None:
    await replace_student_teacher_links(db, student_id=user.id, teacher_ids=data.teacher_ids)
```

- [ ] **Step 4: Run admin API tests**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_user_management_metadata.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/auth/schemas.py backend/src/app/auth/service.py backend/src/app/auth/users_router.py backend/tests/test_user_management_metadata.py
git commit -m "feat: manage student teacher links from admin users api"
```

### Task 5: Update admin UI and student UI for multi-teacher associations

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/pages/admin/users/user-form.tsx`
- Modify: `frontend/src/pages/admin/users/create.tsx`
- Modify: `frontend/src/pages/admin/users/edit.tsx`
- Modify: `frontend/src/pages/admin/users/list.tsx`
- Test: `frontend/src/pages/admin/users/list.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

```tsx
it("shows all associated teachers in student business summary", async () => {
  render(<UserList />)
  expect(await screen.findByText("教师 A、教师 B")).toBeInTheDocument()
})

it("submits multi-select teacher ids for student form", async () => {
  ...
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
    teacher_ids: ["teacher-a", "teacher-b"],
  }))
})
```

- [ ] **Step 2: Run tests to verify failures**

Run: `cd frontend && npx vitest run src/pages/admin/users/list.test.tsx`
Expected: FAIL because the UI only knows about `owner_teacher_id`.

- [ ] **Step 3: Change UI to multi-teacher editing and display**

```tsx
type UserFormData = {
  ...
  teacher_ids: string[]
}

{isStudent && (
  <TeacherMultiSelect
    value={form.teacher_ids}
    onChange={(teacherIds) => updateField("teacher_ids", teacherIds)}
  />
)}
```

```tsx
function describeUser(user: IUser): string {
  if (getUserRole(user) === "student") {
    return user.teacher_names.length > 0 ? user.teacher_names.join("、") : "未关联教师"
  }
  ...
}
```

- [ ] **Step 4: Run UI verification**

Run: `cd frontend && npx vitest run src/pages/admin/users/list.test.tsx`
Expected: PASS

Run: `cd frontend && npx eslint src/pages/admin/users/list.tsx src/pages/admin/users/user-form.tsx src/pages/admin/users/create.tsx src/pages/admin/users/edit.tsx src/types/index.ts`
Expected: PASS

Run: `cd frontend && npx tsc --noEmit --pretty false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/admin/users/user-form.tsx frontend/src/pages/admin/users/create.tsx frontend/src/pages/admin/users/edit.tsx frontend/src/pages/admin/users/list.tsx frontend/src/pages/admin/users/list.test.tsx
git commit -m "feat: show and edit multiple teachers per student"
```

### Task 6: Final regression sweep

**Files:**
- Modify as needed: files from Tasks 1-5

- [ ] **Step 1: Run backend regression commands**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/test_teacher_student_association.py tests/test_student_teacher_scope.py tests/test_dashboard_stats_scope.py tests/test_user_management_metadata.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend regression commands**

Run: `cd frontend && npx vitest run src/pages/admin/users/list.test.tsx src/pages/dashboard.test.tsx`
Expected: PASS

Run: `cd frontend && npx tsc --noEmit --pretty false`
Expected: PASS

Run: `cd frontend && npx eslint src/pages/admin/users/list.tsx src/pages/admin/users/user-form.tsx src/pages/admin/users/create.tsx src/pages/admin/users/edit.tsx src/types/index.ts`
Expected: PASS

- [ ] **Step 3: Run build and migration sanity checks**

Run: `cd frontend && npm run build`
Expected: PASS

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run alembic current`
Expected: current revision is `20260411_teacher_students_association` or newer.

- [ ] **Step 4: Fix any regressions and re-run the relevant command**

```text
If a regression appears, patch only the failing path, then re-run the exact failed command before moving on.
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: complete multi-teacher student association rollout"
```

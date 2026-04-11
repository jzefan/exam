# Teacher Data Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为教师侧题库、知识点、题目、考试、学生接入统一的数据归属与可见性规则，确保默认私有，且只有题库与知识点支持平台公开。

**Architecture:** 在后端引入统一的资源归属字段 `owner_id` 和共享字段 `visibility`，并将数据权限收口到查询过滤与写操作校验中。优先改造模型、迁移和 service/router 层，再补测试与前端只读态，避免出现前端先放开而后端未收口的短暂越权窗口。

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Alembic, pytest, React, TypeScript

---

### Task 1: Add Shared Ownership Primitives

**Files:**
- Create: `backend/alembic/versions/20260411_teacher_data_visibility_primitives.py`
- Create: `backend/src/app/common/data_visibility.py`
- Modify: `backend/src/app/questions/models.py`
- Modify: `backend/src/app/learning/models.py`
- Modify: `backend/src/app/exams/models.py`
- Test: `backend/tests/test_teacher_data_visibility_primitives.py`

- [ ] **Step 1: Write the failing migration/model test**

```python
import pytest
from sqlalchemy import inspect


@pytest.mark.asyncio
async def test_visibility_primitives_exist(async_engine) -> None:
    async with async_engine.begin() as conn:
        table_names = await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
        assert "question_banks" in table_names

        columns = await conn.run_sync(
            lambda sync_conn: {col["name"] for col in inspect(sync_conn).get_columns("question_banks")}
        )
        assert "owner_id" in columns
        assert "visibility" in columns
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_teacher_data_visibility_primitives.py -v`
Expected: FAIL because `owner_id` / `visibility` columns do not exist yet

- [ ] **Step 3: Add the model primitives**

```python
# backend/src/app/common/data_visibility.py
import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column


class VisibilityScope(str, enum.Enum):
    PRIVATE = "private"
    PLATFORM = "platform"


class OwnerMixin:
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)


class VisibilityMixin:
    visibility: Mapped[VisibilityScope] = mapped_column(
        Enum(VisibilityScope),
        nullable=False,
        default=VisibilityScope.PRIVATE,
        server_default=VisibilityScope.PRIVATE.value,
    )
```
```

- [ ] **Step 4: Apply the primitives to models**

```python
# backend/src/app/questions/models.py
from app.common.data_visibility import OwnerMixin, VisibilityMixin


class QuestionBank(OwnerMixin, VisibilityMixin, BaseModel):
    ...


class Question(OwnerMixin, BaseModel):
    ...


# backend/src/app/learning/models.py
class KnowledgePoint(OwnerMixin, VisibilityMixin, BaseModel):
    ...


# backend/src/app/exams/models.py
class Exam(OwnerMixin, BaseModel):
    ...
```

- [ ] **Step 5: Add the Alembic migration**

```python
def upgrade() -> None:
    op.add_column("question_banks", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.add_column(
        "question_banks",
        sa.Column("visibility", sa.Enum("private", "platform", name="visibilityscope"), nullable=False, server_default="private"),
    )
    op.add_column("questions", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.add_column("knowledge_points", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.add_column(
        "knowledge_points",
        sa.Column("visibility", sa.Enum("private", "platform", name="visibilityscope"), nullable=False, server_default="private"),
    )
    op.add_column("exams", sa.Column("owner_id", sa.Uuid(), nullable=True))
```

- [ ] **Step 6: Backfill and tighten nullability in the migration**

```python
def upgrade() -> None:
    ...
    op.execute("UPDATE questions SET owner_id = created_by WHERE owner_id IS NULL")
    op.execute("UPDATE exams SET owner_id = created_by WHERE owner_id IS NULL")
    op.execute("UPDATE question_banks SET visibility = 'private' WHERE visibility IS NULL")
    op.execute("UPDATE knowledge_points SET visibility = 'private' WHERE visibility IS NULL")
    op.alter_column("questions", "owner_id", nullable=False)
    op.alter_column("exams", "owner_id", nullable=False)
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_teacher_data_visibility_primitives.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions backend/src/app/common/data_visibility.py backend/src/app/questions/models.py backend/src/app/learning/models.py backend/src/app/exams/models.py backend/tests/test_teacher_data_visibility_primitives.py
git commit -m "feat: add teacher visibility ownership primitives"
```

### Task 2: Centralize Resource Visibility Rules

**Files:**
- Create: `backend/src/app/common/resource_access.py`
- Test: `backend/tests/test_resource_access.py`

- [ ] **Step 1: Write the failing rule tests**

```python
from app.common.data_visibility import VisibilityScope
from app.common.resource_access import can_read_shared_resource, can_write_owned_resource


def test_teacher_can_read_platform_visible_resource() -> None:
    assert can_read_shared_resource(
        is_platform_admin=False,
        current_user_id="teacher-a",
        owner_id="teacher-b",
        visibility=VisibilityScope.PLATFORM,
    ) is True


def test_teacher_cannot_write_other_teachers_platform_resource() -> None:
    assert can_write_owned_resource(
        is_platform_admin=False,
        current_user_id="teacher-a",
        owner_id="teacher-b",
    ) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_resource_access.py -v`
Expected: FAIL because helper module does not exist yet

- [ ] **Step 3: Implement the shared access helpers**

```python
from app.common.data_visibility import VisibilityScope


def can_read_shared_resource(*, is_platform_admin: bool, current_user_id: str, owner_id: str, visibility: VisibilityScope) -> bool:
    if is_platform_admin:
        return True
    if current_user_id == owner_id:
        return True
    return visibility == VisibilityScope.PLATFORM


def can_write_owned_resource(*, is_platform_admin: bool, current_user_id: str, owner_id: str) -> bool:
    return is_platform_admin or current_user_id == owner_id
```

- [ ] **Step 4: Add query helpers for SQLAlchemy filters**

```python
from sqlalchemy import or_


def visible_to_teacher(model, user_id):
    return or_(model.owner_id == user_id, model.visibility == VisibilityScope.PLATFORM)


def owned_by_teacher(model, user_id):
    return model.owner_id == user_id
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_resource_access.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/common/resource_access.py backend/tests/test_resource_access.py
git commit -m "feat: centralize teacher resource access rules"
```

### Task 3: Scope Question Banks and Questions

**Files:**
- Modify: `backend/src/app/questions/service.py`
- Modify: `backend/src/app/questions/router.py`
- Modify: `backend/src/app/questions/schemas.py`
- Test: `backend/tests/test_question_filters.py`
- Test: `backend/tests/test_question_bank_visibility.py`

- [ ] **Step 1: Write the failing question visibility tests**

```python
@pytest.mark.asyncio
async def test_teacher_sees_own_and_platform_banks_only(teacher_client, db_session, teacher_user, other_teacher_user):
    own_bank = QuestionBank(name="我的题库", owner_id=teacher_user.id, visibility="private")
    public_bank = QuestionBank(name="公开题库", owner_id=other_teacher_user.id, visibility="platform")
    private_bank = QuestionBank(name="他人私有题库", owner_id=other_teacher_user.id, visibility="private")
    db_session.add_all([own_bank, public_bank, private_bank])
    await db_session.commit()

    response = await teacher_client.get("/api/question-banks")

    assert response.status_code == 200
    names = [item["name"] for item in response.json()]
    assert names == ["公开题库", "我的题库"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_bank_visibility.py tests/test_question_filters.py -v`
Expected: FAIL because current services return all banks/questions

- [ ] **Step 3: Scope list queries in the service layer**

```python
async def list_question_banks(db: AsyncSession, *, user: User, is_platform_admin: bool) -> tuple[list[dict], int]:
    stmt = select(QuestionBank, func.coalesce(count_subq.c.cnt, 0).label("question_count")).where(QuestionBank.deleted_at.is_(None))
    if not is_platform_admin:
        stmt = stmt.where(visible_to_teacher(QuestionBank, user.id))
```

- [ ] **Step 4: Scope question queries and set owner on create**

```python
def _question_base_query(*, user: User, is_platform_admin: bool) -> Select:
    query = select(Question).where(Question.deleted_at.is_(None))
    if not is_platform_admin:
        query = query.outerjoin(QuestionBank).where(
            or_(
                Question.owner_id == user.id,
                and_(
                    Question.question_bank_id.is_not(None),
                    QuestionBank.visibility == VisibilityScope.PLATFORM,
                ),
            )
        )
    return query


question = Question(..., created_by=user_id, owner_id=user_id, ...)
```

- [ ] **Step 5: Add write guards to question/question bank routes**

```python
if not can_write_owned_resource(is_platform_admin=is_admin, current_user_id=str(user.id), owner_id=str(question.owner_id)):
    raise HTTPException(status_code=403, detail="No permission to modify this question")
```

- [ ] **Step 6: Expose visibility/owner fields in responses**

```python
class QuestionBankResponse(BaseModel):
    ...
    owner_id: uuid.UUID
    visibility: str


class QuestionResponse(BaseModel):
    ...
    owner_id: uuid.UUID
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_bank_visibility.py tests/test_question_filters.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/src/app/questions/service.py backend/src/app/questions/router.py backend/src/app/questions/schemas.py backend/tests/test_question_bank_visibility.py backend/tests/test_question_filters.py
git commit -m "feat: enforce teacher visibility for questions and banks"
```

### Task 4: Scope Knowledge Points

**Files:**
- Modify: `backend/src/app/learning/service.py`
- Modify: `backend/src/app/learning/router.py`
- Modify: `backend/src/app/learning/schemas.py`
- Test: `backend/tests/test_learning_visibility.py`

- [ ] **Step 1: Write the failing knowledge visibility tests**

```python
@pytest.mark.asyncio
async def test_teacher_sees_own_and_platform_knowledge_points_only(teacher_client, db_session, teacher_user, other_teacher_user):
    own = KnowledgePoint(name="自有知识点", owner_id=teacher_user.id, visibility="private")
    public = KnowledgePoint(name="公开知识点", owner_id=other_teacher_user.id, visibility="platform")
    hidden = KnowledgePoint(name="他人私有知识点", owner_id=other_teacher_user.id, visibility="private")
    db_session.add_all([own, public, hidden])
    await db_session.commit()

    response = await teacher_client.get("/api/knowledge-points")

    names = [item["name"] for item in response.json()]
    assert names == ["公开知识点", "自有知识点"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_learning_visibility.py -v`
Expected: FAIL because current service returns all knowledge points

- [ ] **Step 3: Scope read queries and set owner/visibility on create**

```python
async def list_knowledge_points(db: AsyncSession, *, user: User, is_platform_admin: bool) -> list[KnowledgePoint]:
    stmt = select(KnowledgePoint).where(KnowledgePoint.deleted_at.is_(None))
    if not is_platform_admin:
        stmt = stmt.where(visible_to_teacher(KnowledgePoint, user.id))
    return list((await db.execute(stmt.order_by(KnowledgePoint.name))).scalars().all())


kp = KnowledgePoint(**data.model_dump(), owner_id=user.id)
```

- [ ] **Step 4: Guard update/delete/prerequisite operations**

```python
if not can_write_owned_resource(..., owner_id=str(kp.owner_id)):
    raise HTTPException(status_code=403, detail="No permission to modify this knowledge point")
```

- [ ] **Step 5: Add visibility fields to knowledge responses**

```python
class KnowledgePointDetail(BaseModel):
    ...
    owner_id: uuid.UUID
    visibility: str
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_learning_visibility.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/learning/service.py backend/src/app/learning/router.py backend/src/app/learning/schemas.py backend/tests/test_learning_visibility.py
git commit -m "feat: enforce teacher visibility for knowledge points"
```

### Task 5: Scope Exams and Private Downstream Data

**Files:**
- Modify: `backend/src/app/exams/router.py`
- Modify: `backend/src/app/exams/schemas.py`
- Modify: `backend/src/app/grading/router.py`
- Modify: `backend/src/app/grading/service.py`
- Test: `backend/tests/test_exam_list_scope.py`
- Test: `backend/tests/grading/test_router.py`

- [ ] **Step 1: Write the failing exam scope tests**

```python
@pytest.mark.asyncio
async def test_teacher_only_sees_own_exams(teacher_client, db_session, teacher_user, other_teacher_user):
    own_exam = Exam(title="我的考试", owner_id=teacher_user.id, created_by=teacher_user.id, duration_minutes=60, total_score=100)
    other_exam = Exam(title="他人考试", owner_id=other_teacher_user.id, created_by=other_teacher_user.id, duration_minutes=60, total_score=100)
    db_session.add_all([own_exam, other_exam])
    await db_session.commit()

    response = await teacher_client.get("/api/exams")

    assert [item["title"] for item in response.json()] == ["我的考试"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_exam_list_scope.py tests/grading/test_router.py -v`
Expected: FAIL because current teacher routes are not owner-scoped

- [ ] **Step 3: Scope exam reads and writes**

```python
base_query = select(Exam).where(Exam.deleted_at.is_(None))
if not is_platform_admin and not is_student:
    base_query = base_query.where(Exam.owner_id == user.id)

exam = Exam(..., created_by=user.id, owner_id=user.id)
```

- [ ] **Step 4: Ensure grading/private downstream queries derive from exam ownership**

```python
stmt = select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
if not is_platform_admin:
    stmt = stmt.where(Exam.owner_id == user.id)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_exam_list_scope.py tests/grading/test_router.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/exams/router.py backend/src/app/exams/schemas.py backend/src/app/grading/router.py backend/src/app/grading/service.py backend/tests/test_exam_list_scope.py backend/tests/grading/test_router.py
git commit -m "feat: enforce private ownership for exams and grading"
```

### Task 6: Re-scope Student Management to Teacher Ownership

**Files:**
- Modify: `backend/src/app/rbac/service.py`
- Modify: `backend/src/app/rbac/students_router.py`
- Modify: `backend/src/app/auth/models.py`
- Create: `backend/tests/test_student_teacher_scope.py`

- [ ] **Step 1: Write the failing student scope test**

```python
@pytest.mark.asyncio
async def test_teacher_only_sees_owned_students(teacher_client, db_session, teacher_user, other_teacher_user, student_factory):
    own_student = await student_factory(owner_id=teacher_user.id, username="student-a")
    await student_factory(owner_id=other_teacher_user.id, username="student-b")

    response = await teacher_client.get("/api/rbac/students")

    usernames = [item["username"] for item in response.json()]
    assert usernames == [own_student.username]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_student_teacher_scope.py -v`
Expected: FAIL because current student listing is org-based

- [ ] **Step 3: Introduce teacher ownership for students**

```python
# backend/src/app/auth/models.py
class User(BaseModel):
    ...
    owner_teacher_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
```

```python
# backend/alembic/versions/20260411_teacher_student_ownership.py
def upgrade() -> None:
    op.add_column("users", sa.Column("owner_teacher_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_users_owner_teacher_id_users",
        "users",
        "users",
        ["owner_teacher_id"],
        ["id"],
        ondelete="SET NULL",
    )
```

- [ ] **Step 4: Rewrite student list/create/batch import to use teacher ownership**

```python
async def list_teacher_students(db: AsyncSession, teacher_id: uuid.UUID, class_id: uuid.UUID | None = None) -> list[User]:
    query = select(User).where(User.owner_teacher_id == teacher_id, User.deleted_at.is_(None))
    ...
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_student_teacher_scope.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/rbac/service.py backend/src/app/rbac/students_router.py backend/src/app/auth/models.py backend/tests/test_student_teacher_scope.py
git commit -m "feat: scope students to owning teacher"
```

### Task 7: Expose Visibility Controls in the Frontend

**Files:**
- Modify: `frontend/src/pages/questions/list.tsx`
- Modify: `frontend/src/pages/knowledge/index.tsx`
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/pages/questions/list-visibility.test.tsx`
- Create: `frontend/src/pages/knowledge/visibility.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

```tsx
it("shows read-only badge for another teacher's platform-shared bank", async () => {
  render(<QuestionBankList initialData={[{ id: "1", name: "公开题库", visibility: "platform", owner_id: "teacher-b", can_edit: false }]} />)
  expect(screen.getByText("平台公开")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && ./node_modules/.bin/vitest run src/pages/questions/list-visibility.test.tsx src/pages/knowledge/visibility.test.tsx`
Expected: FAIL because visibility metadata is not rendered yet

- [ ] **Step 3: Add visibility metadata to frontend types and views**

```ts
export interface VisibilityOwnedResource {
  owner_id: string
  visibility: "private" | "platform"
  can_edit?: boolean
}
```

- [ ] **Step 4: Render read-only and visibility controls only for owner**

```tsx
{record.visibility === "platform" && <Badge>平台公开</Badge>}
{record.can_edit ? <VisibilityToggle ... /> : <Badge variant="secondary">只读</Badge>}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && ./node_modules/.bin/vitest run src/pages/questions/list-visibility.test.tsx src/pages/knowledge/visibility.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/questions/list.tsx frontend/src/pages/knowledge/index.tsx frontend/src/types/index.ts frontend/src/pages/questions/list-visibility.test.tsx frontend/src/pages/knowledge/visibility.test.tsx
git commit -m "feat: show teacher visibility state in question and knowledge views"
```

### Task 8: Final Verification Sweep

**Files:**
- Modify: `docs/superpowers/specs/2026-04-11-teacher-data-visibility-design.md`

- [ ] **Step 1: Run backend focused test suite**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_teacher_data_visibility_primitives.py tests/test_resource_access.py tests/test_question_bank_visibility.py tests/test_question_filters.py tests/test_learning_visibility.py tests/test_exam_list_scope.py tests/test_student_teacher_scope.py tests/grading/test_router.py -v`
Expected: PASS

- [ ] **Step 2: Run frontend focused test suite**

Run: `cd frontend && ./node_modules/.bin/vitest run src/pages/questions/list-visibility.test.tsx src/pages/knowledge/visibility.test.tsx`
Expected: PASS

- [ ] **Step 3: Update spec references if implementation diverged**

```markdown
- 如果学生归属最终选择关系表而不是 `users.owner_teacher_id`，在 spec 中补一段“实现说明”说明这是出于兼容现有 RBAC 结构的最小改动选择。
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-11-teacher-data-visibility-design.md
git commit -m "docs: align teacher visibility spec with implementation details"
```

# Question & Exam Deletion Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce safe deletion rules so exams with student submissions are only soft-deleted, while questions remain soft-deleted unless they have no active exam references and no historical student data.

**Architecture:** Keep deletion decisions in backend service-layer helper functions, then make routers call those helpers before deleting. Preserve existing `deleted_at` soft-delete behavior for audited data, add targeted hard-delete checks for unused records, and update frontend confirmation copy to explain the lifecycle clearly.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, pytest with httpx, React, Refine, Vitest

---

### Task 1: Add backend deletion policy tests

**Files:**
- Create: `/Users/jzefan/work/proj/exam/backend/tests/test_deletion_lifecycle.py`
- Modify: none
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_deletion_lifecycle.py`

- [ ] **Step 1: Write the failing tests**

```python
async def test_delete_exam_with_submissions_soft_deletes_only(...):
    response = await admin_client.delete(f"/api/exams/{exam.id}")
    assert response.status_code == 204
    refreshed = await db_session.get(Exam, exam.id)
    assert refreshed is not None
    assert refreshed.deleted_at is not None
    assert await db_session.scalar(select(func.count()).select_from(StudentExamSubmission).where(StudentExamSubmission.exam_id == exam.id)) == 1


async def test_delete_exam_without_student_history_hard_deletes(...):
    response = await admin_client.delete(f"/api/exams/{exam.id}")
    assert response.status_code == 204
    assert await db_session.get(Exam, exam.id) is None


async def test_cleanup_soft_deleted_question_hard_deletes_only_when_no_refs_or_history(...):
    await soft_delete_question(db_session, question)
    deleted = await cleanup_soft_deleted_question_if_orphaned(db_session, question.id)
    assert deleted is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_deletion_lifecycle.py -q`
Expected: FAIL because the deletion policy helpers and route behavior do not exist yet.

- [ ] **Step 3: Implement minimal fixtures/helpers in the test file**

```python
async def _create_teacher(db_session):
    ...


async def _create_question(db_session, teacher_id):
    ...


async def _create_exam_with_question(db_session, teacher_id, question_id):
    ...
```

- [ ] **Step 4: Re-run tests and keep them failing only on missing production behavior**

Run: `cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_deletion_lifecycle.py -q`
Expected: FAIL on route/service assertions, not test setup errors.

- [ ] **Step 5: Commit**

```bash
git add /Users/jzefan/work/proj/exam/backend/tests/test_deletion_lifecycle.py
git commit -m "test: cover deletion lifecycle policies"
```

### Task 2: Implement backend deletion policy helpers

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/service.py`
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/exams/router.py`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_deletion_lifecycle.py`

- [ ] **Step 1: Add failing assertions for question cleanup rules**

```python
assert await cleanup_soft_deleted_question_if_orphaned(db_session, question_with_history.id) is False
assert await cleanup_soft_deleted_question_if_orphaned(db_session, question_with_active_exam.id) is False
```

- [ ] **Step 2: Run tests to verify the new assertions fail**

Run: `cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_deletion_lifecycle.py -q`
Expected: FAIL because helper logic is not implemented.

- [ ] **Step 3: Write minimal service-layer implementation**

```python
async def can_hard_delete_question(db: AsyncSession, question_id: uuid.UUID) -> bool:
    has_active_exam_ref = ...
    has_answer_history = ...
    has_progress_history = ...
    return not has_active_exam_ref and not has_answer_history and not has_progress_history


async def cleanup_soft_deleted_question_if_orphaned(db: AsyncSession, question_id: uuid.UUID) -> bool:
    question = await db.get(Question, question_id)
    if question is None or question.deleted_at is None:
        return False
    if not await can_hard_delete_question(db, question_id):
        return False
    await db.delete(question)
    await db.flush()
    return True
```

- [ ] **Step 4: Route exam deletion through explicit policy**

```python
async def _exam_has_student_history(db: AsyncSession, exam_id: uuid.UUID) -> bool:
    ...


if await _exam_has_student_history(db, exam.id):
    exam.deleted_at = datetime.now(timezone.utc)
else:
    question_ids = ...
    await db.delete(exam)
    await db.flush()
    for question_id in question_ids:
        await cleanup_soft_deleted_question_if_orphaned(db, question_id)
```

- [ ] **Step 5: Run backend tests to verify they pass**

Run: `cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_deletion_lifecycle.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add /Users/jzefan/work/proj/exam/backend/src/app/questions/service.py /Users/jzefan/work/proj/exam/backend/src/app/exams/router.py /Users/jzefan/work/proj/exam/backend/tests/test_deletion_lifecycle.py
git commit -m "feat: enforce safe question and exam deletion"
```

### Task 3: Update question deletion messaging in the frontend

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/list.tsx`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-delete-copy.test.tsx`

- [ ] **Step 1: Write the failing frontend copy test**

```tsx
it("explains that question deletion enters recycle state", () => {
  render(<QuestionsList ... />)
  expect(screen.getByText(/已被考试使用的题目将进入回收状态/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/questions/question-delete-copy.test.tsx --reporter=verbose`
Expected: FAIL because the existing dialog says deletion cannot be undone.

- [ ] **Step 3: Write minimal UI copy changes**

```tsx
<AlertDialogDescription>
  确定要删除这道题目吗？题目会先进入回收状态；如果仍被考试或练习使用，或已有学生作答历史，将不会立即彻底删除。
</AlertDialogDescription>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/questions/question-delete-copy.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/jzefan/work/proj/exam/frontend/src/pages/questions/list.tsx /Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-delete-copy.test.tsx
git commit -m "feat: clarify question recycle deletion copy"
```

### Task 4: Update exam deletion messaging in the frontend

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/exams/list.tsx`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/exams/exam-delete-copy.test.tsx`

- [ ] **Step 1: Write the failing frontend copy test**

```tsx
it("explains that submitted exams are archived instead of purged", () => {
  render(<ExamsList ... />)
  expect(screen.getByText(/若已有考生提交，将仅归档隐藏/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/exams/exam-delete-copy.test.tsx --reporter=verbose`
Expected: FAIL because the dialog currently promises irreversible deletion.

- [ ] **Step 3: Write minimal UI copy changes**

```tsx
<AlertDialogDescription>
  确定要删除{deleteTargetLabel}「{deleteTarget?.title}」吗？若尚无学生作答记录，将被彻底删除；若已有考生提交，将仅归档隐藏并保留答卷历史。
</AlertDialogDescription>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/exams/exam-delete-copy.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/jzefan/work/proj/exam/frontend/src/pages/exams/list.tsx /Users/jzefan/work/proj/exam/frontend/src/pages/exams/exam-delete-copy.test.tsx
git commit -m "feat: clarify exam archive deletion copy"
```

### Task 5: Verify the full deletion lifecycle change set

**Files:**
- Modify: none
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_deletion_lifecycle.py`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-delete-copy.test.tsx`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/exams/exam-delete-copy.test.tsx`

- [ ] **Step 1: Run focused backend and frontend verification**

Run: `cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_deletion_lifecycle.py -q`
Expected: PASS

Run: `cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/questions/question-delete-copy.test.tsx src/pages/exams/exam-delete-copy.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 2: Run TypeScript check**

Run: `cd /Users/jzefan/work/proj/exam/frontend && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add /Users/jzefan/work/proj/exam/docs/superpowers/plans/2026-04-22-question-exam-deletion-lifecycle.md
git commit -m "docs: add deletion lifecycle implementation plan"
```

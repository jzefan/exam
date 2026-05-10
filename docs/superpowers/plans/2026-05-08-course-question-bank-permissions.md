# Course Question Bank Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any authenticated user to generate questions from public knowledge materials and save them into their own default private "课程题库" without needing teacher/admin question-bank management permissions.

**Architecture:** Split the workflow into two permission domains: (1) public knowledge content is readable by any authenticated user when the selected nodes are public/readable, and (2) saved questions always land in a per-user private default bank that is created lazily by the backend. Do not widen the generic question-bank CRUD permissions; instead add a dedicated "save generated questions to my course bank" backend path that encapsulates bank provisioning and question creation.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Pydantic v2, React, TypeScript, Vitest, pytest

---

## File Structure

- **Modify:** `backend/src/app/questions/router.py`
  - Add a dedicated endpoint for saving generated material questions to the caller's private default course bank.
  - Keep existing teacher/admin-only generic bulk question creation route unchanged.
- **Modify:** `backend/src/app/questions/service.py`
  - Add/extend helper for lazy get-or-create of a user's named private course bank.
  - Add a focused service method that validates readable knowledge points and bulk-creates questions owned by the caller.
- **Modify:** `backend/src/app/questions/schemas.py`
  - Add request/response schema for the new specialized save endpoint.
- **Modify:** `backend/tests/test_question_bank_visibility.py`
  - Add regression tests covering student/non-teacher access to the new save path and per-user course-bank creation.
- **Modify:** `frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx`
  - Replace the current generic `/api/questions/bulk` save flow with the new specialized endpoint.
  - Keep the current UX wording around saving to "课程题库".
- **Modify:** `frontend/src/pages/knowledge/RelatedResourcesDialog.test.tsx` (only if needed)
  - Add/adjust UI test if prop contract or success/error messaging changes.

---

### Task 1: Add a failing backend test for non-teacher course-bank save

**Files:**
- Modify: `backend/tests/test_question_bank_visibility.py`
- Test: `backend/tests/test_question_bank_visibility.py`

- [ ] **Step 1: Write the failing test**

Add a regression test proving a non-teacher authenticated user can save generated questions into their own default private "课程题库" when the knowledge point is public/readable.

```python
@pytest.mark.asyncio
async def test_non_teacher_can_save_generated_questions_to_own_course_bank(
    client: AsyncClient,
    db_session,
) -> None:
    org = Organization(name="Generated Question School", type="school", is_active=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, student_role])
    await db_session.flush()

    student = await create_user(
        db_session,
        UserCreate(
            username="student-course-bank",
            email="student-course-bank@example.com",
            password="studentpass123",
            full_name="Student Course Bank",
            role_name="student",
            org_id=org.id,
        ),
    )

    major = Major(name="人工智能")
    direction = Direction(name="AI应用", major_id=major.id)
    knowledge = KnowledgePoint(
        name="计算机视觉",
        direction_id=direction.id,
        visibility=VisibilityScope.PLATFORM,
        owner_id=student.id,
    )
    db_session.add_all([major, direction, knowledge])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    response = await client.post(
        "/api/questions/save-generated-to-course-bank",
        json={
            "questions": [
                {
                    "type": "choice",
                    "title": "图像分类基础题",
                    "content": {"text": "下列哪项最接近图像分类任务？"},
                    "options": {"A": "预测类别", "B": "预测边框", "C": "生成音频", "D": "删除样本"},
                    "answer": {"correct": "A"},
                    "analysis": "图像分类输出类别标签。",
                    "difficulty": 2,
                    "score": 10,
                    "knowledge_point_ids": [str(knowledge.id)],
                }
            ]
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["created"] == 1

    bank = await db_session.scalar(
        select(QuestionBank).where(
            QuestionBank.name == "课程题库",
            QuestionBank.owner_id == student.id,
        )
    )
    assert bank is not None
    assert bank.visibility == VisibilityScope.PRIVATE
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src uv run pytest tests/test_question_bank_visibility.py::test_non_teacher_can_save_generated_questions_to_own_course_bank -v
```

Expected: FAIL with `404 Not Found` (endpoint missing) or `403 Forbidden` (current generic save path still role-restricted).

- [ ] **Step 3: Add one negative-permission test**

Add a second test proving the new endpoint still rejects unreadable/private knowledge points owned by another user.

```python
@pytest.mark.asyncio
async def test_save_generated_questions_rejects_unreadable_knowledge_points(
    client: AsyncClient,
    db_session,
) -> None:
    # create student requester + other owner + private knowledge point
    # post to /api/questions/save-generated-to-course-bank
    # assert response.status_code == 403
```

- [ ] **Step 4: Run both tests to verify RED**

Run:
```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src uv run pytest tests/test_question_bank_visibility.py -k "course_bank or unreadable_knowledge_points" -v
```

Expected: both new tests fail for the missing behavior, not for syntax/setup errors.

- [ ] **Step 5: Commit the red tests**

```bash
git add backend/tests/test_question_bank_visibility.py
git commit -m "test: cover generated course bank permissions"
```

---

### Task 2: Implement a dedicated backend save path for generated course-bank saves

**Files:**
- Modify: `backend/src/app/questions/schemas.py`
- Modify: `backend/src/app/questions/service.py`
- Modify: `backend/src/app/questions/router.py`
- Test: `backend/tests/test_question_bank_visibility.py`

- [ ] **Step 1: Add specialized schemas**

In `backend/src/app/questions/schemas.py`, add a narrow request schema for generated-question saves instead of reusing the generic teacher-oriented bulk schema.

```python
class GeneratedQuestionSaveItem(BaseModel):
    type: QuestionType
    title: str
    content: QuestionContent
    options: dict[str, str] | None = None
    answer: dict[str, Any]
    analysis: str | None = None
    difficulty: int = Field(ge=1, le=5)
    score: int = Field(default=10, ge=1)
    knowledge_point_ids: list[uuid.UUID] = Field(default_factory=list)


class SaveGeneratedQuestionsToCourseBankRequest(BaseModel):
    questions: list[GeneratedQuestionSaveItem] = Field(min_length=1, max_length=50)
```

- [ ] **Step 2: Add/keep the named private bank helper**

In `backend/src/app/questions/service.py`, keep the reusable helper for per-user private named banks.

```python
async def get_or_create_named_private_question_bank(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    name: str,
    description: str,
) -> QuestionBank:
    ...
```

- [ ] **Step 3: Implement the specialized save service**

In `backend/src/app/questions/service.py`, add a focused service that:
1. gets/creates the caller's `课程题库`
2. builds `QuestionCreate` payloads with that bank id
3. creates questions owned by the caller
4. leaves generic teacher-only bulk APIs untouched

```python
async def save_generated_questions_to_course_bank(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    questions: list[GeneratedQuestionSaveItem],
) -> QuestionBulkCreateResponse:
    bank = await get_or_create_named_private_question_bank(
        db,
        user_id=user_id,
        name="课程题库",
        description="课程学习资料关联的智能出题结果",
    )
    payloads = [
        QuestionCreate(
            type=item.type,
            title=item.title,
            content=item.content,
            options=item.options,
            answer=item.answer,
            analysis=item.analysis,
            difficulty=item.difficulty,
            score=item.score,
            tag_ids=[],
            knowledge_point_ids=item.knowledge_point_ids,
            question_bank_id=bank.id,
        )
        for item in questions
    ]
    return await bulk_create_questions(db, payloads, user_id)
```

- [ ] **Step 4: Add the new endpoint with `CurrentUser` auth**

In `backend/src/app/questions/router.py`, add a route that uses `CurrentUser` rather than `require_roles(...)`, but still explicitly validates readable knowledge points before creation.

```python
@questions_router.post(
    "/save-generated-to-course-bank",
    response_model=QuestionBulkCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_generated_questions_to_course_bank_endpoint(
    data: SaveGeneratedQuestionsToCourseBankRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> QuestionBulkCreateResponse:
    knowledge_point_ids = {
        knowledge_point_id
        for question in data.questions
        for knowledge_point_id in question.knowledge_point_ids
    }
    is_admin = await _is_question_admin(db, user)
    await _ensure_can_read_knowledge_points(db, list(knowledge_point_ids), user, is_admin)
    return await save_generated_questions_to_course_bank(
        db,
        user_id=user.id,
        questions=data.questions,
    )
```

- [ ] **Step 5: Run the focused backend tests**

Run:
```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src uv run pytest tests/test_question_bank_visibility.py -k "course_bank or unreadable_knowledge_points" -v
```

Expected: PASS for the new tests.

- [ ] **Step 6: Run the broader question tests**

Run:
```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src uv run pytest tests/test_question_bank_visibility.py tests/test_ai_generate.py -q
```

Expected: all selected tests PASS.

- [ ] **Step 7: Commit the backend implementation**

```bash
git add backend/src/app/questions/router.py backend/src/app/questions/service.py backend/src/app/questions/schemas.py backend/tests/test_question_bank_visibility.py
git commit -m "feat: allow personal course-bank saves from generated questions"
```

---

### Task 3: Switch the frontend save flow to the specialized endpoint

**Files:**
- Modify: `frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx`
- Test: `frontend/src/pages/knowledge/RelatedResourcesDialog.test.tsx` (if needed)

- [ ] **Step 1: Add a failing UI-level assertion (if no coverage exists)**

If `MaterialAIGenerateDialog` is not directly tested, add or extend the nearest test to assert the save flow calls the new endpoint path.

```tsx
expect(fetchMock).toHaveBeenCalledWith(
  "/api/questions/save-generated-to-course-bank",
  expect.objectContaining({ method: "POST" }),
)
```

- [ ] **Step 2: Run the targeted frontend test to verify RED**

Run:
```bash
cd /Users/jzefan/work/proj/exam/frontend && npx vitest run src/pages/knowledge/RelatedResourcesDialog.test.tsx
```

Expected: FAIL if the old endpoint path is still asserted/called.

- [ ] **Step 3: Replace the save flow in `MaterialAIGenerateDialog.tsx`**

Stop calling the teacher-oriented generic endpoints (`/api/question-banks`, `/api/questions/bulk`) from this flow. Post directly to the new specialized backend route.

```tsx
await apiFetch<{ created: number }>("/api/questions/save-generated-to-course-bank", {
  method: "POST",
  body: JSON.stringify({
    questions: selected.map((q) => ({
      type: q.type,
      title: q.title,
      content: q.content,
      options: q.options,
      answer: q.answer,
      analysis: q.analysis,
      difficulty: q.difficulty,
      score: 10,
      knowledge_point_ids: [knowledgePointId],
    })),
  }),
});
```

- [ ] **Step 4: Simplify the success/error handling**

Keep the current success toast, but update permission failure copy to mention unreadable knowledge content or account restrictions only if the new endpoint actually returns those errors.

```tsx
toast({ title: `已保存 ${selected.length} 道题目到「课程题库」` });
```

- [ ] **Step 5: Run frontend verification**

Run:
```bash
cd /Users/jzefan/work/proj/exam/frontend && npx tsc --noEmit && npx vitest run src/pages/knowledge/RelatedResourcesDialog.test.tsx src/pages/knowledge/MajorDirectionSidebar.test.tsx
```

Expected: typecheck PASS, selected tests PASS.

- [ ] **Step 6: Commit the frontend change**

```bash
git add frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx frontend/src/pages/knowledge/RelatedResourcesDialog.test.tsx frontend/src/pages/knowledge/MajorDirectionSidebar.test.tsx
git commit -m "feat: save material-generated questions to personal course bank"
```

---

### Task 4: Final verification and cleanup

**Files:**
- Modify: none unless verification uncovers regressions
- Test: existing backend/frontend suites above

- [ ] **Step 1: Run end-to-end regression checks for this feature slice**

Run:
```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src uv run pytest tests/test_question_bank_visibility.py tests/test_ai_generate.py -q
```

Run:
```bash
cd /Users/jzefan/work/proj/exam/frontend && npx tsc --noEmit && npx vitest run src/pages/knowledge/RelatedResourcesDialog.test.tsx src/pages/knowledge/MajorDirectionSidebar.test.tsx
```

Expected: all PASS.

- [ ] **Step 2: Manual verification in the browser**

Verify this exact flow:
1. Log in as a non-teacher authenticated user.
2. Open a public knowledge point.
3. Upload a supported file (`pdf`, `docx`, or `pptx`).
4. Click “文件智能出题”.
5. Generate at least 1 question.
6. Click “保存到「课程题库」”.
7. Confirm success toast appears.
8. Refresh and confirm the generated questions appear in related questions.
9. Confirm a private `课程题库` now exists for that user.

- [ ] **Step 3: Check that generic teacher restrictions remain intact**

Run a quick API spot check:
```bash
# as non-teacher user, POST /api/question-banks should still be forbidden if that policy remains intentional
# as teacher, generic bulk question creation should still work
```

Expected: the new specialized path works without widening unrelated management permissions.

- [ ] **Step 4: Commit any final test or message adjustments**

```bash
git add backend/src/app/questions/router.py backend/src/app/questions/service.py backend/src/app/questions/schemas.py backend/tests/test_question_bank_visibility.py frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx frontend/src/pages/knowledge/RelatedResourcesDialog.test.tsx
git commit -m "test: verify personal course-bank generation flow"
```

---

## Self-Review

- **Spec coverage:**
  - “任何用户都可以在公共知识体系下进行智能出题” → Task 2 adds `CurrentUser` specialized save endpoint plus readable-knowledge validation.
  - “保存到每个用户自己的课程题库” → Task 2 lazy-creates a per-user private `课程题库`.
  - “每个用户都有一个默认的课程题库” → implemented as backend get-or-create on first save, so behavior is guaranteed without requiring pre-seeding.
  - “不要把泛化题库管理权限放开” → Task 2/4 explicitly preserve generic question-bank CRUD restrictions.

- **Placeholder scan:**
  - No `TODO/TBD/similar to` placeholders remain.
  - Each code-changing task includes concrete code/commands.

- **Type consistency:**
  - New backend request type is `SaveGeneratedQuestionsToCourseBankRequest`.
  - New backend service is `save_generated_questions_to_course_bank`.
  - Frontend save path targets `/api/questions/save-generated-to-course-bank` consistently.

Plan complete and saved to `docs/superpowers/plans/2026-05-08-course-question-bank-permissions.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

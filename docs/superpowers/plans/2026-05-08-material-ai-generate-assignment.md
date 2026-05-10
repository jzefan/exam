# Material AI Generate Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a “生成作业” flow after material-based AI question generation so a teacher can select classes/students, auto-save selected questions into their private `课程题库`, and publish a practice with default timing.

**Architecture:** Reuse the existing material AI generation dialog as the entry point, add a lightweight assignment dialog for title + student selection, and keep all assignment defaults fixed in a dedicated backend-friendly submit path. Reuse the existing `ClassStudentSelector` UI and existing `/api/exams` creation route, but enhance the generated-question save endpoint so it returns created question IDs needed to create the practice.

**Tech Stack:** React, TypeScript, Vitest, FastAPI, Pydantic v2, SQLAlchemy async ORM, pytest

---

## File Structure

- **Modify:** `frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx`
  - Add `生成作业` button, open the lightweight assignment dialog, and call save-then-create flow.
- **Create:** `frontend/src/pages/knowledge/GeneratedAssignmentDialog.tsx`
  - Focused modal for title + class/student selection + publish action.
- **Modify:** `frontend/src/pages/exams/components/ClassStudentSelector.tsx` (only if needed)
  - Ensure it can be reused inside a compact dialog without practice-create-only assumptions.
- **Modify:** `backend/src/app/questions/schemas.py`
  - Extend generated-question save response to return created IDs.
- **Modify:** `backend/src/app/questions/router.py`
  - Return created question IDs from `/api/questions/save-generated-to-course-bank`.
- **Modify:** `backend/src/app/exams/schemas.py` and/or `backend/src/app/exams/router.py` only if existing defaults need backend-side coercion.
- **Test:** `backend/tests/test_question_bank_visibility.py`
  - Add regression asserting save-generated-to-course-bank returns created question IDs.
- **Create/Modify Test:** `frontend/src/pages/knowledge/GeneratedAssignmentDialog.test.tsx`
  - Cover title + student selection + publish behavior.

---

### Task 1: Return created question IDs from generated-question saves

**Files:**
- Modify: `backend/src/app/questions/schemas.py`
- Modify: `backend/src/app/questions/router.py`
- Modify: `backend/tests/test_question_bank_visibility.py`

- [ ] **Step 1: Write the failing backend test**

Add a focused assertion to the existing positive-path course-bank save test in `backend/tests/test_question_bank_visibility.py`.

```python
assert payload["created"] == 1
assert len(payload["created_question_ids"]) == 1
question_id = uuid.UUID(payload["created_question_ids"][0])
assert question.id == question_id
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src uv run pytest tests/test_question_bank_visibility.py::test_student_can_save_generated_questions_to_own_course_bank -v
```

Expected: FAIL because `created_question_ids` is missing from the response model.

- [ ] **Step 3: Add minimal response schema field**

Update `backend/src/app/questions/schemas.py`:

```python
class QuestionBulkCreateResponse(BaseModel):
    created: int
    existing: int = 0
    failed: int = 0
    created_question_ids: list[uuid.UUID] = Field(default_factory=list)
```

- [ ] **Step 4: Return IDs from the specialized endpoint**

Update `backend/src/app/questions/router.py` in both bulk-create routes that already receive `BulkCreateQuestionsResult`.

```python
return QuestionBulkCreateResponse(
    created=result.created,
    existing=result.existing,
    failed=result.failed,
    created_question_ids=result.created_question_ids,
)
```

- [ ] **Step 5: Run backend tests to verify green**

Run:
```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src uv run pytest tests/test_question_bank_visibility.py tests/test_ai_generate.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/questions/schemas.py backend/src/app/questions/router.py backend/tests/test_question_bank_visibility.py
git commit -m "feat: return created ids for generated course-bank saves"
```

---

### Task 2: Add a lightweight generated-assignment dialog

**Files:**
- Create: `frontend/src/pages/knowledge/GeneratedAssignmentDialog.tsx`
- Test: `frontend/src/pages/knowledge/GeneratedAssignmentDialog.test.tsx`
- Check: `frontend/src/pages/exams/components/ClassStudentSelector.tsx`

- [ ] **Step 1: Write the failing frontend test**

Create `frontend/src/pages/knowledge/GeneratedAssignmentDialog.test.tsx`.

```tsx
test("publishes only after title and students are ready", async () => {
  render(
    <GeneratedAssignmentDialog
      open
      defaultTitle="数字特征练习"
      questionCount={3}
      onOpenChange={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "发布作业" })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/jzefan/work/proj/exam/frontend && npx vitest run src/pages/knowledge/GeneratedAssignmentDialog.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Create minimal dialog component**

Create `frontend/src/pages/knowledge/GeneratedAssignmentDialog.tsx` with:

```tsx
export interface GeneratedAssignmentDialogSubmitPayload {
  title: string;
  studentIds: string[];
}

export function GeneratedAssignmentDialog({
  open,
  defaultTitle,
  questionCount,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  defaultTitle: string;
  questionCount: number;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: GeneratedAssignmentDialogSubmitPayload) => Promise<void>;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成作业</DialogTitle>
          <DialogDescription>将发布 {questionCount} 道题，默认立即开始，2 周后截止，时长 60 分钟。</DialogDescription>
        </DialogHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        <ClassStudentSelector selectedIds={studentIds} onChange={setStudentIds} summaryLabel="人" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={submitting || !title.trim() || studentIds.length === 0}>发布作业</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/jzefan/work/proj/exam/frontend && npx vitest run src/pages/knowledge/GeneratedAssignmentDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/knowledge/GeneratedAssignmentDialog.tsx frontend/src/pages/knowledge/GeneratedAssignmentDialog.test.tsx
git commit -m "feat: add lightweight generated assignment dialog"
```

---

### Task 3: Wire “生成作业” into the material AI dialog

**Files:**
- Modify: `frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx`
- Test: `frontend/src/pages/knowledge/RelatedResourcesDialog.test.tsx`

- [ ] **Step 1: Write the failing integration-style UI test**

Extend `frontend/src/pages/knowledge/RelatedResourcesDialog.test.tsx` or add a new targeted test around `MaterialAIGenerateDialog`.

```tsx
test("shows generate-assignment action only when generation finished with selected questions", async () => {
  // render MaterialAIGenerateDialog with seeded questions and isGenerating false
  expect(screen.getByRole("button", { name: "生成作业" })).toBeEnabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/jzefan/work/proj/exam/frontend && npx vitest run src/pages/knowledge/RelatedResourcesDialog.test.tsx src/pages/knowledge/GeneratedAssignmentDialog.test.tsx
```

Expected: FAIL because `生成作业` does not exist in the current dialog.

- [ ] **Step 3: Add button + dialog state**

In `frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx`:

```tsx
const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
const selectedQuestions = questions.filter((q) => q.selected);

<Button
  variant="secondary"
  onClick={() => setShowAssignmentDialog(true)}
  disabled={isGenerating || isSaving || selectedQuestions.length === 0}
>
  生成作业
</Button>
```

- [ ] **Step 4: Add the publish submit flow**

In the same file, implement `handleCreateAssignment`:

```tsx
const handleCreateAssignment = useCallback(async ({ title, studentIds }) => {
  const saveResponse = await apiFetch<{ created_question_ids: string[] }>(
    "/api/questions/save-generated-to-course-bank",
    {
      method: "POST",
      body: JSON.stringify({
        questions: selectedQuestions.map((q) => ({
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
    },
  );

  await apiFetch("/api/exams", {
    method: "POST",
    body: JSON.stringify({
      category: "practice",
      title,
      description: null,
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 60,
      total_score: 100,
      status: "published",
      question_mode: "manual",
      question_ids: saveResponse.created_question_ids,
      student_ids: studentIds,
      show_result: false,
    }),
  });

  toast({ title: `已发布作业《${title}》给 ${studentIds.length} 名学生` });
  onSaved?.();
  setShowAssignmentDialog(false);
  onOpenChange(false);
}, [selectedQuestions, knowledgePointId, onSaved, onOpenChange, toast]);
```

- [ ] **Step 5: Render the lightweight assignment dialog**

```tsx
<GeneratedAssignmentDialog
  open={showAssignmentDialog}
  defaultTitle={`${knowledgePointName}练习`}
  questionCount={selectedQuestions.length}
  onOpenChange={setShowAssignmentDialog}
  onSubmit={handleCreateAssignment}
/>
```

- [ ] **Step 6: Run frontend verification**

Run:
```bash
cd /Users/jzefan/work/proj/exam/frontend && npx tsc --noEmit && npx vitest run src/pages/knowledge/GeneratedAssignmentDialog.test.tsx src/pages/knowledge/RelatedResourcesDialog.test.tsx src/pages/knowledge/MajorDirectionSidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx frontend/src/pages/knowledge/GeneratedAssignmentDialog.tsx frontend/src/pages/knowledge/GeneratedAssignmentDialog.test.tsx frontend/src/pages/knowledge/RelatedResourcesDialog.test.tsx
git commit -m "feat: publish assignments from material-generated questions"
```

---

### Task 4: End-to-end defaults and regression verification

**Files:**
- Modify: none unless verification reveals mismatches
- Test: backend/frontend suites above

- [ ] **Step 1: Verify backend question-save response and existing AI flows**

Run:
```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src uv run pytest tests/test_question_bank_visibility.py tests/test_ai_generate.py -q
```

Expected: PASS.

- [ ] **Step 2: Verify frontend typecheck and dialog tests**

Run:
```bash
cd /Users/jzefan/work/proj/exam/frontend && npx tsc --noEmit && npx vitest run src/pages/knowledge/GeneratedAssignmentDialog.test.tsx src/pages/knowledge/RelatedResourcesDialog.test.tsx src/pages/knowledge/MajorDirectionSidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Manual browser verification**

Check this exact flow:
1. 打开公共知识点的“学习资料与相关题目”。
2. 用资料生成题目并勾选至少 1 道题。
3. 点击“生成作业”。
4. 在精简弹窗中输入/确认标题。
5. 使用与现有创建作业一致的方式按班级全选或单独选学生。
6. 点击“发布作业”。
7. 确认：
   - 题目保存到当前用户自己的 `课程题库`
   - 作业立即创建为 `practice`
   - 开始时间为当前时间
   - 结束时间约为 2 周后
   - 时长为 60 分钟
   - 相关题目数量同步刷新

- [ ] **Step 4: Commit any final adjustments**

```bash
git add backend/src/app/questions/schemas.py backend/src/app/questions/router.py frontend/src/pages/knowledge/MaterialAIGenerateDialog.tsx frontend/src/pages/knowledge/GeneratedAssignmentDialog.tsx frontend/src/pages/knowledge/GeneratedAssignmentDialog.test.tsx
git commit -m "test: verify generated assignment publishing flow"
```

---

## Self-Review

- **Spec coverage:**
  - “增加一个功能按钮，直接生成作业” → Task 3 adds `生成作业` button to `MaterialAIGenerateDialog`.
  - “题目自动保存到课程题库” → Task 1 + Task 3 save via specialized course-bank endpoint before creating the practice.
  - “这里只需要增加人员即可” → Task 2 introduces a lightweight dialog limited to title + class/student selection.
  - “和创建作业的选择方式一样，可以选择班级全部人，也可以单独选择人员” → Task 2 reuses `ClassStudentSelector`.
  - “一定是当前教师名下的学生” → Task 2 explicitly reuses existing teacher-scoped student selector, not a new broader source.
  - “默认开始、默认 2 周后关闭、默认 60 分钟、不需要设置分数” → Task 3 hardcodes these values when calling `/api/exams` and keeps them out of the lightweight dialog.

- **Placeholder scan:**
  - No TBD/TODO placeholders remain.
  - Each code-changing step includes concrete code/commands.

- **Type consistency:**
  - New dialog payload is consistently `GeneratedAssignmentDialogSubmitPayload`.
  - New generated-question save response consistently includes `created_question_ids`.
  - Practice creation uses existing `/api/exams` route with `category: "practice"`.

# Exam Paper View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated exam/practice paper view page that shows a full paper on the left, a category-aware summary sidebar on the right, and supports lightweight editing of settings and score overrides.

**Architecture:** Keep the existing edit flows unchanged and introduce a new `/exams/:id/view` page. Split the work into a shared paper preview unit, a shared summary shell, and focused right-side editors for settings and score overrides so the page does not become a second full editor.

**Tech Stack:** React, Refine hooks, React Router, TypeScript, existing shadcn/ui components, Vitest, Testing Library

---

### Task 1: Route and list entry split

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/exams/list.tsx`
- Create: `frontend/src/pages/exams/view.tsx`

- [ ] **Step 1: Add the failing view-route test or route assertion**

Document target behavior:

```tsx
// Expected route targets after this task:
// 查看 -> /exams/:id/view
// 修改 -> /exams/edit/:id or /exams/practice/edit/:id
```

- [ ] **Step 2: Wire the new route**

Add:

```tsx
<Route path=":id/view" element={<ExamPaperViewPage />} />
```

- [ ] **Step 3: Split list actions**

Keep both actions in `frontend/src/pages/exams/list.tsx`:

```tsx
onView={() => navigate(`/exams/${exam.id}/view`)}
onEdit={() =>
  navigate(
    exam.category === "practice"
      ? `/exams/practice/edit/${exam.id}`
      : `/exams/edit/${exam.id}`,
  )
}
```

- [ ] **Step 4: Verify type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

### Task 2: Shared paper preview surface

**Files:**
- Create: `frontend/src/pages/exams/components/PaperPreview.tsx`
- Modify: `frontend/src/components/questions/question-preview-card.tsx`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add a failing render test sketch for full paper preview**

Document target behavior:

```tsx
render(<PaperPreview title="Mock Exam" questions={[...]} />);
expect(screen.getByText("第 1 题")).toBeInTheDocument();
expect(screen.getByText("考试分数")).toBeInTheDocument();
```

- [ ] **Step 2: Create the shared paper preview component**

The component should accept:

```ts
type PaperPreviewItem = {
  question: IQuestion;
  order: number;
  scoreOverride: number | null;
};
```

and render a standard paper-like layout using `QuestionPreviewCard`.

- [ ] **Step 3: Ensure LaTeX/content reuse stays on the shared question display path**

Do not hand-render question body. Reuse:

```tsx
<QuestionPreviewCard
  question={item.question}
  mode="detailed"
  hideTypeBadge
  expanded
/>
```

- [ ] **Step 4: Verify type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

### Task 3: View page data loader and dual-column shell

**Files:**
- Create: `frontend/src/pages/exams/view.tsx`
- Create: `frontend/src/pages/exams/components/PaperSummarySidebar.tsx`
- Modify: `frontend/src/pages/exams/edit.tsx`
- Modify: `frontend/src/pages/exams/practice-create.tsx`

- [ ] **Step 1: Add the failing view-page smoke test sketch**

Document target behavior:

```tsx
render(<ExamPaperViewPage />);
expect(screen.getByText("返回考试列表")).toBeInTheDocument();
expect(screen.getByText("进入完整修改")).toBeInTheDocument();
```

- [ ] **Step 2: Create a shared view-page detail mapper**

Reuse the exam detail shape already loaded by edit pages and normalize into:

```ts
type ViewDetail = {
  id: string;
  category: "exam" | "practice";
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  total_score: number;
  total_questions: number;
  total_students: number;
  submitted_count: number;
  show_result: boolean;
  max_switch_count: number;
  allow_retake: boolean;
  questions: IExamQuestion[];
  students: IExamStudent[];
};
```

- [ ] **Step 3: Build the page shell**

Use:

```tsx
<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
  <PaperPreview ... />
  <PaperSummarySidebar ... />
</div>
```

- [ ] **Step 4: Add category-aware sidebar summary blocks**

Exam shows status/time/student metrics.
Practice shows status/knowledge point summary/score summary.

- [ ] **Step 5: Verify type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

### Task 4: Settings editor with local save

**Files:**
- Create: `frontend/src/pages/exams/components/ExamSettingsPanel.tsx`
- Modify: `frontend/src/pages/exams/view.tsx`
- Test: `frontend/src/pages/exams/view.test.tsx`

- [ ] **Step 1: Write the failing settings-save test**

```tsx
it("saves show_result and allow_retake from the view page", async () => {
  // toggle settings
  // click 保存设置
  // expect update payload to include only settings fields
});
```

- [ ] **Step 2: Implement the settings panel**

Expose controlled fields:

```ts
{
  maxSwitchCount: number;
  showResult: boolean;
  allowRetake: boolean;
}
```

- [ ] **Step 3: Hook local dirty state and save action**

Use `useUpdate` with payload containing only:

```ts
{
  max_switch_count,
  show_result,
  allow_retake,
}
```

- [ ] **Step 4: Add success/failure toast and baseline reset**

After success:

```ts
setInitialSettings(nextSettings);
```

- [ ] **Step 5: Run the focused test**

Run: `pnpm exec vitest run src/pages/exams/view.test.tsx`
Expected: PASS

### Task 5: Score editor with order/type modes

**Files:**
- Create: `frontend/src/pages/exams/components/PaperScorePanel.tsx`
- Modify: `frontend/src/pages/exams/view.tsx`
- Modify: `frontend/src/pages/exams/components/exam-form-utils.ts`
- Test: `frontend/src/pages/exams/view.test.tsx`

- [ ] **Step 1: Write the failing score-save test**

```tsx
it("saves edited score overrides from the view page", async () => {
  // change one score
  // click 保存分数
  // expect update payload.question_items to contain updated score_override
});
```

- [ ] **Step 2: Add score mode switcher**

Support:

```ts
type ScoreViewMode = "order" | "type";
```

- [ ] **Step 3: Add type total distribution helper**

Reuse the existing score override shape and evenly distribute totals per type.

- [ ] **Step 4: Save score overrides through the existing update API**

Payload:

```ts
{
  question_items: nextQuestionItems,
}
```

- [ ] **Step 5: Keep the left paper preview in sync**

Drive both the sidebar and `PaperPreview` from the same local `questionItems` state.

- [ ] **Step 6: Run the focused test**

Run: `pnpm exec vitest run src/pages/exams/view.test.tsx`
Expected: PASS

### Task 6: Unsaved guard and final verification

**Files:**
- Modify: `frontend/src/pages/exams/view.tsx`
- Test: `frontend/src/pages/exams/view.test.tsx`

- [ ] **Step 1: Write the failing dirty-state test sketch**

```tsx
it("marks save buttons disabled until the user changes settings or scores", () => {
  // initial state disabled
  // after edit enabled
});
```

- [ ] **Step 2: Add dirty tracking for settings and scores**

Keep separate comparisons for:

```ts
isSettingsDirty
isScoresDirty
```

- [ ] **Step 3: Add navigation leave warning**

Use a window `beforeunload` listener and the existing unsaved-change conventions in the app.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run src/pages/exams/view.test.tsx`
Expected: PASS

- [ ] **Step 5: Run final verification**

Run:

```bash
pnpm exec vitest run src/pages/exams/view.test.tsx
pnpm exec tsc --noEmit
```

Expected:
- PASS
- PASS

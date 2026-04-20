# 题目导入审核页交互重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“核对导入内容”页重构为默认快速导入、按需进入逐题审核的双模式交互，降低主流用户的决策负担。

**Architecture:** 在 `QuestionImportPage` 中新增导入审核模式状态，统一控制顶部按钮、右侧操作区和 AI 能力显隐。快速导入模式只暴露批量导入主流程；逐题审核模式保留现有编辑器能力，但将 AI 操作收纳进折叠式辅助区。测试以页面行为和按钮层级为主，避免只验证静态文案。

**Tech Stack:** React, TypeScript, Refine hooks, shadcn/ui components, Vitest, Testing Library

---

## File Map

- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.tsx`
  - 维护导入模式状态
  - 根据模式切换顶部主操作区
  - 计算“可直接导入数量”
  - 将模式和模式相关回调传给编辑器
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/components/import-review-editor.tsx`
  - 按模式显示不同的右侧操作区
  - 增加 AI 辅助折叠区和 tooltip 说明
  - 快速导入模式只展示摘要 + 主按钮 + 进入逐题审核
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import-utils.ts`
  - 抽出“快速导入可纳入题目数量”判断函数
  - 保持与现有 `buildImportableQuestions`、`hasBlockingImportIssues` 规则一致
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.test.tsx`
  - 增加默认模式、按钮显隐、快速导入数量、逐题审核 AI 折叠区等行为测试

## Task 1: 抽出模式无关的快速导入资格判断

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import-utils.ts`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing test**

在 `import.test.tsx` 的 `question import helpers` 分组里新增测试，覆盖“快速导入模式下待审核但无阻断异常题也可导入，异常题不可导入”的规则：

```ts
it("counts drafts eligible for fast import without requiring manual approval", () => {
  const drafts: QuestionImportDraft[] = [
    { ...baseDraft, draft_id: "pending-ok", review_status: "pending" },
    { ...baseDraft, draft_id: "approved", review_status: "approved", review_required: false },
    { ...baseDraft, draft_id: "missing-answer", review_status: "pending", answer_text: null, issues: ["未识别到答案"] },
    { ...baseDraft, draft_id: "abnormal", review_status: "pending", issues: ["题型不确定"] },
  ];

  expect(countFastImportEligibleDrafts(drafts)).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL with `countFastImportEligibleDrafts is not defined` or missing export error.

- [ ] **Step 3: Write minimal implementation**

在 `import-utils.ts` 中新增函数，保持和现有导入规则一致，只排除阻断异常题：

```ts
export function isEligibleForFastImport(draft: QuestionImportDraft): boolean {
  return !hasBlockingImportIssues(draft);
}

export function countFastImportEligibleDrafts(drafts: QuestionImportDraft[]): number {
  return drafts.filter(isEligibleForFastImport).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS for the new helper test.

## Task 2: 在页面状态中引入“快速导入 / 逐题审核”模式

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.tsx`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing test**

新增页面测试，验证进入审核页后默认处于快速导入模式：

```ts
it("defaults to fast import mode after document recognition", async () => {
  fetchMock.mockResolvedValueOnce(
    mockJsonResponse({
      mode: "smart",
      summary: { total: 1, high_confidence: 0, medium_confidence: 1, low_confidence: 0, issue_count: 0, pending_review: 1, approved: 0, skipped: 0 },
      drafts: [{ ...baseDraft }],
    }),
  );

  render(<QuestionImportPage />);

  const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
  fireEvent.change(screen.getByTestId("question-import-file-input"), {
    target: { files: [file] },
  });

  expect(await screen.findByRole("button", { name: "快速导入（推荐）" })).toHaveAttribute("data-state", "active");
  expect(screen.getByRole("button", { name: "逐题审核" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL because the page does not render mode controls yet.

- [ ] **Step 3: Write minimal implementation**

在 `import.tsx` 中新增模式状态和切换控件：

```ts
const [reviewMode, setReviewMode] = useState<"fast" | "review">("fast");

useEffect(() => {
  if (drafts.length === 0) {
    setReviewMode("fast");
  }
}, [drafts.length]);
```

将模式切换按钮放到审核态右侧主操作区之前，使用 shadcn button 组合：

```tsx
<div className="inline-flex rounded-lg bg-slate-100 p-1">
  <Button
    type="button"
    size="sm"
    variant={reviewMode === "fast" ? "default" : "ghost"}
    data-state={reviewMode === "fast" ? "active" : "inactive"}
    onClick={() => setReviewMode("fast")}
  >
    快速导入（推荐）
  </Button>
  <Button
    type="button"
    size="sm"
    variant={reviewMode === "review" ? "default" : "ghost"}
    data-state={reviewMode === "review" ? "active" : "inactive"}
    onClick={() => setReviewMode("review")}
  >
    逐题审核
  </Button>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS for the default mode test.

## Task 3: 让顶部区域只保留状态与目标题库，不再与右侧争夺主操作

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.tsx`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing test**

新增页面测试，验证审核态顶部不再出现“正式导入 X 题”按钮：

```ts
it("moves the primary import action out of the header in review mode", async () => {
  fetchMock.mockResolvedValueOnce(
    mockJsonResponse({
      mode: "smart",
      summary: { total: 1, high_confidence: 0, medium_confidence: 1, low_confidence: 0, issue_count: 0, pending_review: 1, approved: 0, skipped: 0 },
      drafts: [{ ...baseDraft }],
    }),
  );

  render(<QuestionImportPage />);

  const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
  fireEvent.change(screen.getByTestId("question-import-file-input"), {
    target: { files: [file] },
  });

  await screen.findByText("核对导入内容");
  expect(screen.queryByRole("button", { name: /正式导入/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL because the header still contains the import button.

- [ ] **Step 3: Write minimal implementation**

在 `import.tsx` 中保留这些顶部元素：

- 文件名
- 总数/待核对/已确认/进度
- 目标题库选择

删除顶部这段按钮：

```tsx
<Button
  disabled={approvedCount === 0 || importing}
  onClick={openImportCourseDialog}
>
  正式导入 {approvedCount} 题
</Button>
```

同时保持 `openImportCourseDialog` 和 `runImportWithCourse` 逻辑不变，供右侧主按钮复用。

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS for header-primary-action removal.

## Task 4: 重构右侧编辑器为“快速导入模式”主界面

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/components/import-review-editor.tsx`
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.tsx`
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import-utils.ts`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing test**

新增页面测试，验证快速导入模式只显示主按钮和进入逐题审核按钮：

```ts
it("shows only fast-import actions in the default review mode", async () => {
  fetchMock.mockResolvedValueOnce(
    mockJsonResponse({
      mode: "smart",
      summary: { total: 2, high_confidence: 0, medium_confidence: 2, low_confidence: 0, issue_count: 1, pending_review: 2, approved: 0, skipped: 0 },
      drafts: [
        { ...baseDraft, draft_id: "ok" },
        { ...baseDraft, draft_id: "abnormal", issues: ["题型不确定"] },
      ],
    }),
  );

  render(<QuestionImportPage />);

  const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
  fireEvent.change(screen.getByTestId("question-import-file-input"), {
    target: { files: [file] },
  });

  await screen.findByText("核对导入内容");
  expect(screen.getByRole("button", { name: "导入 1 道题" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "进入逐题审核" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认并下一题" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "AI 补全当前题" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL because the editor still renders the old action group.

- [ ] **Step 3: Write minimal implementation**

给 `ImportReviewEditor` 增加模式相关参数：

```ts
reviewMode: "fast" | "review";
fastImportEligibleCount: number;
onEnterReviewMode: () => void;
onFastImport: () => void;
```

在组件内按模式拆分右侧操作区：

```tsx
{reviewMode === "fast" ? (
  <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
        <p>可直接导入 {fastImportEligibleCount} 道题</p>
        <p>异常题不会纳入本次导入，缺答案题可先入库。</p>
      </div>
      <Button onClick={onFastImport} disabled={fastImportEligibleCount === 0}>
        {fastImportEligibleCount > 0 ? `导入 ${fastImportEligibleCount} 道题` : "暂无可导入题目"}
      </Button>
      <Button variant="outline" onClick={onEnterReviewMode}>
        进入逐题审核
      </Button>
    </div>
  </div>
) : (
  // 现有审核模式操作区
)}
```

`onFastImport` 直接复用 `openImportCourseDialog`，但其校验条件改为 `countFastImportEligibleDrafts(drafts) > 0`，不再要求先人工确认。

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS for the fast-mode action visibility test.

## Task 5: 重构逐题审核模式操作区，并将 AI 能力折叠进“AI 辅助”

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/components/import-review-editor.tsx`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing test**

新增页面测试，验证切换到逐题审核后才出现审核动作，并且 AI 能力位于折叠区：

```ts
it("reveals review actions only after switching to manual review mode", async () => {
  fetchMock.mockResolvedValueOnce(
    mockJsonResponse({
      mode: "smart",
      summary: { total: 1, high_confidence: 0, medium_confidence: 1, low_confidence: 0, issue_count: 0, pending_review: 1, approved: 0, skipped: 0 },
      drafts: [{ ...baseDraft }],
    }),
  );

  render(<QuestionImportPage />);

  const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
  fireEvent.change(screen.getByTestId("question-import-file-input"), {
    target: { files: [file] },
  });

  await screen.findByText("核对导入内容");
  fireEvent.click(screen.getByRole("button", { name: "逐题审核" }));

  expect(screen.getByRole("button", { name: "确认并下一题" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "确定全部" })).toBeInTheDocument();
  expect(screen.getByText("AI 辅助")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "AI 补全当前题" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL because AI buttons are still always visible.

- [ ] **Step 3: Write minimal implementation**

在 `ImportReviewEditor` 的审核模式下，将现有动作区改成：

```tsx
<Button onClick={onApprove}>确认并下一题</Button>
<Button variant="outline" onClick={onApproveAll}>确定全部</Button>

<details className="rounded-xl border border-slate-100 bg-slate-50/70 p-2">
  <summary className="cursor-pointer text-sm font-bold text-slate-700">AI 辅助</summary>
  <div className="mt-2 grid gap-2">
    <Button variant="secondary" onClick={onReRecognize}>AI 补全当前题</Button>
    <Button variant="outline" onClick={onAnalyzeDocument}>AI 分析整份导入内容</Button>
  </div>
</details>
```

为两个 AI 按钮补充 tooltip 或说明属性，例如：

```tsx
title="补全当前题的答案、解析或题型"
title="重新分析整份导入文件，适合识别结果明显不准时使用"
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS for the manual-review visibility test.

## Task 6: 校准快速导入与逐题审核的导入入口规则

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.tsx`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing test**

新增测试，验证快速导入模式下不要求先人工确认：

```ts
it("allows opening the import flow directly from fast mode when non-blocking drafts exist", async () => {
  fetchMock.mockResolvedValueOnce(
    mockJsonResponse({
      mode: "smart",
      summary: { total: 1, high_confidence: 0, medium_confidence: 1, low_confidence: 0, issue_count: 0, pending_review: 1, approved: 0, skipped: 0 },
      drafts: [{ ...baseDraft, review_status: "pending" }],
    }),
  );

  render(<QuestionImportPage />);

  const file = new File(["1. 单选题 示例"], "questions.md", { type: "text/markdown" });
  fireEvent.change(screen.getByTestId("question-import-file-input"), {
    target: { files: [file] },
  });

  await screen.findByText("核对导入内容");
  fireEvent.click(screen.getByRole("button", { name: "导入 1 道题" }));

  expect(await screen.findByText("选择课程作为主知识")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL because `openImportCourseDialog` still insists on approved drafts only.

- [ ] **Step 3: Write minimal implementation**

在 `import.tsx` 中新增模式感知导入入口：

```ts
const fastImportEligibleCount = countFastImportEligibleDrafts(drafts);

const openImportCourseDialog = () => {
  const readyCount = reviewMode === "fast"
    ? fastImportEligibleCount
    : drafts.filter((draft) => draft.review_status === "approved" && !hasBlockingImportIssues(draft)).length;

  if (readyCount === 0) {
    setParseError(reviewMode === "fast" ? "暂无可直接导入的题目，请先处理异常题。" : "请先人工确认至少一道题目后再导入。");
    return;
  }

  setCourseDialogOpen(true);
};
```

导入执行时根据模式选择数据源：

```ts
const questions = reviewMode === "fast"
  ? buildImportableQuestions(
      drafts.map((draft) =>
        isEligibleForFastImport(draft) && draft.review_status !== "approved"
          ? { ...draft, review_status: "approved", review_required: false, title: draft.title || generateImportQuestionTitle(draft.content_text) }
          : draft,
      ),
      bankId,
    )
  : buildImportableQuestions(drafts, bankId);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS for direct fast-import entry.

## Task 7: 全量验证并整理文案

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.tsx`
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/components/import-review-editor.tsx`
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import-utils.ts`
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Run targeted tests**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS with all import page tests green.

- [ ] **Step 2: Run lint on touched files**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && ./node_modules/.bin/eslint src/pages/questions/import.tsx src/pages/questions/components/import-review-editor.tsx src/pages/questions/import-utils.ts src/pages/questions/import.test.tsx
```

Expected: no lint errors.

- [ ] **Step 3: Manual behavior checklist**

在本地页面手动检查以下行为：

- 默认进入快速导入模式
- 顶部不再出现重复主导入按钮
- 快速导入模式只有“导入 X 道题”和“进入逐题审核”
- 逐题审核模式才出现“确认并下一题 / 确定全部 / AI 辅助”
- AI 辅助折叠后默认收起
- 缺答案题在快速导入中仍可导入
- 异常题不会计入快速导入数量

- [ ] **Step 4: 记录变更说明**

在最终交付说明中明确：

- 默认主流程已切换为快速导入
- 逐题审核已降级为主动进入
- AI 操作已折叠到辅助区
- 异常题与缺答案题的导入规则保持不变

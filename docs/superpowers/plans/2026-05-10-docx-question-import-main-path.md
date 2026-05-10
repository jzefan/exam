# DOCX Question Import Main-Path Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Word (`.docx`) question import so choice questions keep their options when the source document uses Word lists or auto-numbering, without breaking existing plain-text `A./B./C./D.` imports.

**Architecture:** Ship Phase 1 from the approved design only: preserve ordered/unordered list structure in the frontend text extractor, then teach the backend parser to treat ordered-list markers as options only inside choice-like question contexts. Do not implement page-image fallback in this plan; that is a separate rendering subsystem and should follow only after the text-path fix is proven on real docs.

**Tech Stack:** React, TypeScript, mammoth, Vitest, FastAPI, Pydantic, pytest, Python regex parsing

---

## Scope Split

The approved spec contains two subsystems:

1. **Main-path DOCX text fix** — `docx -> html -> import text -> backend segmentation -> drafts`
2. **Page-image fallback** — render DOCX pages to images and run visual recognition

This plan intentionally implements **only subsystem 1**. Subsystem 2 should be written as a separate plan after this ships, because it introduces a browser-side DOCX renderer and page snapshot pipeline that is independent from the immediate parsing bug.

---

## File Map

### Backend

- Modify: `backend/src/app/questions/service.py:871-877`
  - Replace the current option extractor with a parser that understands explicit option lines and tagged ordered-list lines.
- Modify: `backend/src/app/questions/service.py:978-1058`
  - Update `build_import_draft_from_segment` so ordered-list markers become options only in choice-like contexts, while step lists remain in `content_text`.
- Modify: `backend/src/app/questions/service.py:1497-1552`
  - Add import-quality summary fields for incomplete choice detection and UI hints.
- Modify: `backend/src/app/questions/schemas.py:236-264`
  - Extend `QuestionImportDocumentSummary` with quality fields consumed by the frontend.
- Modify: `backend/tests/test_question_import_document_recognize.py`
  - Add regression tests for `[OL]`/`[UL]` markers, choice-option recovery, and non-choice step-list preservation.

### Frontend

- Modify: `frontend/src/pages/questions/import-utils.ts:205-324`
  - Preserve list semantics as tagged lines (`[OL] ...`, `[UL] ...`) instead of collapsing everything to `- ...`.
- Modify: `frontend/src/pages/questions/import-types.ts:43-59`
  - Add the new summary fields returned by the backend.
- Modify: `frontend/src/pages/questions/import.tsx:219-312`
  - Preserve summary metadata from the recognize response and render a warning when DOCX recognition still looks incomplete.
- Modify: `frontend/src/pages/questions/import.tsx:586-592`
  - Keep the existing error alert and add a non-blocking import-quality alert for DOCX documents.
- Modify: `frontend/src/pages/questions/import.test.tsx`
  - Add frontend regressions for list-marker extraction and the DOCX warning state.

---

## Task 1: Preserve DOCX List Semantics in Frontend Extraction

**Files:**
- Modify: `frontend/src/pages/questions/import-utils.ts:205-324`
- Test: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing frontend tests**

Add these tests to `frontend/src/pages/questions/import.test.tsx` near the existing `htmlToImportText` coverage:

```tsx
it("preserves ordered list items as [OL] markers for backend parsing", () => {
  const html = `
    <p>1. 下面关于数据分析说法正确的是（ ）</p>
    <ol>
      <li>数据分析是数学、统计学理论结合科学的统计分析方法</li>
      <li>数据分析是一种数学分析方法</li>
      <li>数据分析是统计学分析方法</li>
      <li>数据分析是大数据分析方法</li>
    </ol>
  `;

  expect(htmlToImportText(html)).toContain("[OL] 数据分析是数学、统计学理论结合科学的统计分析方法");
  expect(htmlToImportText(html)).toContain("[OL] 数据分析是一种数学分析方法");
  expect(htmlToImportText(html)).not.toContain("- 数据分析是一种数学分析方法");
});

it("preserves unordered list items as [UL] markers instead of flattening them", () => {
  const html = `
    <p>请提交今日课堂作业：</p>
    <ul>
      <li>提交 PDM 截图</li>
      <li>提交 MySQL 数据库脚本截图</li>
    </ul>
  `;

  const text = htmlToImportText(html);

  expect(text).toContain("[UL] 提交 PDM 截图");
  expect(text).toContain("[UL] 提交 MySQL 数据库脚本截图");
  expect(text).not.toContain("- 提交 PDM 截图");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/frontend" && pnpm vitest run src/pages/questions/import.test.tsx -t "preserves ordered list items as \[OL\] markers for backend parsing|preserves unordered list items as \[UL\] markers instead of flattening them"
```

Expected: FAIL because `htmlToImportText()` still emits `- ` for both ordered and unordered lists.

- [ ] **Step 3: Implement tagged list extraction**

Replace the duplicated `<ol>` / `<ul>` branches in `frontend/src/pages/questions/import-utils.ts` with a shared helper:

```ts
function appendListItems(
  target: string[],
  list: HTMLOListElement | HTMLUListElement,
  marker: "OL" | "UL",
  imageIndex: Map<string, QuestionImportImageInput>,
) {
  Array.from(list.children).forEach((child) => {
    if (!(child instanceof HTMLLIElement)) return;
    const lineParts: string[] = [];
    appendMergedInlineText(lineParts, collectInlineParts(child, imageIndex));
    if (lineParts[0]) {
      target.push(`[${marker}] ${lineParts[0]}`);
    }
    for (const extra of lineParts.slice(1)) {
      target.push(extra);
    }
  });
  target.push("");
}
```

Then update `visitNode` to use it:

```ts
if (node instanceof HTMLOListElement) {
  appendListItems(parts, node, "OL", imageIndex);
  return;
}

if (node instanceof HTMLUListElement) {
  appendListItems(parts, node, "UL", imageIndex);
  return;
}
```

Do **not** change paragraph extraction, image placeholders, or table extraction in this task.

- [ ] **Step 4: Run the frontend tests to verify they pass**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/frontend" && pnpm vitest run src/pages/questions/import.test.tsx -t "preserves ordered list items as \[OL\] markers for backend parsing|preserves unordered list items as \[UL\] markers instead of flattening them"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/questions/import-utils.ts frontend/src/pages/questions/import.test.tsx
git commit -m "fix: preserve docx list markers in question import"
```

---

## Task 2: Recover Choice Options From Ordered-List Markers in the Backend

**Files:**
- Modify: `backend/src/app/questions/service.py:871-877`
- Modify: `backend/src/app/questions/service.py:978-1058`
- Test: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write the failing backend regression tests**

Add these tests to `backend/tests/test_question_import_document_recognize.py`:

```python
def test_build_import_draft_maps_ordered_list_markers_to_choice_options() -> None:
    draft = build_import_draft_from_segment(
        """
        1. 下面关于数据分析说法正确的是（ ）
        [OL] 数据分析是数学、统计学理论结合科学的统计分析方法
        [OL] 数据分析是一种数学分析方法
        [OL] 数据分析是统计学分析方法
        [OL] 数据分析是大数据分析方法
        """
    )

    assert draft.type == "choice"
    assert draft.options == {
        "A": "数据分析是数学、统计学理论结合科学的统计分析方法",
        "B": "数据分析是一种数学分析方法",
        "C": "数据分析是统计学分析方法",
        "D": "数据分析是大数据分析方法",
    }
    assert draft.content_text == "下面关于数据分析说法正确的是（ ）"


def test_build_import_draft_keeps_unordered_steps_inside_non_choice_content() -> None:
    draft = build_import_draft_from_segment(
        """
        1. 请提交今日课堂作业：
        [UL] 提交 PDM 截图
        [UL] 提交 MySQL 数据库脚本截图
        [答案]
        """
    )

    assert draft.type == "short_answer"
    assert draft.options is None
    assert "提交 PDM 截图" in draft.content_text
    assert "提交 MySQL 数据库脚本截图" in draft.content_text
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_build_import_draft_maps_ordered_list_markers_to_choice_options tests/test_question_import_document_recognize.py::test_build_import_draft_keeps_unordered_steps_inside_non_choice_content -v
```

Expected: FAIL because `[OL]` / `[UL]` markers are currently treated as ordinary content lines.

- [ ] **Step 3: Add tagged-list parsing helpers**

In `backend/src/app/questions/service.py`, add a dataclass and helpers above `_extract_options()`:

```python
@dataclass(frozen=True)
class TaggedListLine:
    kind: str
    text: str


_TAGGED_LIST_LINE_RE = re.compile(r"^\[(OL|UL)\]\s*(.+)$", re.IGNORECASE)


def _parse_tagged_list_line(line: str) -> TaggedListLine | None:
    match = _TAGGED_LIST_LINE_RE.match(line.strip())
    if not match:
        return None
    return TaggedListLine(kind=match.group(1).upper(), text=match.group(2).strip())


def _looks_like_choice_prompt(text: str) -> bool:
    normalized = text.strip()
    return bool(
        re.search(r"(单项选择题|单项选择|单选题|单选|多项选择题|多项选择|多选题|多选|选择题|选择)", normalized)
        or re.search(r"(下列|以下).*(正确|错误|不正确|不属于|属于|是)", normalized)
    )
```

- [ ] **Step 4: Replace the option extractor with a structured version**

Replace `_extract_options(lines)` with a function that understands both explicit option prefixes and tagged ordered lists:

```python
def _extract_options(
    lines: list[str],
    *,
    type_hint_text: str = "",
    answer_text: str = "",
) -> tuple[dict[str, str], set[int]]:
    options: dict[str, str] = {}
    consumed_indexes: set[int] = set()

    for index, line in enumerate(lines):
        match = re.match(r"^([A-H])[\.．、\)]\s*(.+)$", line, re.IGNORECASE)
        if match:
            options[match.group(1).upper()] = match.group(2).strip()
            consumed_indexes.add(index)

    if options:
        return options, consumed_indexes

    tagged_lines: list[tuple[int, TaggedListLine]] = []
    for index, line in enumerate(lines):
        tagged = _parse_tagged_list_line(line)
        if tagged and tagged.kind == "OL":
            tagged_lines.append((index, tagged))

    choice_context = _looks_like_choice_prompt("\n".join(part for part in [type_hint_text, *lines] if part)) or bool(
        re.fullmatch(r"[A-H]+", answer_text.strip(), re.IGNORECASE)
    )
    if not choice_context or len(tagged_lines) < 2:
        return {}, set()

    for offset, (index, tagged) in enumerate(tagged_lines):
        if offset >= 8:
            break
        options[chr(65 + offset)] = tagged.text
        consumed_indexes.add(index)

    return options, consumed_indexes
```

- [ ] **Step 5: Update `build_import_draft_from_segment()` to exclude consumed option lines from `content_text`**

Inside `build_import_draft_from_segment()`, replace the old eager `options = _extract_options(lines)` with this sequence:

```python
answer_text = ""
analysis = ""
difficulty_text = ""
type_hint_text = type_hint or ""
content_lines: list[str] = []
collecting_field: str | None = None
answer_lines: list[str] = []
analysis_lines: list[str] = []

# first pass: capture answer/type/difficulty fields and preserve raw lines
```

After the loop and `flush_collecting_field()`, derive options using the final `type_hint_text` / `answer_text`:

```python
options, option_indexes = _extract_options(lines, type_hint_text=type_hint_text, answer_text=answer_text)

content_lines = []
for index, line in enumerate(lines):
    if index in option_indexes:
        continue
    if re.match(r"^(?:\[(答案|参考答案)\]|(答案|参考答案|answer))[:：]?\s*(.+)?$", line, re.IGNORECASE):
        continue
    if re.match(r"^(?:\[(解析|分析)\]|(解析|分析|analysis))[:：]?\s*(.+)?$", line, re.IGNORECASE):
        continue
    if re.match(r"^(?:\[(难度|难易度)\]|(难度|难易度|difficulty))[:：]?\s*(.+)?$", line, re.IGNORECASE):
        continue
    tagged = _parse_tagged_list_line(line)
    if tagged:
        content_lines.append(tagged.text)
        continue
    content_lines.append(_strip_question_start_prefix(line))
```

Keep the existing issue rules:

```python
if question_type == "choice" and len(options) < 2:
    issues.append("选择题选项不完整")
```

- [ ] **Step 6: Run the focused backend tests**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_build_import_draft_maps_ordered_list_markers_to_choice_options tests/test_question_import_document_recognize.py::test_build_import_draft_keeps_unordered_steps_inside_non_choice_content tests/test_question_import_document_recognize.py::test_paper_section_splits_continuous_word_text_and_keeps_choice_options -v
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/questions/service.py backend/tests/test_question_import_document_recognize.py
git commit -m "fix: recover choice options from docx list markers"
```

---

## Task 3: Add Import-Quality Signals for Incomplete DOCX Choice Recognition

**Files:**
- Modify: `backend/src/app/questions/schemas.py:236-264`
- Modify: `backend/src/app/questions/service.py:1497-1552`
- Modify: `frontend/src/pages/questions/import-types.ts:43-59`
- Test: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write the failing summary-schema test**

Add this test to `backend/tests/test_question_import_document_recognize.py`:

```python
async def test_document_summary_flags_docx_for_manual_review_when_choice_options_still_incomplete() -> None:
    response = await recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="questions.docx",
            source_format="docx",
            raw_text="""
            1. 单选题 下列哪项属于关系型数据库？
            [OL] MySQL
            [答案] A

            2. 单选题 下列哪项属于缓存系统？
            [OL] Redis
            [答案] A
            """,
        )
    )

    assert response.summary.incomplete_choice_count == 2
    assert response.summary.visual_retry_recommended is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_document_summary_flags_docx_for_manual_review_when_choice_options_still_incomplete -v
```

Expected: FAIL because the summary does not expose these fields yet.

- [ ] **Step 3: Extend the summary schema**

In `backend/src/app/questions/schemas.py`, update the model:

```python
class QuestionImportDocumentSummary(BaseModel):
    total: int
    duplicates_removed: int = 0
    high_confidence: int
    medium_confidence: int
    low_confidence: int
    issue_count: int
    pending_review: int
    approved: int
    skipped: int
    incomplete_choice_count: int = 0
    visual_retry_recommended: bool = False
```

Mirror the same fields in `frontend/src/pages/questions/import-types.ts`:

```ts
export interface QuestionImportDocumentSummary {
  total: number;
  duplicates_removed: number;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
  issue_count: number;
  pending_review: number;
  approved: number;
  skipped: number;
  incomplete_choice_count: number;
  visual_retry_recommended: boolean;
}
```

- [ ] **Step 4: Compute the new fields in the backend summary**

In `backend/src/app/questions/service.py`, add:

```python
def _count_incomplete_choice_drafts(drafts: list[QuestionImportDraft]) -> int:
    return sum(
        1
        for draft in drafts
        if draft.type == "choice" and "选择题选项不完整" in draft.issues
    )
```

Then update `recognize_question_document()` after `deduplicate_drafts()`:

```python
summary = build_import_document_summary(unique_drafts, duplicates_removed)
incomplete_choice_count = _count_incomplete_choice_drafts(unique_drafts)
visual_retry_recommended = payload.source_format == "docx" and incomplete_choice_count >= 2
summary = summary.model_copy(
    update={
        "incomplete_choice_count": incomplete_choice_count,
        "visual_retry_recommended": visual_retry_recommended,
    }
)

return QuestionImportDocumentRecognizeResponse(
    mode=mode,
    summary=summary,
    drafts=unique_drafts,
)
```

- [ ] **Step 5: Run the focused summary test**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_document_summary_flags_docx_for_manual_review_when_choice_options_still_incomplete -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/questions/schemas.py backend/src/app/questions/service.py backend/tests/test_question_import_document_recognize.py frontend/src/pages/questions/import-types.ts
git commit -m "feat: expose docx import quality signals"
```

---

## Task 4: Surface the DOCX Warning in the Review UI

**Files:**
- Modify: `frontend/src/pages/questions/import.tsx:219-312`
- Modify: `frontend/src/pages/questions/import.tsx:586-592`
- Modify: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing UI test**

Add this test to `frontend/src/pages/questions/import.test.tsx`:

```tsx
it("shows a docx quality warning when the backend recommends extra review", async () => {
  fetchMock.mockResolvedValueOnce(
    mockJsonResponse({
      mode: "smart",
      summary: {
        total: 2,
        duplicates_removed: 0,
        high_confidence: 0,
        medium_confidence: 2,
        low_confidence: 0,
        issue_count: 2,
        pending_review: 2,
        approved: 0,
        skipped: 0,
        incomplete_choice_count: 2,
        visual_retry_recommended: true,
      },
      drafts: [
        { ...baseDraft, draft_id: "1", issues: ["选择题选项不完整"] },
        { ...baseDraft, draft_id: "2", issues: ["选择题选项不完整"] },
      ],
    }),
  );

  render(<QuestionImportPage />);

  const file = new File(["docx-body"], "questions.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  fireEvent.change(screen.getByTestId("question-import-file-input"), {
    target: { files: [file] },
  });

  expect(await screen.findByText("当前 Word 文档可能使用了自动编号")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/frontend" && pnpm vitest run src/pages/questions/import.test.tsx -t "shows a docx quality warning when the backend recommends extra review"
```

Expected: FAIL because the page does not render any warning from `summary.visual_retry_recommended`.

- [ ] **Step 3: Render the warning alert in the page**

In `frontend/src/pages/questions/import.tsx`, derive a boolean after `summary`:

```tsx
const showDocxQualityWarning =
  documentPayload?.sourceFormat === "docx" && summary.visual_retry_recommended;
```

Then render a non-blocking warning near the existing error alert:

```tsx
{showDocxQualityWarning ? (
  <div className="mx-8 mt-4">
    <Alert className="flex items-start gap-3 rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-amber-800 [&>svg]:static [&>svg]:translate-y-0">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <AlertDescription className="text-sm font-medium leading-snug">
        当前 Word 文档可能使用了自动编号。系统已尽量恢复选项结构，但仍检测到多道选择题选项不完整，请重点核对这些题目后再导入。
      </AlertDescription>
    </Alert>
  </div>
) : null}
```

Do **not** add page-image fallback buttons in this task.

- [ ] **Step 4: Run the frontend test to verify it passes**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/frontend" && pnpm vitest run src/pages/questions/import.test.tsx -t "shows a docx quality warning when the backend recommends extra review"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/questions/import.tsx frontend/src/pages/questions/import.test.tsx
git commit -m "feat: warn on incomplete docx choice recognition"
```

---

## Task 5: Full Regression Verification

**Files:**
- Modify: none
- Test: `backend/tests/test_question_import_document_recognize.py`
- Test: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Run the backend regression suite**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -v
```

Expected: PASS

- [ ] **Step 2: Run the frontend regression suite**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/frontend" && pnpm vitest run src/pages/questions/import.test.tsx
```

Expected: PASS

- [ ] **Step 3: Run one focused manual smoke check**

Run the frontend dev server and backend if not already running, upload a DOCX with Word list-based options, and verify:

```text
1. 识别结果中每道单选题都出现 A/B/C/D 选项
2. 题干不再混入选项文本
3. 作业步骤列表仍然保留在非选择题内容里
4. 若仍有多道题缺选项，会出现 Word 自动编号警告
```

- [ ] **Step 4: Commit the verification-only follow-up if code changed during smoke fixing**

```bash
git add backend/src/app/questions/service.py backend/src/app/questions/schemas.py backend/tests/test_question_import_document_recognize.py frontend/src/pages/questions/import-utils.ts frontend/src/pages/questions/import-types.ts frontend/src/pages/questions/import.tsx frontend/src/pages/questions/import.test.tsx
git commit -m "test: verify docx question import regressions"
```

If the smoke check reveals no additional code changes, skip this commit.

---

## Self-Review Notes

- **Spec coverage:** This plan covers the approved Phase 1 requirements: preserve DOCX list structure, recover choice options from Word list items, avoid misclassifying step lists, and expose UI guidance when incomplete choice recognition remains. It intentionally does **not** cover page-image fallback; that requires a separate plan.
- **Placeholder scan:** No `TODO`, `TBD`, or “add appropriate handling” placeholders remain.
- **Type consistency:** Backend summary fields and frontend summary fields use the same names: `incomplete_choice_count` and `visual_retry_recommended`.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-10-docx-question-import-main-path.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

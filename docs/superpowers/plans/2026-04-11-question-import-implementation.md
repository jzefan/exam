# Question Import Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a document-level question import workflow that supports `pdf / docx / md`, template parsing, rule-first segmentation and type recognition, AI-assisted completion, and mandatory human review before bulk import.

**Architecture:** Keep file extraction and review UI in the frontend, but move document-level recognition into backend question import services. The backend returns import drafts with confidence, issues, and review state; the frontend renders a review workspace where teachers confirm or skip drafts before using the existing bulk question creation endpoint.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, React, TypeScript, Refine, shadcn/ui, pdfjs-dist, mammoth, vitest, pytest

---

## File Map

### Backend

- Modify: `backend/src/app/questions/schemas.py`
  - Add document-level import request/response schemas, draft metadata, review status enums, and template/smart mode summary types.
- Modify: `backend/src/app/questions/router.py`
  - Add `POST /import/document-recognize` and `POST /import/re-recognize`.
- Modify: `backend/src/app/questions/service.py`
  - Add template detection, rule-first segmentation, rule-based field extraction, type detection, confidence scoring, AI-assisted completion, and single-draft re-recognition helpers.
- Create: `backend/tests/test_question_import_document_recognize.py`
  - Cover template mode, smart mode, segmentation rules, type recognition, review flags, and re-recognition behavior.

### Frontend

- Modify: `frontend/src/pages/questions/import.tsx`
  - Replace current long-card import UI with a review workspace backed by document-recognition drafts and review status.
- Create: `frontend/src/pages/questions/import-types.ts`
  - Share frontend import draft, summary, mode, and review status types.
- Create: `frontend/src/pages/questions/import-utils.ts`
  - Centralize file-to-text extraction for `pdf / docx / md`, draft-to-question payload mapping, and frontend helper transforms.
- Create: `frontend/src/pages/questions/components/import-review-sidebar.tsx`
  - Left-side draft list with filters and review state badges.
- Create: `frontend/src/pages/questions/components/import-review-editor.tsx`
  - Right-side editor for a selected draft with confirm, skip, re-recognize, and AI-complete actions.
- Create: `frontend/src/pages/questions/components/import-summary-bar.tsx`
  - Top summary area for counts, source mode, file info, and quick filters.
- Create: `frontend/src/pages/questions/components/import-template-help.tsx`
  - Template instructions and supported field list for standard imports.
- Create: `frontend/src/pages/questions/import.test.tsx`
  - Cover review-required behavior, filters, confirm/skip flows, and payload generation.

## Task 1: Add Backend Document Import Schemas

**Files:**
- Modify: `backend/src/app/questions/schemas.py`
- Test: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write the failing backend schema test**

```python
from app.questions.schemas import (
    QuestionImportDocumentRecognizeRequest,
    QuestionImportDocumentRecognizeResponse,
)


def test_document_recognize_response_exposes_review_metadata():
    payload = QuestionImportDocumentRecognizeResponse.model_validate(
        {
            "mode": "smart",
            "summary": {
                "total": 2,
                "high_confidence": 1,
                "medium_confidence": 1,
                "low_confidence": 0,
                "issue_count": 1,
                "pending_review": 2,
                "approved": 0,
                "skipped": 0,
            },
            "drafts": [
                {
                    "draft_id": "draft-1",
                    "raw_text": "1. 单选题 下列哪项...",
                    "title": "下列哪项...",
                    "type": "choice",
                    "content_text": "下列哪项...",
                    "options": {"A": "关系型数据库", "B": "缓存"},
                    "answer_text": "A",
                    "analysis": "",
                    "difficulty": 2,
                    "segment_source": "rule",
                    "type_confidence": "high",
                    "boundary_confidence": "high",
                    "issues": [],
                    "review_status": "pending",
                    "review_required": True,
                }
            ],
        }
    )

    assert payload.summary.pending_review == 2
    assert payload.drafts[0].review_required is True
    assert payload.drafts[0].review_status == "pending"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_document_recognize_response_exposes_review_metadata -v
```

Expected: FAIL with import or validation errors because the new schemas do not exist yet.

- [ ] **Step 3: Add the schema types**

```python
class ImportRecognitionMode(str, Enum):
    TEMPLATE = "template"
    SMART = "smart"


class ImportConfidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ImportReviewStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    SKIPPED = "skipped"


class QuestionImportDraft(BaseModel):
    draft_id: str
    raw_text: str
    title: str
    type: QuestionType
    content_text: str
    options: dict[str, str] | None = None
    answer_text: str | None = None
    analysis: str | None = None
    difficulty: int = Field(ge=1, le=5)
    segment_source: str
    type_confidence: ImportConfidence
    boundary_confidence: ImportConfidence
    issues: list[str] = Field(default_factory=list)
    review_status: ImportReviewStatus = ImportReviewStatus.PENDING
    review_required: bool = True


class QuestionImportDocumentSummary(BaseModel):
    total: int
    high_confidence: int
    medium_confidence: int
    low_confidence: int
    issue_count: int
    pending_review: int
    approved: int
    skipped: int


class QuestionImportDocumentRecognizeRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    raw_text: str = Field(min_length=1, max_length=200000)
    source_format: str = Field(pattern="^(pdf|docx|md)$")
    prefer_template: bool = False


class QuestionImportDocumentRecognizeResponse(BaseModel):
    mode: ImportRecognitionMode
    summary: QuestionImportDocumentSummary
    drafts: list[QuestionImportDraft]
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_document_recognize_response_exposes_review_metadata -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/questions/schemas.py backend/tests/test_question_import_document_recognize.py
git commit -m "feat: add question import document schemas"
```

## Task 2: Implement Template Detection and Rule-First Segmentation

**Files:**
- Modify: `backend/src/app/questions/service.py`
- Test: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write failing segmentation tests**

```python
import pytest

from app.questions.service import (
    detect_import_template_mode,
    segment_question_document,
)


def test_detects_text_template_by_field_prefixes():
    raw_text = """
题型：单选题
题目内容：下列哪项属于关系型数据库？
答案：A
分析：MySQL 属于关系型数据库
难度：2
"""

    assert detect_import_template_mode(raw_text) == "template"


def test_segments_questions_by_numbering_and_type_keywords():
    raw_text = """
1. 单选题 下列哪项属于关系型数据库？
A. MySQL
B. Redis
答案：A

判断 下列说法是否正确：Redis 是关系型数据库。
答案：错误
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 2
    assert segments[0].raw_text.startswith("1.")
    assert segments[1].raw_text.startswith("判断")
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_detects_text_template_by_field_prefixes tests/test_question_import_document_recognize.py::test_segments_questions_by_numbering_and_type_keywords -v
```

Expected: FAIL because helpers are not implemented.

- [ ] **Step 3: Add template detection and segmentation helpers**

```python
_TEMPLATE_PREFIXES = ("题型：", "题目内容：", "答案：", "分析：", "难度：")
_QUESTION_START_PATTERNS = [
    re.compile(r"^\s*(\d+[\.．\)）]|[\(\（]\d+[\)）]|\[\d+\]|【\d+】|\d+、)\s*"),
    re.compile(r"^\s*([一二三四五六七八九十]+[、\.．])\s*"),
    re.compile(r"^\s*(单选题|单选|多选题|多选|选择题|判断题|判断|填空题|填空|简答题|简答|编程题|编程|论述题|论述)\b"),
]


def detect_import_template_mode(raw_text: str) -> str:
    paragraphs = [part.strip() for part in raw_text.splitlines() if part.strip()]
    prefix_hits = sum(
        1
        for line in paragraphs[:20]
        if any(line.startswith(prefix) for prefix in _TEMPLATE_PREFIXES)
    )
    return "template" if prefix_hits >= 3 else "smart"


@dataclass(slots=True)
class SegmentedBlock:
    raw_text: str
    segment_source: str
    boundary_confidence: str


def _is_question_start(line: str) -> tuple[bool, str]:
    for idx, pattern in enumerate(_QUESTION_START_PATTERNS):
        if pattern.search(line):
            return True, "high" if idx == 0 else "medium"
    return False, "low"


def segment_question_document(raw_text: str) -> list[SegmentedBlock]:
    lines = [line.rstrip() for line in raw_text.replace("\r\n", "\n").split("\n")]
    blocks: list[list[str]] = []
    current: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if current:
                current.append("")
            continue

        is_start, confidence = _is_question_start(stripped)
        if is_start and current:
            blocks.append(current)
            current = [stripped]
            continue

        current.append(stripped)

    if current:
        blocks.append(current)

    return [
        SegmentedBlock(
            raw_text="\n".join(part for part in block if part != "").strip(),
            segment_source="rule",
            boundary_confidence="high",
        )
        for block in blocks
        if any(part.strip() for part in block)
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_detects_text_template_by_field_prefixes tests/test_question_import_document_recognize.py::test_segments_questions_by_numbering_and_type_keywords -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/questions/service.py backend/tests/test_question_import_document_recognize.py
git commit -m "feat: add rule-based question document segmentation"
```

## Task 3: Implement Rule-Based Field Extraction and Type Recognition

**Files:**
- Modify: `backend/src/app/questions/service.py`
- Test: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write failing type-recognition tests**

```python
from app.questions.service import build_import_draft_from_segment


def test_build_import_draft_recognizes_true_false_from_answer_tokens():
    draft = build_import_draft_from_segment(
        "判断 下列说法是否正确：Redis 是关系型数据库。\n答案：错误"
    )

    assert draft.type == "true_false"
    assert draft.answer_text == "错误"
    assert draft.type_confidence == "high"


def test_build_import_draft_marks_choice_with_missing_options_as_issue():
    draft = build_import_draft_from_segment(
        "1. 单选题 下列哪项属于关系型数据库？\nA. MySQL\n答案：A"
    )

    assert draft.type == "choice"
    assert "选择题选项不完整" in draft.issues
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_build_import_draft_recognizes_true_false_from_answer_tokens tests/test_question_import_document_recognize.py::test_build_import_draft_marks_choice_with_missing_options_as_issue -v
```

Expected: FAIL because draft builder does not exist yet.

- [ ] **Step 3: Add field extraction and type recognition**

```python
def _extract_options(lines: list[str]) -> dict[str, str]:
    options: dict[str, str] = {}
    for line in lines:
        match = re.match(r"^([A-H])[\.．、\)]\s*(.+)$", line, re.IGNORECASE)
        if match:
            options[match.group(1).upper()] = match.group(2).strip()
    return options


def _detect_question_type(raw_text: str, options: dict[str, str], answer_text: str) -> tuple[str, str]:
    if re.search(r"(单选题|单选)", raw_text):
        return "choice", "high"
    if re.search(r"(多选题|多选)", raw_text):
        return "choice", "high"
    if re.search(r"(判断题|判断)", raw_text) or re.fullmatch(r"(正确|错误|对|错|√|×|T|F|True|False)", answer_text, re.IGNORECASE):
        return "true_false", "high"
    if re.search(r"(_{2,}|（\s*）|\(\s*\)|【\s*】|\[\s*\])", raw_text):
        return "fill_in", "high"
    if re.search(r"(编程题|程序设计|实现函数|示例输入|示例输出|```)", raw_text, re.IGNORECASE):
        return "code", "high"
    if re.search(r"(论述题|论述|阐述|分析并评价|结合实际谈谈)", raw_text):
        return "essay", "medium"
    if len(options) >= 2:
        return "choice", "medium"
    return "short_answer", "medium"


def build_import_draft_from_segment(raw_text: str) -> QuestionImportDraft:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    options = _extract_options(lines)
    answer_text = ""
    analysis = ""
    content_lines: list[str] = []

    for line in lines:
        answer_match = re.match(r"^(答案|参考答案)[:：]\s*(.+)$", line)
        analysis_match = re.match(r"^(解析|分析)[:：]\s*(.+)$", line)
        if answer_match:
            answer_text = answer_match.group(2).strip()
        elif analysis_match:
            analysis = analysis_match.group(2).strip()
        elif not re.match(r"^([A-H])[\.．、\)]\s*(.+)$", line, re.IGNORECASE):
            content_lines.append(line)

    content_text = "\n".join(content_lines).strip()
    q_type, type_confidence = _detect_question_type(content_text, options, answer_text)
    issues: list[str] = []
    if not content_text:
        issues.append("题目内容为空")
    if q_type == "choice" and len(options) < 2:
        issues.append("选择题选项不完整")
    if not answer_text:
        issues.append("未识别到答案")

    return QuestionImportDraft(
        draft_id=str(uuid.uuid4()),
        raw_text=raw_text,
        title=content_text[:120] or "未命名题目",
        type=q_type,
        content_text=content_text,
        options=options or None,
        answer_text=answer_text or None,
        analysis=analysis or None,
        difficulty=3,
        segment_source="rule",
        type_confidence=type_confidence,
        boundary_confidence="high",
        issues=issues,
        review_status="pending",
        review_required=True,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_build_import_draft_recognizes_true_false_from_answer_tokens tests/test_question_import_document_recognize.py::test_build_import_draft_marks_choice_with_missing_options_as_issue -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/questions/service.py backend/tests/test_question_import_document_recognize.py
git commit -m "feat: add question import rule-based type recognition"
```

## Task 4: Add AI-Assisted Completion and Document Recognition Endpoints

**Files:**
- Modify: `backend/src/app/questions/service.py`
- Modify: `backend/src/app/questions/router.py`
- Test: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write failing API tests**

```python
from httpx import AsyncClient


async def test_document_recognize_endpoint_returns_pending_review_drafts(client: AsyncClient, teacher_token: str):
    response = await client.post(
        "/api/questions/import/document-recognize",
        headers={"Authorization": f"Bearer {teacher_token}"},
        json={
            "file_name": "questions.md",
            "source_format": "md",
            "raw_text": "1. 单选题 下列哪项属于关系型数据库？\nA. MySQL\nB. Redis\n答案：A",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "smart"
    assert data["drafts"][0]["review_status"] == "pending"
    assert data["drafts"][0]["review_required"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py::test_document_recognize_endpoint_returns_pending_review_drafts -v
```

Expected: FAIL with 404 because the endpoint does not exist yet.

- [ ] **Step 3: Add service and router integration**

```python
async def complete_import_draft_with_ai(draft: QuestionImportDraft) -> QuestionImportDraft:
    if draft.type_confidence == "high" and draft.boundary_confidence == "high" and not draft.issues:
        return draft

    recognized = await recognize_imported_question(draft.raw_text)
    merged = draft.model_copy(
        update={
            "type": recognized.type,
            "content_text": recognized.content_text or draft.content_text,
            "options": recognized.options or draft.options,
            "answer_text": recognized.answer_text or draft.answer_text,
            "segment_source": "rule+ai",
            "type_confidence": "medium" if draft.type_confidence == "low" else draft.type_confidence,
            "review_status": "pending",
            "review_required": True,
        }
    )
    return merged


async def recognize_question_document(payload: QuestionImportDocumentRecognizeRequest) -> QuestionImportDocumentRecognizeResponse:
    mode = detect_import_template_mode(payload.raw_text) if not payload.prefer_template else "template"
    drafts = (
        parse_template_document(payload.raw_text)
        if mode == "template"
        else [build_import_draft_from_segment(segment.raw_text) for segment in segment_question_document(payload.raw_text)]
    )
    completed = [await complete_import_draft_with_ai(draft) for draft in drafts]
    summary = build_import_document_summary(completed, mode=mode)
    return QuestionImportDocumentRecognizeResponse(mode=mode, summary=summary, drafts=completed)
```

```python
@questions_router.post("/import/document-recognize", response_model=QuestionImportDocumentRecognizeResponse)
async def document_recognize_import_endpoint(
    data: QuestionImportDocumentRecognizeRequest,
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> QuestionImportDocumentRecognizeResponse:
    return await recognize_question_document(data)


@questions_router.post("/import/re-recognize", response_model=QuestionImportDraft)
async def re_recognize_import_draft_endpoint(
    data: QuestionImportRecognizeRequest,
    _user: Annotated[User, require_roles("admin", "teacher")],
) -> QuestionImportDraft:
    draft = build_import_draft_from_segment(data.raw_text)
    return await complete_import_draft_with_ai(draft)
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/questions/router.py backend/src/app/questions/service.py backend/tests/test_question_import_document_recognize.py
git commit -m "feat: add document-level question import recognition"
```

## Task 5: Add Frontend Import Draft Types and File Extraction Helpers

**Files:**
- Create: `frontend/src/pages/questions/import-types.ts`
- Create: `frontend/src/pages/questions/import-utils.ts`
- Test: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing frontend helper test**

```tsx
import { describe, expect, it } from "vitest";

import { buildImportableQuestions } from "./import-utils";

describe("buildImportableQuestions", () => {
  it("returns only approved drafts for bulk import", () => {
    const questions = buildImportableQuestions(
      [
        {
          draft_id: "a",
          review_status: "approved",
          review_required: true,
          type: "choice",
          title: "题目 A",
          content_text: "题目 A",
          options: { A: "A", B: "B" },
          answer_text: "A",
          analysis: "",
          difficulty: 2,
          issues: [],
        },
        {
          draft_id: "b",
          review_status: "pending",
          review_required: true,
          type: "short_answer",
          title: "题目 B",
          content_text: "题目 B",
          options: null,
          answer_text: "说明原因",
          analysis: "",
          difficulty: 3,
          issues: [],
        },
      ],
      "bank-1",
    );

    expect(questions).toHaveLength(1);
    expect(questions[0].question_bank_id).toBe("bank-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL because the helper file does not exist yet. If `vitest` is unavailable in this workspace, record that and still add the test file.

- [ ] **Step 3: Add shared types and utilities**

```ts
export type ImportRecognitionMode = "template" | "smart";
export type ImportConfidence = "high" | "medium" | "low";
export type ImportReviewStatus = "pending" | "approved" | "skipped";

export interface QuestionImportDraft {
  draft_id: string;
  raw_text: string;
  title: string;
  type: QuestionType;
  content_text: string;
  options: Record<string, string> | null;
  answer_text: string | null;
  analysis: string | null;
  difficulty: number;
  segment_source: string;
  type_confidence: ImportConfidence;
  boundary_confidence: ImportConfidence;
  issues: string[];
  review_status: ImportReviewStatus;
  review_required: boolean;
}
```

```ts
export function buildImportableQuestions(drafts: QuestionImportDraft[], questionBankId: string | null) {
  return drafts
    .filter((draft) => draft.review_status === "approved")
    .map((draft) => ({
      type: draft.type,
      title: draft.title || draft.content_text.slice(0, 120),
      content: {
        text: draft.content_text,
        html: `<p>${draft.content_text.replace(/\n/g, "<br />")}</p>`,
      },
      options: draft.type === "choice" ? draft.options : null,
      answer:
        draft.type === "choice"
          ? { correct: draft.answer_text ?? "" }
          : draft.type === "true_false"
            ? { correct: /^(正确|对|true)$/i.test(draft.answer_text ?? "") }
            : draft.type === "fill_in"
              ? { correct: (draft.answer_text ?? "").split(/[;,；\n]/).map((item) => item.trim()).filter(Boolean) }
              : draft.type === "code"
                ? { code: draft.answer_text ?? "" }
                : { points: (draft.answer_text ?? "").split(/\n+/).map((item) => item.trim()).filter(Boolean) },
      analysis: draft.analysis || null,
      difficulty: draft.difficulty,
      score: 10,
      tag_ids: [],
      knowledge_point_ids: [],
      question_bank_id: questionBankId,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS or note local dependency issue if `vitest` cannot execute in this environment.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/questions/import-types.ts frontend/src/pages/questions/import-utils.ts frontend/src/pages/questions/import.test.tsx
git commit -m "feat: add shared frontend question import draft helpers"
```

## Task 6: Build the Import Review Workspace Components

**Files:**
- Create: `frontend/src/pages/questions/components/import-summary-bar.tsx`
- Create: `frontend/src/pages/questions/components/import-review-sidebar.tsx`
- Create: `frontend/src/pages/questions/components/import-review-editor.tsx`
- Create: `frontend/src/pages/questions/components/import-template-help.tsx`
- Test: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write failing component behavior tests**

```tsx
it("filters sidebar drafts by pending review status", async () => {
  render(<QuestionImportPage />);

  expect(await screen.findByText(/待人工审核/i)).toBeInTheDocument();
});

it("disables final import while there are no approved drafts", async () => {
  render(<QuestionImportPage />);

  expect(screen.getByRole("button", { name: /导入已确认题目/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL because the review workspace UI does not exist yet.

- [ ] **Step 3: Create the UI components**

```tsx
// import-summary-bar.tsx
export function ImportSummaryBar({ summary, fileName, mode }: Props) {
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-6">
      <div>
        <p className="text-xs text-muted-foreground">文件</p>
        <p className="text-sm font-medium text-foreground">{fileName || "未选择文件"}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">模式</p>
        <p className="text-sm font-medium text-foreground">{mode === "template" ? "模板导入" : "智能识别"}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">待审核</p>
        <p className="text-sm font-semibold text-amber-600">{summary.pending_review}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">已确认</p>
        <p className="text-sm font-semibold text-emerald-600">{summary.approved}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">已跳过</p>
        <p className="text-sm font-semibold text-muted-foreground">{summary.skipped}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">异常题</p>
        <p className="text-sm font-semibold text-rose-600">{summary.issue_count}</p>
      </div>
    </div>
  );
}
```

```tsx
// import-review-sidebar.tsx
export function ImportReviewSidebar({ drafts, selectedDraftId, onSelect, filter, onFilterChange }: Props) {
  const visibleDrafts = drafts.filter((draft) => {
    if (filter === "pending") return draft.review_status === "pending";
    if (filter === "issues") return draft.issues.length > 0;
    if (filter === "low") return draft.type_confidence === "low" || draft.boundary_confidence === "low";
    return true;
  });

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card">
      <div className="border-b border-border p-3">
        <Button variant={filter === "pending" ? "default" : "outline"} size="sm" onClick={() => onFilterChange("pending")}>
          仅待人工审核
        </Button>
      </div>
      <div className="overflow-y-auto p-2">
        {visibleDrafts.map((draft, index) => (
          <button key={draft.draft_id} type="button" onClick={() => onSelect(draft.draft_id)}>
            {index + 1}. {draft.title}
          </button>
        ))}
      </div>
    </div>
  );
}
```

```tsx
// import-review-editor.tsx
export function ImportReviewEditor({ draft, onChange, onApprove, onSkip, onRerunAi }: Props) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Badge>{draft.review_status === "pending" ? "待审核" : draft.review_status === "approved" ? "已确认" : "已跳过"}</Badge>
        <Badge variant="outline">{draft.segment_source}</Badge>
      </div>
      <Input value={draft.title} onChange={(event) => onChange({ title: event.target.value })} />
      <Textarea value={draft.content_text} onChange={(event) => onChange({ content_text: event.target.value })} />
      <div className="flex gap-2">
        <Button type="button" onClick={onRerunAi}>AI 补全当前题</Button>
        <Button type="button" onClick={onApprove}>确认当前题</Button>
        <Button type="button" variant="outline" onClick={onSkip}>跳过该题</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS or document local test-runner limitations.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/questions/components/import-summary-bar.tsx frontend/src/pages/questions/components/import-review-sidebar.tsx frontend/src/pages/questions/components/import-review-editor.tsx frontend/src/pages/questions/components/import-template-help.tsx frontend/src/pages/questions/import.test.tsx
git commit -m "feat: add question import review workspace components"
```

## Task 7: Refactor the Question Import Page to Use Document Recognition and Human Review

**Files:**
- Modify: `frontend/src/pages/questions/import.tsx`
- Modify: `frontend/src/pages/questions/import-utils.ts`
- Modify: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write failing page integration tests**

```tsx
it("marks AI-completed drafts as pending review and requires approval before import", async () => {
  render(<QuestionImportPage />);

  expect(await screen.findByText(/待审核/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /导入已确认题目/i })).toBeDisabled();
});

it("includes only approved drafts when submitting bulk import", async () => {
  render(<QuestionImportPage />);

  await user.click(await screen.findByRole("button", { name: /确认当前题/i }));
  await user.click(screen.getByRole("button", { name: /导入已确认题目/i }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/questions/bulk",
    expect.objectContaining({
      body: expect.stringContaining("\"questions\":["),
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: FAIL because the page still uses the old draft model and import flow.

- [ ] **Step 3: Refactor the page**

```tsx
const [drafts, setDrafts] = useState<QuestionImportDraft[]>([]);
const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
const [filter, setFilter] = useState<"all" | "pending" | "issues" | "low">("pending");

async function processImportFile(file: File) {
  const rawText = await extractQuestionImportText(file);
  const payload = await questionApiFetch<QuestionImportDocumentRecognizeResponse>("/api/questions/import/document-recognize", {
    method: "POST",
    body: JSON.stringify({
      file_name: file.name,
      source_format: detectQuestionImportFormat(file.name),
      raw_text: rawText,
    }),
  });
  setDrafts(payload.drafts);
  setSelectedDraftId(payload.drafts[0]?.draft_id ?? null);
}

function updateDraft(draftId: string, patch: Partial<QuestionImportDraft>) {
  setDrafts((current) =>
    current.map((draft) =>
      draft.draft_id === draftId
        ? {
            ...draft,
            ...patch,
            review_status: patch.review_status ?? "pending",
          }
        : draft,
    ),
  );
}

async function importApprovedDrafts() {
  const questions = buildImportableQuestions(drafts, questionBankId === "__none__" ? null : questionBankId);
  if (questions.length === 0) {
    setParseError("请先人工确认至少一道题目后再导入。");
    return;
  }
  await questionApiFetch("/api/questions/bulk", {
    method: "POST",
    body: JSON.stringify({ questions }),
  });
}
```

- [ ] **Step 4: Run tests and lint**

Run:

```bash
cd frontend && ./node_modules/.bin/eslint src/pages/questions/import.tsx src/pages/questions/import-utils.ts src/pages/questions/components/import-summary-bar.tsx src/pages/questions/components/import-review-sidebar.tsx src/pages/questions/components/import-review-editor.tsx
```

Expected: PASS

Run:

```bash
cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS or document local dependency issues if `vitest` remains unavailable.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/questions/import.tsx frontend/src/pages/questions/import-utils.ts frontend/src/pages/questions/import.test.tsx frontend/src/pages/questions/components/import-summary-bar.tsx frontend/src/pages/questions/components/import-review-sidebar.tsx frontend/src/pages/questions/components/import-review-editor.tsx
git commit -m "feat: require human review in question import flow"
```

## Task 8: Verification and Documentation Cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-04-11-question-import-design.md`
- Modify: `docs/superpowers/plans/2026-04-11-question-import-implementation.md`
- Test: `backend/tests/test_question_import_document_recognize.py`
- Test: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Run backend verification**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -v
```

Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run:

```bash
cd frontend && ./node_modules/.bin/eslint src/pages/questions/import.tsx src/pages/questions/import-utils.ts src/pages/questions/components/import-summary-bar.tsx src/pages/questions/components/import-review-sidebar.tsx src/pages/questions/components/import-review-editor.tsx src/pages/questions/import.test.tsx
```

Expected: PASS

Run:

```bash
cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx
```

Expected: PASS or, if `vitest` still cannot run in this workspace, record the exact dependency issue in the final handoff.

- [ ] **Step 3: Update docs with any implementation deltas**

```md
- Confirm whether `choice` remains a single type or receives a `subtype`
- Record the exact supported file formats in the UI copy
- Record any first-phase fallback behavior for low-confidence drafts
```

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/specs/2026-04-11-question-import-design.md docs/superpowers/plans/2026-04-11-question-import-implementation.md
git commit -m "docs: finalize question import implementation plan"
```

- [ ] **Step 5: Final handoff notes**

```md
- Backend document recognition is the system of record for import drafts.
- Human review is mandatory before bulk import.
- `vitest` execution may still be blocked by local dependency issues; if so, preserve eslint + pytest evidence and note the blocker explicitly.
```

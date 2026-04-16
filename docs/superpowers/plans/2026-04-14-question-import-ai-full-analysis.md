# Question Import AI Full Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dual-entry question import flow with stronger paragraph-based segmentation, whole-document AI analysis with image inputs, rule-vs-AI comparison flags, and clear frontend loading/error handling.

**Architecture:** Keep the existing `document-recognize` endpoint as the main entry, but extend it with `analysis_mode` and image payloads. The backend will first compute a rule-based baseline, optionally call a whole-document AI recognizer that returns strict JSON, then merge and compare the two outputs into `QuestionImportDraft` records. The frontend upload page will offer `快速识别` and `AI 一键分析整个文件`, collect uploaded image metadata, and surface fixed-position loading plus immediate failure feedback.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, Vitest, React, TypeScript, pdfjs-dist, mammoth

---

### Task 1: Extend import schemas and backend tests for AI full-document requests

**Files:**
- Modify: `backend/src/app/questions/schemas.py`
- Modify: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write the failing backend tests for analysis mode and image payload support**

```python
def test_document_recognize_request_supports_ai_full_and_images() -> None:
    payload = QuestionImportDocumentRecognizeRequest.model_validate(
        {
            "file_name": "questions.docx",
            "source_format": "docx",
            "raw_text": "观察图片回答问题\\n[IMAGE:image-1]",
            "analysis_mode": "ai_full",
            "images": [
                {
                    "image_id": "image-1",
                    "url": "https://example.com/image-1.png",
                    "order": 1,
                    "page": 1,
                    "alt": "示意图",
                }
            ],
        }
    )

    assert payload.analysis_mode == "ai_full"
    assert payload.images[0].image_id == "image-1"
```

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -q -k "analysis_mode_supports_ai_full or image_payload_support"`
Expected: FAIL because request schema does not yet include `analysis_mode` or `images`.

- [ ] **Step 2: Add minimal schema support**

```python
class QuestionImportImageInput(BaseModel):
    image_id: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=2048)
    order: int = Field(ge=0)
    page: int | None = Field(default=None, ge=1)
    alt: str | None = Field(default=None, max_length=255)


class QuestionImportAnalysisMode(str, Enum):
    FAST = "fast"
    AI_FULL = "ai_full"


class QuestionImportDocumentRecognizeRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    raw_text: str = Field(min_length=1, max_length=200000)
    source_format: str = Field(pattern="^(pdf|docx|md)$")
    prefer_template: bool = False
    analysis_mode: QuestionImportAnalysisMode = QuestionImportAnalysisMode.FAST
    images: list[QuestionImportImageInput] = Field(default_factory=list, max_length=200)
```

- [ ] **Step 3: Re-run the targeted backend tests**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -q -k "analysis_mode_supports_ai_full or image_payload_support"`
Expected: PASS

### Task 2: Strengthen paragraph/block segmentation with field-block awareness

**Files:**
- Modify: `backend/src/app/questions/service.py`
- Modify: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write failing tests for block-based segmentation**

```python
def test_segments_questions_by_paragraph_blocks_and_field_lines() -> None:
    raw_text = """
1. 单选题 下列哪项属于关系型数据库？

A. MySQL
B. Redis
[答案] A
[解析] MySQL 属于关系型数据库。

2. 简答题
请简述事务的 ACID 特性。
[答案] 原子性、一致性、隔离性、持久性。
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 2
    assert "[答案] A" in segments[0].raw_text
    assert "请简述事务的 ACID 特性。" in segments[1].raw_text
```

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -q -k "paragraph_blocks_and_field_lines"`
Expected: FAIL if segmentation still behaves as line-by-line accumulation without explicit block semantics.

- [ ] **Step 2: Implement block extraction and updated segmentation**

```python
@dataclass(slots=True)
class SegmentedParagraphBlock:
    text: str
    kind: str
    page: int | None = None


def _split_document_into_blocks(raw_text: str) -> list[SegmentedParagraphBlock]:
    # split by blank lines, preserve field-only lines and image markers as standalone blocks
    ...


def segment_question_document(raw_text: str) -> list[SegmentedBlock]:
    blocks = _split_document_into_blocks(raw_text)
    ...
```

Key rules:
- blank lines create paragraph blocks
- `[题型]/[答案]/[解析]/[难度]` and colon-field lines become standalone blocks
- `[IMAGE:image-x]` blocks attach to current question
- a field-only block never starts a new question unless it is `[题型]`

- [ ] **Step 3: Re-run the targeted segmentation tests**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -q -k "segments_questions_by_numbering_and_type_keywords or paragraph_blocks_and_field_lines or detects_bracket_template_and_parses_every_question"`
Expected: PASS

### Task 3: Add strict whole-document AI recognition and merge logic

**Files:**
- Modify: `backend/src/app/questions/service.py`
- Modify: `backend/src/app/questions/schemas.py`
- Modify: `backend/tests/test_question_import_document_recognize.py`

- [ ] **Step 1: Write failing backend tests for whole-document AI recognition and comparison flags**

```python
async def test_ai_full_document_recognize_merges_ai_results_with_rule_flags(monkeypatch) -> None:
    async def fake_request(_prompt: str) -> dict:
        return {
            "questions": [
                {
                    "type": "choice",
                    "content_text": "我国首都是哪里？",
                    "options": {"A": "北京", "B": "上海"},
                    "answer_text": "A",
                    "analysis": "北京是中国首都。",
                    "difficulty": 2,
                    "raw_text": "1. 选择题 我国首都是哪里？",
                    "images": ["image-1"],
                }
            ]
        }

    monkeypatch.setattr("app.questions.service._request_deepseek_json", fake_request)

    response = await recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="questions.md",
            source_format="md",
            raw_text="1. 选择题 我国首都是哪里？\\n[IMAGE:image-1]\\nA. 北京\\nB. 上海\\n[答案] A",
            analysis_mode="ai_full",
            images=[QuestionImportImageInput(image_id="image-1", url="https://example.com/a.png", order=1)],
        )
    )

    assert response.mode == "smart"
    assert response.drafts[0].segment_source == "ai_full+rule"
    assert response.drafts[0].images[0]["image_id"] == "image-1"
    assert response.drafts[0].comparison_flags == []
```

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -q -k "ai_full_document_recognize_merges_ai_results_with_rule_flags or ai_full_document_recognize_marks_count_mismatch"`
Expected: FAIL because whole-document AI path and comparison flags do not exist yet.

- [ ] **Step 2: Implement minimal whole-document AI recognition**

```python
async def recognize_question_document_with_ai(
    payload: QuestionImportDocumentRecognizeRequest,
    baseline: list[QuestionImportDraft],
) -> list[QuestionImportDraft]:
    prompt = _build_document_ai_prompt(payload.raw_text, payload.images)
    data = await _request_deepseek_json(prompt)
    questions = _validate_ai_document_questions(data)
    ai_drafts = [_build_ai_import_draft(question, payload.images) for question in questions]
    return merge_ai_and_rule_recognition(ai_drafts, baseline)
```

Required minimal helpers:
- `_build_document_ai_prompt`
- `_validate_ai_document_questions`
- `_build_ai_import_draft`
- `merge_ai_and_rule_recognition`

`merge_ai_and_rule_recognition` responsibilities:
- cap trust to AI output only if JSON is valid
- add `comparison_flags`
- convert severe mismatches into blocking issues
- keep `未识别到答案` as non-blocking

- [ ] **Step 3: Route `analysis_mode="ai_full"` through the new recognizer**

```python
async def recognize_question_document(
    payload: QuestionImportDocumentRecognizeRequest,
) -> QuestionImportDocumentRecognizeResponse:
    baseline = _build_rule_or_template_drafts(payload)
    if payload.analysis_mode == QuestionImportAnalysisMode.AI_FULL:
        drafts = await recognize_question_document_with_ai(payload, baseline)
    else:
        drafts = [await complete_import_draft_with_ai(draft) for draft in baseline]
    ...
```

- [ ] **Step 4: Re-run the targeted backend tests**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -q -k "ai_full_document_recognize_merges_ai_results_with_rule_flags or ai_full_document_recognize_marks_count_mismatch or document_recognize_endpoint_returns_pending_review_drafts"`
Expected: PASS

### Task 4: Surface AI full-analysis controls and file image payloads in the frontend

**Files:**
- Modify: `frontend/src/pages/questions/import.tsx`
- Modify: `frontend/src/pages/questions/import-utils.ts`
- Modify: `frontend/src/pages/questions/import-types.ts`
- Test: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write failing frontend tests for dual import entry and image payload extraction**

```tsx
it("shows fast and ai-full analysis actions on the upload screen", () => {
  render(<QuestionImportPage />);

  expect(screen.getByRole("button", { name: "快速识别" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AI 一键分析整个文件" })).toBeInTheDocument();
});
```

```ts
it("extracts markdown image metadata with anchor tokens", async () => {
  const file = new File(["题干\\n![图1](https://example.com/a.png)"], "questions.md", { type: "text/markdown" });

  const result = await extractQuestionImportPayload(file);

  expect(result.rawText).toContain("[IMAGE:image-1]");
  expect(result.images).toEqual([
    expect.objectContaining({ image_id: "image-1", url: "https://example.com/a.png", order: 1 }),
  ]);
});
```

Run: `cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx`
Expected: FAIL because there is no dual-entry UI or image payload helper.

- [ ] **Step 2: Implement import payload extraction**

```ts
export type QuestionImportImageInput = {
  image_id: string;
  url: string;
  order: number;
  page?: number;
  alt?: string;
};

export async function extractQuestionImportPayload(file: File): Promise<{
  rawText: string;
  sourceFormat: "pdf" | "docx" | "md";
  images: QuestionImportImageInput[];
}> {
  ...
}
```

Rules:
- markdown image syntax becomes `[IMAGE:image-x]` plus metadata entry
- docx embedded images continue uploading, then emit anchors + metadata
- pdf pages with detected images emit page-scoped image placeholders when an uploadable image is unavailable; if actual extraction is not possible, send no image object and keep the placeholder text for manual review

- [ ] **Step 3: Add dual-entry buttons and pass `analysis_mode`**

```tsx
const processImportFile = async (
  file: File | null | undefined,
  analysisMode: "fast" | "ai_full",
) => {
  const payload = await extractQuestionImportPayload(file);
  await questionApiFetch<QuestionImportDocumentRecognizeResponse>(
    "/api/questions/import/document-recognize",
    {
      method: "POST",
      body: JSON.stringify({
        file_name: file.name,
        raw_text: payload.rawText,
        source_format: payload.sourceFormat,
        analysis_mode: analysisMode,
        images: payload.images,
      }),
    },
  );
};
```

- [ ] **Step 4: Re-run the targeted frontend tests**

Run: `cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx`
Expected: PASS

### Task 5: Add fixed AI-loading and immediate failure handling in the import page

**Files:**
- Modify: `frontend/src/pages/questions/import.tsx`
- Test: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write failing tests for AI-loading state and error reset**

```tsx
it("shows a dedicated ai-full loading message while analyzing the whole file", async () => {
  ...
  expect(await screen.findByText("AI 正在分析整份文档")).toBeInTheDocument();
});
```

```tsx
it("stops loading immediately when ai-full analysis fails", async () => {
  ...
  expect(await screen.findByText("AI 分析结果格式异常，请重试")).toBeInTheDocument();
  expect(screen.queryByText("AI 正在分析整份文档")).not.toBeInTheDocument();
});
```

Run: `cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx`
Expected: FAIL because the page only has a generic parsing spinner.

- [ ] **Step 2: Implement separate AI-full loading state**

```tsx
const [analysisMode, setAnalysisMode] = useState<"fast" | "ai_full">("fast");

{loading ? (
  <div>
    <p>{analysisMode === "ai_full" ? "AI 正在分析整份文档" : "正在解析文档"}</p>
    <p>
      {analysisMode === "ai_full"
        ? "正在理解题目结构与图片内容，请稍候"
        : "AI 正在努力识别并拆分题目..."}
    </p>
  </div>
) : ...}
```

Implementation rules:
- reset `loading` in `finally`
- preserve backend error message
- if AI-full fails, keep the upload screen visible so the user can retry

- [ ] **Step 3: Re-run the targeted frontend tests**

Run: `cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx`
Expected: PASS

### Task 6: Run focused verification for backend and frontend

**Files:**
- Modify: `backend/src/app/questions/schemas.py`
- Modify: `backend/src/app/questions/service.py`
- Modify: `backend/tests/test_question_import_document_recognize.py`
- Modify: `frontend/src/pages/questions/import.tsx`
- Modify: `frontend/src/pages/questions/import-utils.ts`
- Modify: `frontend/src/pages/questions/import-types.ts`
- Modify: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Run backend verification**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_import_document_recognize.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `cd frontend && ./node_modules/.bin/vitest run src/pages/questions/import.test.tsx`
Expected: PASS

- [ ] **Step 3: Run lint on touched frontend files**

Run: `cd frontend && ./node_modules/.bin/eslint src/pages/questions/import.tsx src/pages/questions/import-utils.ts src/pages/questions/import-types.ts src/pages/questions/import.test.tsx`
Expected: PASS

- [ ] **Step 4: Run spec-to-implementation checklist**

Checklist:
- fast and ai-full entries both present
- paragraph/block segmentation enhanced
- whole-document AI path accepts images
- AI JSON validation exists
- rule-vs-AI comparison flags exist
- loading and error handling are explicit

Expected: every item has matching code and passing tests

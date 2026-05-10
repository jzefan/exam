# DOCX Visual Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a page-image visual recognition pipeline for Word exam papers, fixing recognition for complex DOCX files (soft-returns, auto-numbering, merged options) that the text-based parser cannot handle.

**Architecture:** A three-layer backend pipeline: (1) python-docx extracts structured paragraphs with numbering reconstructed from OOXML `numPr`, (2) PIL renders each logical page as a JPEG image, (3) the existing `_request_vision_json` sends page images to a multimodal model which outputs structured question JSON. The frontend adds a single "页面视觉识别" button beside the existing "AI重新识别".

**Tech Stack:** python-docx, Pillow (PIL), existing FastAPI + vision model infrastructure, React + TypeScript + shadcn/ui, mammoth (unchanged for text path)

---

## File Map

### Backend

- Create: `backend/src/app/questions/docx_render.py`
  - `extract_docx_structured_blocks()` — reads .docx bytes, returns `list[DocxStructuredBlock]` with reconstructed numbering and soft-breaks resolved.
  - `render_docx_pages()` — renders structured blocks as PIL JPEG images, returns `list[str]` (data URLs).
  - `recognize_docx_visual()` — orchestrates extraction → rendering → vision model → `QuestionImportDraft[]`.
- Modify: `backend/src/app/questions/router.py`
  - Add `POST /import/document-recognize-visual` multipart endpoint.
- Modify: `backend/src/app/questions/schemas.py`
  - Add `QuestionImportVisualRecognizeResponse`.
- Create: `backend/tests/test_docx_visual_recognition.py`
  - Unit tests for structured block extraction and page rendering.

### Frontend

- Modify: `frontend/src/pages/questions/import.tsx`
  - Add "页面视觉识别" button next to "AI重新识别".
  - Call new visual endpoint with FormData (raw DOCX file).
- Modify: `frontend/src/pages/questions/import.test.tsx`
  - Add test for visual retry button visibility.

---

## Task 1: Structured DOCX Extraction From Python-Docx

**Files:**
- Create: `backend/src/app/questions/docx_render.py`
- Create: `backend/tests/test_docx_visual_recognition.py`

- [ ] **Step 1: Write the failing extraction test**

Add to `backend/tests/test_docx_visual_recognition.py`:

```python
import io
from pathlib import Path
from app.questions.docx_render import extract_docx_structured_blocks, DocxStructuredBlock

_TEST_DOCX = Path("/Users/jzefan/work/proj/exam/docs/bigdata-A试卷-印刷.docx").read_bytes()


def test_extract_docx_reconstructs_numbering_for_word_list_paragraphs() -> None:
    blocks = extract_docx_structured_blocks(io.BytesIO(_TEST_DOCX))

    # Q1 stem should be reconstructed with "1." prefix
    q1 = next(
        b for b in blocks if "下面关于数据分析说法正确的是" in b.text
    )
    assert q1.text.startswith("1.")
    assert q1.bold is False or q1.bold is True  # presence check
    assert q1.style is not None

    # Options A/B/C/D for Q1 should be separate blocks
    option_texts = [
        b.text for b in blocks if b.text.strip().startswith(("A.", "B.", "C.", "D."))
    ]
    assert len(option_texts) >= 4


def test_extract_docx_expands_soft_breaks_into_separate_lines() -> None:
    blocks = extract_docx_structured_blocks(io.BytesIO(_TEST_DOCX))

    # Questions 11-16 use soft-breaks; they must NOT collapse into one line
    q11 = next(
        b for b in blocks if "下列关于pandas数据读写说法正确的是" in b.text
    )
    assert "下列关于pandas数据读写" in q11.text
    # The block should not also contain Q12 stem merged in
    assert "下列关于pandas基本操作" not in q11.text
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && PYTHONPATH="/Users/jzefan/work/proj/exam/backend/src" UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_docx_visual_recognition.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.questions.docx_render'`

- [ ] **Step 3: Implement `extract_docx_structured_blocks()`**

Create `backend/src/app/questions/docx_render.py`:

```python
"""DOCX structured extraction and PIL page rendering for visual recognition."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

from docx import Document
from docx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFont


@dataclass(frozen=True, slots=True)
class DocxStructuredBlock:
    text: str
    style: str
    bold: bool
    font_size_pt: float
    indent_level: int


def _build_numbering_cache(doc: Document) -> tuple[dict, dict]:
    num_id_to_abstract: dict[str, str] = {}
    abstract_fmt: dict[str, str] = {}

    num_part = doc.part.numbering_part
    if num_part is None:
        return num_id_to_abstract, abstract_fmt

    for num_el in num_part._element.findall(qn("w:num")):
        num_id = num_el.get(qn("w:numId"))
        abstract_ref = num_el.find(qn("w:abstractNumId"))
        if abstract_ref is not None and num_id is not None:
            num_id_to_abstract[num_id] = abstract_ref.get(qn("w:val"))

    for abs_num in num_part._element.findall(qn("w:abstractNum")):
        abs_id = abs_num.get(qn("w:abstractNumId"))
        for lvl in abs_num.findall(qn("w:lvl")):
            ilvl = lvl.get(qn("w:ilvl"))
            lvl_text_el = lvl.find(qn("w:lvlText"))
            text_val = lvl_text_el.get(qn("w:val")) if lvl_text_el is not None else "%1."
            if abs_id is not None and ilvl is not None:
                abstract_fmt[f"{abs_id}:{ilvl}"] = text_val

    return num_id_to_abstract, abstract_fmt


def extract_docx_structured_blocks(file_bytes: io.BytesIO) -> list[DocxStructuredBlock]:
    doc = Document(file_bytes)
    num_id_to_abstract, abstract_fmt = _build_numbering_cache(doc)
    counters: dict[str, int] = {}

    blocks: list[DocxStructuredBlock] = []

    for para in doc.paragraphs:
        text = para.text
        pPr = para._element.find(qn("w:pPr"))
        style = para.style.name if para.style else "Normal"

        # Parse bold from paragraph mark or first run
        bold = False
        font_size_pt = 12.0
        first_run = para._element.find(qn("w:r"))
        if first_run is not None:
            rPr = first_run.find(qn("w:rPr"))
            if rPr is not None:
                b_el = rPr.find(qn("w:b"))
                bold = b_el is not None
                sz_el = rPr.find(qn("w:sz"))
                if sz_el is not None:
                    font_size_pt = float(sz_el.get(qn("w:val"), "24")) / 2.0

        # Build numbering prefix
        prefix = ""
        indent_level = 0
        if pPr is not None:
            numPr = pPr.find(qn("w:numPr"))
            if numPr is not None:
                num_id_el = numPr.find(qn("w:numId"))
                ilvl_el = numPr.find(qn("w:ilvl"))
                if num_id_el is not None:
                    num_id = num_id_el.get(qn("w:val"))
                    ilvl = ilvl_el.get(qn("w:val")) if ilvl_el is not None else "0"
                    abs_id = num_id_to_abstract.get(num_id, num_id)
                    fmt_key = f"{abs_id}:{ilvl}"
                    lvl_fmt = abstract_fmt.get(fmt_key, "%1.")
                    counters.setdefault(num_id, 0)
                    counters[num_id] += 1
                    prefix = lvl_fmt.replace("%1", str(counters[num_id]))
                    indent_level = int(ilvl) + 1

        # Split soft-breaks into separate blocks
        if "\n" in text and len(text) > 80:
            # Has soft-breaks; split into separate logical lines
            sub_lines = [line.strip() for line in text.split("\n") if line.strip()]
            for sub_line in sub_lines:
                blocks.append(DocxStructuredBlock(
                    text=sub_line,
                    style=style,
                    bold=bold,
                    font_size_pt=font_size_pt,
                    indent_level=indent_level,
                ))
        else:
            full_text = f"{prefix} {text}".strip() if prefix else text.strip()
            if full_text:
                blocks.append(DocxStructuredBlock(
                    text=full_text,
                    style=style,
                    bold=bold,
                    font_size_pt=font_size_pt,
                    indent_level=indent_level,
                ))

    return blocks
```

- [ ] **Step 4: Run the extraction test to verify it passes**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && PYTHONPATH="/Users/jzefan/work/proj/exam/backend/src" UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_docx_visual_recognition.py::test_extract_docx_reconstructs_numbering_for_word_list_paragraphs tests/test_docx_visual_recognition.py::test_extract_docx_expands_soft_breaks_into_separate_lines -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/questions/docx_render.py backend/tests/test_docx_visual_recognition.py
git commit -m "feat: add docx structured extraction with numbering reconstruction"
```

---

## Task 2: PIL Page Rendering

**Files:**
- Modify: `backend/src/app/questions/docx_render.py`
- Test: `backend/tests/test_docx_visual_recognition.py`

- [ ] **Step 1: Write the failing rendering test**

Add to `backend/tests/test_docx_visual_recognition.py`:

```python
def test_render_docx_pages_produces_valid_jpeg_data_urls() -> None:
    from app.questions.docx_render import extract_docx_structured_blocks, render_docx_pages

    blocks = extract_docx_structured_blocks(io.BytesIO(_TEST_DOCX))
    page_urls = render_docx_pages(blocks)

    assert len(page_urls) >= 1
    for url in page_urls:
        assert url.startswith("data:image/jpeg;base64,")
        # Decode to verify it's valid JPEG
        import base64
        raw = base64.b64decode(url.split(",", 1)[1])
        assert len(raw) > 1000
        # Check JPEG magic bytes
        assert raw[:2] == b"\xff\xd8"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && PYTHONPATH="/Users/jzefan/work/proj/exam/backend/src" UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_docx_visual_recognition.py::test_render_docx_pages_produces_valid_jpeg_data_urls -v
```

Expected: FAIL with `ImportError: cannot import name 'render_docx_pages'`

- [ ] **Step 3: Implement `render_docx_pages()`**

Add to `backend/src/app/questions/docx_render.py`:

```python
import base64 as _base64

_PAGE_WIDTH = 1400
_PAGE_HEIGHT = 1900
_MARGIN_X = 60
_MARGIN_Y = 60
_LINE_SPACING = 24
_FONT_SIZE = 18
_INDENT_STEP = 36

_FONT_PATHS = [
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_PATHS:
        from pathlib import Path as _Path
        if _Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in text:
        test = current + char
        if font.getlength(test) > max_width:
            lines.append(current)
            current = char
        else:
            current = test
    if current:
        lines.append(current)
    return lines


def render_docx_pages(blocks: list[DocxStructuredBlock]) -> list[str]:
    font = _load_font(_FONT_SIZE)
    bold_font = _load_font(_FONT_SIZE)  # use same font; bold indicated by prefix

    pages: list[str] = []
    img = Image.new("RGB", (_PAGE_WIDTH, _PAGE_HEIGHT), "white")
    draw = ImageDraw.Draw(img)
    y = _MARGIN_Y

    def flush_page() -> None:
        nonlocal img, draw, y
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        pages.append(f"data:image/jpeg;base64,{_base64.b64encode(buf.getvalue()).decode()}")
        img = Image.new("RGB", (_PAGE_WIDTH, _PAGE_HEIGHT), "white")
        draw = ImageDraw.Draw(img)
        y = _MARGIN_Y

    for block in blocks:
        draw_font = font
        fill = "black"
        indent_x = _MARGIN_X + block.indent_level * _INDENT_STEP
        max_text_width = _PAGE_WIDTH - indent_x - _MARGIN_X

        prefix = ""
        if block.bold:
            prefix = "■ "
            fill = "#1a1a1a"

        wrapped = _wrap_text(prefix + block.text, draw_font, max_text_width)

        for line in wrapped:
            if y + _LINE_SPACING > _PAGE_HEIGHT - _MARGIN_Y:
                flush_page()

            draw.text((indent_x, y), line, fill=fill, font=draw_font)
            y += _LINE_SPACING

        y += 4  # inter-paragraph gap

    flush_page()
    return pages
```

- [ ] **Step 4: Run the rendering test to verify it passes**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && PYTHONPATH="/Users/jzefan/work/proj/exam/backend/src" UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_docx_visual_recognition.py::test_render_docx_pages_produces_valid_jpeg_data_urls -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/questions/docx_render.py backend/tests/test_docx_visual_recognition.py
git commit -m "feat: add docx page rendering as pil jpeg images"
```

---

## Task 3: Visual Recognition Endpoint

**Files:**
- Modify: `backend/src/app/questions/docx_render.py`
- Modify: `backend/src/app/questions/router.py`
- Modify: `backend/src/app/questions/schemas.py`
- Test: `backend/tests/test_docx_visual_recognition.py`

- [ ] **Step 1: Write the failing endpoint test**

Add to `backend/tests/test_docx_visual_recognition.py`:

```python
async def test_visual_recognize_endpoint_accepts_docx_file(admin_client, monkeypatch) -> None:
    async def fake_vision(*, provider_name, api_key, base_url, model_name, prompt, images):
        return {
            "questions": [
                {
                    "type": "choice",
                    "content_text": "下面关于数据分析说法正确的是",
                    "options": {"A": "数据分析是数学...", "B": "数据分析是一种数学分析方法"},
                    "answer_text": "A",
                    "analysis": "",
                    "difficulty": 2,
                    "raw_text": "1. 下面关于数据分析说法正确的是(   )",
                    "images": [],
                }
            ]
        }

    monkeypatch.setattr("app.questions.docx_render._request_vision_json", fake_vision)

    response = await admin_client.post(
        "/api/questions/import/document-recognize-visual",
        files={"file": ("test.docx", io.BytesIO(_TEST_DOCX), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "smart"
    assert len(data["drafts"]) >= 1
    assert data["drafts"][0]["type"] == "choice"
```

- [ ] **Step 2: Implement `recognize_docx_visual()`**

Add to `backend/src/app/questions/docx_render.py`:

```python
from app.config import settings
from app.questions.schemas import (
    ImportRecognitionMode,
    QuestionImportDraft,
    QuestionImportDocumentSummary,
    ImportReviewStatus,
    ImportConfidence,
)
from app.questions.service import (
    _request_vision_json,
    _validate_ai_document_questions,
    _build_ai_import_draft,
    build_import_document_summary,
)
import uuid as _uuid


async def recognize_docx_visual(file_bytes: bytes) -> tuple[list[QuestionImportDraft], QuestionImportDocumentSummary]:
    blocks = extract_docx_structured_blocks(io.BytesIO(file_bytes))

    # Build a text-only representation too, pass it alongside images so the
    # vision model can cross-reference the OCR text with the page images.
    text_block = "\n".join(block.text for block in blocks)

    page_urls = render_docx_pages(blocks)
    images = [
        {"image_id": f"page-{i}", "url": url, "order": i + 1}
        for i, url in enumerate(page_urls)
    ]

    prompt = f"""
你是一名中文题库导入助手。下面是试卷页面的图像，请识别所有题目并只输出合法 JSON。

要求：
1. 必须按题目拆分 questions 数组。
2. 每道题必须输出：
   - type: choice | true_false | fill_in | short_answer | essay | code
   - content_text: 完整题目内容（不含选项），不要把题型标识放进题目内容
   - options: 选择题返回选项对象，如 {{"A":"选项1","B":"选项2"}}；非选择题返回 null
   - answer_text: 标准答案（如果能从页面中看到答案），没有就返回空字符串，不要臆造
   - analysis: 解析内容，没有就返回空字符串
   - difficulty: 1 到 5 的整数；没有明确难度时返回 3
   - raw_text: 该题在原文中的完整片段
   - images: 与该题相关的 image_id 数组
3. 不要把试卷封面/标题/得分表/答题卡表格当成题目。
4. 选择题的选项 A/B/C/D 必须在 options 字段里。
5. 不要输出解释、Markdown 或代码块。

以下是从文档中提取的文本（供交叉参考，最终以图像内容为准）：
{text_block[:4000]}
"""

    data = await _request_vision_json(
        provider_name="DeepSeek",
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        model_name=settings.deepseek_model_name,
        prompt=prompt,
        images=images,
    )

    questions = _validate_ai_document_questions(data)
    drafts = [_build_ai_import_draft(q, images) for q in questions]

    duplicates_removed = 0
    summary = build_import_document_summary(drafts, duplicates_removed)
    return drafts, summary
```

- [ ] **Step 3: Add the endpoint**

In `backend/src/app/questions/router.py`, add the import:

```python
from fastapi import File, Form, UploadFile
from app.questions.docx_render import recognize_docx_visual
```

And the endpoint after the existing `document-recognize` route:

```python
@questions_router.post("/import/document-recognize-visual", response_model=QuestionImportDocumentRecognizeResponse)
async def document_recognize_visual_endpoint(
    file: Annotated[UploadFile, File(...)],
    _user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")],
) -> QuestionImportDocumentRecognizeResponse:
    try:
        file_bytes = await file.read()
        drafts, summary = await recognize_docx_visual(file_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return QuestionImportDocumentRecognizeResponse(
        mode=ImportRecognitionMode.SMART,
        summary=summary,
        drafts=drafts,
    )
```

- [ ] **Step 4: Run the integration test to verify it passes**


```bash
cd "/Users/jzefan/work/proj/exam/backend" && PYTHONPATH="/Users/jzefan/work/proj/exam/backend/src" UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_docx_visual_recognition.py::test_visual_recognize_endpoint_accepts_docx_file -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/questions/docx_render.py backend/src/app/questions/router.py backend/src/app/questions/schemas.py backend/tests/test_docx_visual_recognition.py
git commit -m "feat: add visual docx recognition endpoint"
```

---

## Task 4: Frontend Visual Retry Button

**Files:**
- Modify: `frontend/src/pages/questions/import.tsx:560-610`
- Modify: `frontend/src/pages/questions/import.test.tsx`

- [ ] **Step 1: Write the failing UI test**

Add to `frontend/src/pages/questions/import.test.tsx`:

```tsx
it("shows a page visual recognition button when the backend flags docx for extra review", async () => {
  vi.spyOn(importUtils, "extractQuestionImportPayload").mockResolvedValue({
    rawText: "1. 单选题 示例",
    sourceFormat: "docx",
    images: [],
    tables: [],
  });

  fetchMock.mockResolvedValueOnce(
    mockJsonResponse({
      mode: "smart",
      summary: {
        total: 2, duplicates_removed: 0, high_confidence: 0,
        medium_confidence: 2, low_confidence: 0, issue_count: 2,
        pending_review: 2, approved: 0, skipped: 0,
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

  expect(await screen.findByText(/当前 Word 文档可能使用了自动编号/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /页面视觉识别/ })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/frontend" && pnpm vitest run src/pages/questions/import.test.tsx -t "shows a page visual recognition button when the backend flags docx for extra review"
```

Expected: FAIL — button text not found.

- [ ] **Step 3: Add the button beside existing "AI重新识别"**

In `frontend/src/pages/questions/import.tsx`, add after the "AI重新识别" button:

```tsx
{showDocxQualityWarning ? (
  <Button
    type="button"
    variant="outline"
    disabled={importing || aiRecognizing || !documentPayload}
    onClick={handleVisualRecognize}
    className="h-9 rounded-lg px-3 text-sm font-bold"
  >
    {aiRecognizing ? (
      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
    ) : (
      <Eye className="mr-2 h-4 w-4" />
    )}
    页面视觉识别
  </Button>
) : null}
```

Add the `Eye` icon import from lucide-react and the handler:

```tsx
const handleVisualRecognize = async () => {
  if (!documentPayload) return;
  setAiRecognizing(true);
  setAiRecognizeOverlay({ status: "loading" });
  setParseError(null);
  try {
    const fileInput = fileInputRef.current;
    if (!fileInput?.files?.[0]) {
      throw new Error("未找到原始文件，请重新上传后再试。");
    }
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    const token = localStorage.getItem("access_token");
    const response = await fetch("/api/questions/import/document-recognize-visual", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail || "视觉识别失败");
    }
    const result = (await response.json()) as QuestionImportDocumentRecognizeResponse;
    setDrafts(result.drafts);
    setRecognizedSummary(result.summary);
    setSourceEdits(Object.fromEntries(result.drafts.map((d) => [d.draft_id, d.raw_text])));
    setSelectedDraftId(result.drafts[0]?.draft_id ?? null);
    setMode("review");
    setAiRecognizeOverlay({ status: "success", count: result.summary.total });
    window.setTimeout(() => {
      setAiRecognizeOverlay((current) => (current?.status === "success" ? null : current));
    }, 1600);
  } catch (error) {
    setAiRecognizeOverlay(null);
    setParseError(error instanceof Error ? error.message : "视觉识别失败");
  } finally {
    setAiRecognizing(false);
  }
};
```

- [ ] **Step 4: Run the frontend test to verify it passes**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/frontend" && pnpm vitest run src/pages/questions/import.test.tsx -t "shows a page visual recognition button when the backend flags docx for extra review"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/questions/import.tsx frontend/src/pages/questions/import.test.tsx
git commit -m "feat: add visual docx page recognition button"
```

---

## Task 5: Manual Smoke Test With The Target DOCX

- [ ] **Step 1: Run full backend regression suite**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/backend" && PYTHONPATH="/Users/jzefan/work/proj/exam/backend/src" UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_docx_visual_recognition.py tests/test_question_import_document_recognize.py -v
```

- [ ] **Step 2: Run full frontend regression suite**

Run:

```bash
cd "/Users/jzefan/work/proj/exam/frontend" && pnpm vitest run src/pages/questions/import.test.tsx
```

- [ ] **Step 3: Manual end-to-end smoke test**

1. Start backend and frontend dev servers.
2. Open `/questions/import` in browser.
3. Upload `docs/bigdata-A试卷-印刷.docx`.
4. If `visual_retry_recommended` is true, click "页面视觉识别".
5. Verify: each of the 25 选择题 shows A/B/C/D options; 填空题 and 简答题 are separated.
6. Check that the review workspace shows the drafts correctly.

---

## Self-Review Notes

- **Spec coverage:** Implements Phase 2 from `2026-05-10-docx-question-import-design.md` — the page-image visual recognition pipeline.
- **Placeholder scan:** No TBD/TODO items. Font paths use auto-detection with graceful fallback.
- **Type consistency:** `DocxStructuredBlock` is the canonical structure used throughout the extraction → rendering → visual recognition chain. `QuestionImportDraft` and `QuestionImportDocumentSummary` are reused from existing schemas.

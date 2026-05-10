"""DOCX structured extraction and PIL page rendering for visual recognition."""

from __future__ import annotations

import base64 as _base64
import io
import json as _json
import re
from dataclasses import dataclass

import httpx

from docx import Document
from docx.oxml.ns import qn

from app.config import settings
from app.questions.schemas import QuestionImportDocumentSummary, QuestionImportDraft, QuestionImportImageInput
from app.questions.service import (
    _request_vision_json,
    _validate_ai_document_questions,
    _build_ai_import_draft,
    build_import_document_summary,
)


@dataclass(frozen=True, slots=True)
class DocxStructuredBlock:
    text: str
    style: str
    bold: bool
    font_size_pt: float
    indent_level: int


def _build_numbering_cache(doc: Document) -> tuple[dict[str, str], dict[str, str]]:
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
        if "\n" in text and len(text) > _SOFT_BREAK_MIN_LENGTH:
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


_PAGE_WIDTH = 1400
_PAGE_HEIGHT = 1900
_MARGIN_X = 60
_MARGIN_Y = 60
_LINE_SPACING = 24
_FONT_SIZE = 18
_INDENT_STEP = 36
_SOFT_BREAK_MIN_LENGTH = 80
_PARAGRAPH_GAP = 4

_FONT_PATHS = [
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _load_font(size: int):
    from PIL import ImageFont
    from pathlib import Path as _Path
    for path in _FONT_PATHS:
        if _Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _wrap_text(text: str, font, max_width: int) -> list[str]:
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
    from PIL import Image, ImageDraw

    font = _load_font(_FONT_SIZE)

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
        fill = "black"
        indent_x = _MARGIN_X + block.indent_level * _INDENT_STEP
        max_text_width = _PAGE_WIDTH - indent_x - _MARGIN_X

        prefix = ""
        if block.bold:
            prefix = "■ "
            fill = "#1a1a1a"

        wrapped = _wrap_text(prefix + block.text, font, max_text_width)

        for line in wrapped:
            if y + _LINE_SPACING > _PAGE_HEIGHT - _MARGIN_Y:
                flush_page()

            draw.text((indent_x, y), line, fill=fill, font=font)
            y += _LINE_SPACING

        y += _PARAGRAPH_GAP  # inter-paragraph gap

    flush_page()
    return pages


async def recognize_docx_visual(file_bytes: bytes) -> tuple[list[QuestionImportDraft], QuestionImportDocumentSummary]:
    """Extract, render, and visually recognize a DOCX file into QuestionImportDraft list."""

    blocks = extract_docx_structured_blocks(io.BytesIO(file_bytes))
    text_block = "\n".join(block.text for block in blocks)
    page_urls = render_docx_pages(blocks)
    image_inputs = [
        QuestionImportImageInput.model_construct(
            image_id=f"page-{i}", url=url, order=i + 1
        )
        for i, url in enumerate(page_urls)
    ]

    prompt = f"""你是一名中文题库导入助手。下面是试卷页面的图像，请识别所有题目并只输出合法 JSON。

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
{text_block[:4000]}"""

    last_error: Exception | None = None
    for provider_name, api_key, base_url, model_name in (
        ("DeepSeek", settings.deepseek_api_key, settings.deepseek_base_url, settings.deepseek_model_name),
        ("Qwen", settings.qwen_api_key, settings.qwen_base_url, settings.qwen_vl_model_name),
    ):
        try:
            data = await _request_vision_json(
                provider_name=provider_name,
                api_key=api_key,
                base_url=base_url,
                model_name=model_name,
                prompt=prompt,
                images=image_inputs,
            )
            break
        except (RuntimeError, httpx.HTTPError, _json.JSONDecodeError) as exc:
            last_error = exc
    else:
        raise RuntimeError("视觉识别服务暂不可用，请联系管理员处理。") from last_error

    questions = _validate_ai_document_questions(data)
    drafts = [_build_ai_import_draft(q, image_inputs) for q in questions]
    summary = build_import_document_summary(drafts, 0)
    return drafts, summary

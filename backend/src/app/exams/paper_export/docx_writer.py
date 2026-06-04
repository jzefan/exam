"""Render an :class:`ExamPaper` to a .docx byte string via python-docx."""

from __future__ import annotations

import io

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

from app.exams.paper_export.model import ExamPaper, PaperSection

_CN_FONT = "宋体"
_GRID_CHUNK = 10  # choice answer grid: columns per row block
# Answer-key emphasis: blue text on a light-blue shaded background.
_ANSWER_COLOR = RGBColor(0x1D, 0x4E, 0xD8)
_ANSWER_FILL = "EAF1FF"


def _style_run(run, *, size: float, bold: bool = False, color: RGBColor | None = None) -> None:
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = _CN_FONT
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), _CN_FONT)


def _apply_shading(properties, fill: str) -> None:
    """Add a `w:shd` fill to a pPr/tcPr element (paragraph or table-cell)."""
    shd = properties.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        properties.append(shd)
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)


def _line(
    doc,
    text: str,
    *,
    size: float,
    bold: bool = False,
    align=WD_ALIGN_PARAGRAPH.LEFT,
    space_after: float = 4.0,
    color: RGBColor | None = None,
    shade: str | None = None,
):
    paragraph = doc.add_paragraph()
    paragraph.alignment = align
    paragraph.paragraph_format.space_after = Pt(space_after)
    paragraph.paragraph_format.space_before = Pt(0)
    if text:
        _style_run(paragraph.add_run(text), size=size, bold=bold, color=color)
    if shade is not None:
        _apply_shading(paragraph._p.get_or_add_pPr(), shade)
    return paragraph


def _set_cell(
    cell,
    text: str,
    *,
    size: float = 10.5,
    bold: bool = False,
    align=WD_ALIGN_PARAGRAPH.CENTER,
    color: RGBColor | None = None,
    shade: str | None = None,
) -> None:
    paragraph = cell.paragraphs[0]
    paragraph.alignment = align
    if cell.text:
        paragraph.clear()
    _style_run(paragraph.add_run(text), size=size, bold=bold, color=color)
    if shade is not None:
        _apply_shading(cell._tc.get_or_add_tcPr(), shade)


def _add_page_footer(doc) -> None:
    paragraph = doc.sections[0].footer.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    def field(instr: str) -> None:
        begin = OxmlElement("w:fldChar")
        begin.set(qn("w:fldCharType"), "begin")
        instr_el = OxmlElement("w:instrText")
        instr_el.set(qn("xml:space"), "preserve")
        instr_el.text = instr
        end = OxmlElement("w:fldChar")
        end.set(qn("w:fldCharType"), "end")
        run = paragraph.add_run()
        run._element.append(begin)
        run2 = paragraph.add_run()
        run2._element.append(instr_el)
        run3 = paragraph.add_run()
        run3._element.append(end)

    _style_run(paragraph.add_run("第 "), size=9)
    field("PAGE")
    _style_run(paragraph.add_run(" 页 / 共 "), size=9)
    field("NUMPAGES")
    _style_run(paragraph.add_run(" 页"), size=9)


def _diagonal_cell(cell, top_right: str, bottom_left: str) -> None:
    """Header cell split by a top-left→bottom-right diagonal: ``top_right`` labels
    the columns to the right, ``bottom_left`` labels the row beneath."""
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.find(qn("w:tcBorders"))
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    diagonal = OxmlElement("w:tl2br")
    diagonal.set(qn("w:val"), "single")
    diagonal.set(qn("w:sz"), "6")
    diagonal.set(qn("w:color"), "000000")
    borders.append(diagonal)

    top = cell.paragraphs[0]
    top.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    top.paragraph_format.space_after = Pt(0)
    top.paragraph_format.space_before = Pt(0)
    _style_run(top.add_run(top_right), size=9)
    bottom = cell.add_paragraph()
    bottom.alignment = WD_ALIGN_PARAGRAPH.LEFT
    bottom.paragraph_format.space_before = Pt(0)
    bottom.paragraph_format.space_after = Pt(0)
    _style_run(bottom.add_run(bottom_left), size=9)


def _score_table(doc, sections: tuple[PaperSection, ...]) -> None:
    """得分统计表: a diagonal 题号/得分 corner, one column per section, a 核查人签名
    column on the right, and an 阅卷教师 row at the bottom."""
    n = len(sections)
    cols = 1 + n + 1  # corner + sections + 核查人签名
    table = doc.add_table(rows=3, cols=cols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    _diagonal_cell(table.rows[0].cells[0], "题号", "得分")
    for c, section in enumerate(sections, start=1):
        _set_cell(table.rows[0].cells[c], section.cn_index)
    _set_cell(table.rows[0].cells[cols - 1], "核查人签名", size=9)
    _set_cell(table.rows[2].cells[0], "阅卷教师", size=9)
    for row in table.rows:
        row.cells[0].width = Pt(54)
        row.cells[cols - 1].width = Pt(66)


def _score_box(doc) -> None:
    """Small 得分 box (得分 | blank) shown under each section heading."""
    table = doc.add_table(rows=1, cols=2)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    _set_cell(table.rows[0].cells[0], "得分", size=9)
    _set_cell(table.rows[0].cells[1], "", size=9)
    table.rows[0].cells[0].width = Pt(36)
    table.rows[0].cells[1].width = Pt(44)


def _choice_answer_grid(doc, section: PaperSection) -> None:
    questions = section.questions
    _line(doc, "选择题答案请填写下表中：", size=10.5, space_after=2)
    for start in range(0, len(questions), _GRID_CHUNK):
        chunk = questions[start : start + _GRID_CHUNK]
        table = doc.add_table(rows=2, cols=len(chunk))
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.LEFT
        for idx, question in enumerate(chunk):
            _set_cell(table.rows[0].cells[idx], str(question.number), size=10)
            has_answer = bool(question.answer_text)
            _set_cell(
                table.rows[1].cells[idx],
                question.answer_text or "",
                size=10,
                color=_ANSWER_COLOR if has_answer else None,
                shade=_ANSWER_FILL if has_answer else None,
            )


def _render_question(doc, section: PaperSection, question) -> None:
    stem = f"{question.number}. {question.stem}".rstrip()
    if not section.is_choice:
        stem = f"{stem}  （{_fmt(question.score)}分）"
    para = _line(doc, stem, size=10.5, space_after=2)
    para.paragraph_format.space_before = Pt(4)

    for option in question.options:
        _line(doc, f"    {option.label}. {option.text}", size=10.5, space_after=1)

    # Answer-key variant annotates every question (including choice) inline
    # with blue text on a light-blue shaded band; the grid stays as a summary.
    if question.answer_text is not None:
        _line(
            doc,
            f"正确答案：{question.answer_text}",
            size=10.5,
            space_after=2,
            color=_ANSWER_COLOR,
            shade=_ANSWER_FILL,
        )


def _fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def render_docx(paper: ExamPaper) -> bytes:
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = _CN_FONT
    normal.font.size = Pt(10.5)
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), _CN_FONT)

    # --- header block ---
    # Line 1: 《course》exam title.
    course = f"《{paper.course_name}》" if paper.course_name else ""
    _line(doc, f"{course}{paper.exam_title}试卷", size=16, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)

    # Line 2: semester + class.
    sub_parts = [part for part in (paper.semester_name, paper.class_label) if part]
    if sub_parts:
        _line(doc, "  ".join(sub_parts), size=14, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)

    # Line 3: time limit + exam form.
    info = f"答题时限：{paper.duration_minutes} 分钟    考试形式：{paper.exam_form}"
    _line(doc, info, size=12, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)

    # Line 4: class / id / name / score, centered.
    _line(
        doc,
        "班级__________ 学号__________ 姓名__________ 得分__________",
        size=12,
        bold=True,
        align=WD_ALIGN_PARAGRAPH.CENTER,
        space_after=6,
    )

    # --- score statistics table ---
    if paper.sections:
        _line(doc, "得分统计表：", size=10.5, space_after=2)
        _score_table(doc, paper.sections)
        _line(doc, "", size=6, space_after=2)

    # --- sections ---
    for section in paper.sections:
        _line(
            doc,
            f"{section.cn_index}、{section.title}（{section.score_note}）",
            size=12,
            bold=True,
            space_after=2,
        )
        _score_box(doc)
        if section.is_choice and section.questions:
            _choice_answer_grid(doc, section)
        for question in section.questions:
            _render_question(doc, section, question)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()

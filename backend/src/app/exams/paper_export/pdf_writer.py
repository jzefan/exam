"""Render an :class:`ExamPaper` to a PDF byte string via reportlab."""

from __future__ import annotations

import io
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.config import settings
from app.exams.paper_export.model import ExamPaper, PaperSection, paper_header_lines

# Reassigned by _ensure_font() to the actually-registered font name. Helpers and
# the page-number canvas read this module global at call time.
_FONT = "STSong-Light"
_GRID_CHUNK = 10
_font_ready = False
# Answer-key emphasis: blue text (no background fill).
_ANSWER_COLOR = colors.HexColor("#1D4ED8")
# Blank writing space (cm) left after a question in the no-answer variant, by type.
_BLANK_SPACE_CM = {"short_answer": 2.6, "essay": 5.0, "code": 5.0}


def _ensure_font() -> None:
    """Register a CJK font. Embed a configured .ttf when available (renders on
    any viewer); otherwise fall back to the built-in STSong-Light CID font."""
    global _font_ready, _FONT
    if _font_ready:
        return
    font_path = settings.exam_export_pdf_font_path
    if font_path and os.path.isfile(font_path):
        try:
            pdfmetrics.registerFont(TTFont("ExamExportCJK", font_path))
            _FONT = "ExamExportCJK"
            _font_ready = True
            return
        except Exception:  # noqa: BLE001 - bad font file shouldn't break export
            pass
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    _FONT = "STSong-Light"
    _font_ready = True


def _style(name: str, *, size: float, align: int = TA_LEFT, leading: float | None = None, **kw) -> ParagraphStyle:
    return ParagraphStyle(
        name,
        fontName=_FONT,
        fontSize=size,
        leading=leading or size * 1.4,
        alignment=align,
        **kw,
    )


def _esc(text: str) -> str:
    out = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return out.replace("\n", "<br/>")


class _NumberedCanvas(canvas.Canvas):
    """Two-pass canvas so each page can print '第 X 页 / 共 Y 页'."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_states: list[dict] = []

    def showPage(self) -> None:  # noqa: N802 (reportlab API)
        self._saved_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._saved_states)
        for state in self._saved_states:
            self.__dict__.update(state)
            self._draw_footer(total)
            super().showPage()
        super().save()

    def _draw_footer(self, total: int) -> None:
        self.setFont(_FONT, 9)
        self.drawCentredString(A4[0] / 2.0, 1.0 * cm, f"第 {self._pageNumber} 页 / 共 {total} 页")


class _DiagonalCell(Flowable):
    """A score-table corner cell split by a top-left→bottom-right diagonal,
    labelling the columns (top-right) and the row below (bottom-left)."""

    def __init__(self, width: float, height: float, top_right: str, bottom_left: str) -> None:
        super().__init__()
        self.width = width
        self.height = height
        self._top_right = top_right
        self._bottom_left = bottom_left

    def wrap(self, *_args) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        c = self.canv
        c.setLineWidth(0.6)
        c.line(0, self.height, self.width, 0)
        c.setFont(_FONT, 9)
        c.drawRightString(self.width - 3, self.height - 11, self._top_right)
        c.drawString(3, 4, self._bottom_left)


def _score_table_flow(paper: ExamPaper) -> Table:
    """得分统计表: diagonal 题号/得分 corner, one column per section, a 核查人签名
    column on the right, and an 阅卷教师 row at the bottom."""
    sections = paper.sections
    n = len(sections)
    usable = A4[0] - 4 * cm
    first = 2.0 * cm
    check_w = 2.6 * cm
    section_w = (usable - first - check_w) / max(n, 1)
    row_h = 0.8 * cm
    rows = [
        [_DiagonalCell(first, row_h, "题号", "得分"), *[s.cn_index for s in sections], "核查人签名"],
        ["", *[""] * n, ""],
        ["阅卷教师", *[""] * n, ""],
    ]
    table = Table(rows, colWidths=[first, *[section_w] * n, check_w], rowHeights=[row_h] * 3)
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.6, colors.black),
                ("FONTNAME", (0, 0), (-1, -1), _FONT),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                # Zero padding so the diagonal line reaches the corner cell edges.
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 0),
                ("TOPPADDING", (0, 0), (0, 0), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 0),
            ]
        )
    )
    return table


def _score_box_flow() -> Table:
    """Small 得分 box (得分 | blank) shown under each section heading."""
    table = Table([["得分", ""]], colWidths=[1.3 * cm, 1.5 * cm], rowHeights=[0.7 * cm])
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.6, colors.black),
                ("FONTNAME", (0, 0), (-1, -1), _FONT),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return table


def _choice_grid_flows(section: PaperSection, styles: dict) -> list:
    flows: list = [Paragraph("选择题答案请填写下表中：", styles["body"])]
    usable = A4[0] - 4 * cm
    questions = section.questions
    for start in range(0, len(questions), _GRID_CHUNK):
        chunk = questions[start : start + _GRID_CHUNK]
        col_w = usable / len(chunk)
        rows = [
            [str(q.number) for q in chunk],
            [q.answer_text or "" for q in chunk],
        ]
        table = Table(rows, colWidths=[col_w] * len(chunk), rowHeights=[0.6 * cm, 0.7 * cm])
        style = [
            ("GRID", (0, 0), (-1, -1), 0.6, colors.black),
            ("FONTNAME", (0, 0), (-1, -1), _FONT),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]
        if any(q.answer_text for q in chunk):
            # Highlight the answer row with blue text (no background fill).
            style.append(("TEXTCOLOR", (0, 1), (-1, 1), _ANSWER_COLOR))
        table.setStyle(TableStyle(style))
        flows.append(table)
    return flows


def render_pdf(paper: ExamPaper) -> bytes:
    _ensure_font()
    styles = {
        "subtitle": _style("subtitle", size=14, align=TA_CENTER, leading=20),
        "title": _style("title", size=16, align=TA_CENTER, leading=22),
        "class": _style("class", size=14, align=TA_CENTER, leading=20),
        "info": _style("info", size=12, align=TA_CENTER, leading=18),
        "student": _style("student", size=12, align=TA_CENTER, leading=20),
        "section": _style("section", size=13, align=TA_LEFT, leading=18, spaceBefore=6, spaceAfter=2),
        "body": _style("body", size=10.5, align=TA_LEFT, leading=16),
        "subitem": _style("subitem", size=10.5, align=TA_LEFT, leading=16, leftIndent=21),
        "option": _style("option", size=10.5, align=TA_LEFT, leading=16, leftIndent=18),
        "answer": _style("answer", size=10.5, align=TA_LEFT, leading=16, textColor=_ANSWER_COLOR),
    }

    flows: list = []
    # Line 1: 学校名称 + 学期; Line 2: 《课程名》考试类型试卷; Line 3: （专业）.
    line1, line2, line3 = paper_header_lines(paper)
    flows.append(Paragraph(_esc(line1), styles["subtitle"]))
    flows.append(Paragraph(_esc(line2), styles["title"]))
    flows.append(Paragraph(_esc(line3), styles["class"]))
    # Line 4: time limit + exam form. Reusable paper exports may not carry a
    # duration, so omit the time-limit fragment instead of rendering 0 minutes.
    info = (
        f"答题时限：{paper.duration_minutes} 分钟    考试形式：{paper.exam_form}"
        if paper.duration_minutes > 0
        else f"考试形式：{paper.exam_form}"
    )
    flows.append(Paragraph(_esc(info), styles["info"]))
    flows.append(Spacer(1, 0.2 * cm))
    # Line 5: class / id / name / score, centered.
    flows.append(Paragraph("班级__________ 学号__________ 姓名__________ 得分__________", styles["student"]))
    flows.append(Spacer(1, 0.2 * cm))

    if paper.sections:
        flows.append(Paragraph("得分统计表：", styles["body"]))
        flows.append(_score_table_flow(paper))
        flows.append(Spacer(1, 0.3 * cm))

    for section in paper.sections:
        header_block = [
            Paragraph(_esc(f"{section.cn_index}、{section.title}（{section.score_note}）"), styles["section"]),
            Spacer(1, 0.1 * cm),
            _score_box_flow(),
        ]
        flows.append(KeepTogether(header_block))
        if section.is_choice and section.questions:
            flows.extend(_choice_grid_flows(section, styles))
        for question in section.questions:
            # Per-question scores live in the section heading (每小题X分…), so the
            # stem carries only the number — no inline （X分）.
            stem_lines = question.stem.split("\n")
            first = stem_lines[0] if stem_lines else ""
            head = f"{question.number}. {first}"
            flows.append(Spacer(1, 0.12 * cm))
            flows.append(Paragraph(_esc(head), styles["body"]))
            # Continuation lines indented so their numbering nests under the question.
            for extra in stem_lines[1:]:
                flows.append(Paragraph(_esc(extra) if extra.strip() else " ", styles["subitem"]))
            for option in question.options:
                flows.append(Paragraph(_esc(f"{option.label}. {option.text}"), styles["option"]))
            if question.answer_text is not None:
                flows.append(Paragraph(_esc(f"正确答案：{question.answer_text}"), styles["answer"]))
            elif not paper.with_answers and question.type in _BLANK_SPACE_CM:
                # Leave blank space for the student to write 简答/论述/编程 answers.
                flows.append(Spacer(1, _BLANK_SPACE_CM[question.type] * cm))

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title=f"{paper.exam_title}",
    )
    doc.build(flows, canvasmaker=_NumberedCanvas)
    return buffer.getvalue()

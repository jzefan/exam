"""Exam paper export: build a render-agnostic view model and emit DOCX / PDF.

The standard Chinese exam-paper layout (header, score table, per-section score
boxes, question blocks, optional answer key) is assembled once in :mod:`model`
and shared by both the DOCX (:mod:`docx_writer`) and PDF (:mod:`pdf_writer`)
renderers so the two formats cannot drift apart.
"""

from app.exams.paper_export.model import ExamPaper, build_exam_paper, paper_header_lines
from app.exams.paper_export.docx_writer import render_docx
from app.exams.paper_export.pdf_writer import render_pdf

__all__ = ["ExamPaper", "build_exam_paper", "paper_header_lines", "render_docx", "render_pdf"]

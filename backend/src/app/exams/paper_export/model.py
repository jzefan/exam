"""Render-agnostic exam-paper view model + assembly from ORM objects."""

from __future__ import annotations

import html
import re
import uuid
from collections import Counter
from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exams.models import Exam
from app.learning.models import KnowledgePoint
from app.questions.models import QuestionType
from app.teacher_courses.models import CourseSemester, ExamSemesterAssignment

if TYPE_CHECKING:
    from app.papers.models import Paper

# Fixed section order + Chinese titles. Sections only appear when the exam
# actually contains that question type.
_SECTION_ORDER: tuple[str, ...] = (
    QuestionType.CHOICE.value,
    QuestionType.TRUE_FALSE.value,
    QuestionType.FILL_IN.value,
    QuestionType.SHORT_ANSWER.value,
    QuestionType.ESSAY.value,
    QuestionType.CODE.value,
)
_SECTION_TITLE: dict[str, str] = {
    QuestionType.CHOICE.value: "单项选择题",
    QuestionType.TRUE_FALSE.value: "判断题",
    QuestionType.FILL_IN.value: "填空题",
    QuestionType.SHORT_ANSWER.value: "简答题",
    QuestionType.ESSAY.value: "论述题",
    QuestionType.CODE.value: "操作题",
}
_CN_NUMERALS = "一二三四五六七八九十"
_OPTION_LABELS = "ABCDEFGH"
_MAX_ROOT_WALK = 16  # guard against accidental parent cycles


@dataclass(frozen=True, slots=True)
class PaperOption:
    label: str
    text: str


@dataclass(frozen=True, slots=True)
class PaperQuestion:
    number: int
    type: str
    stem: str
    options: tuple[PaperOption, ...]
    score: float
    answer_text: str | None
    analysis: str | None


@dataclass(frozen=True, slots=True)
class PaperSection:
    cn_index: str
    title: str
    score_note: str
    total_score: float
    is_choice: bool
    questions: tuple[PaperQuestion, ...]


@dataclass(frozen=True, slots=True)
class ExamPaper:
    school_name: str
    semester_name: str | None
    course_name: str | None
    exam_title: str
    class_label: str | None
    duration_minutes: int
    exam_form: str
    total_score: float
    with_answers: bool
    sections: tuple[PaperSection, ...]


def _strip_html(value: object) -> str:
    """Best-effort plain text from possibly-HTML rich content."""
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"<\s*br\s*/?\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</\s*(p|div|li)\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return text.strip()


def _stem_text(content: object, title: str) -> str:
    if isinstance(content, dict):
        text = _strip_html(content.get("text"))
        if text:
            return text
    if isinstance(content, str):
        text = _strip_html(content)
        if text:
            return text
    return _strip_html(title)


def _format_number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def _format_answer(qtype: str, answer: object, analysis: str | None) -> str:
    """Render the correct answer for the answer-key variant."""
    parts: list[str] = []
    if isinstance(answer, dict):
        if qtype == QuestionType.CHOICE.value:
            correct = answer.get("correct")
            if isinstance(correct, list):
                parts.append("、".join(_strip_html(item) for item in correct if _strip_html(item)))
            else:
                parts.append(_strip_html(correct) if correct is not None else "")
        elif qtype == QuestionType.TRUE_FALSE.value:
            correct = answer.get("correct")
            if isinstance(correct, bool):
                parts.append("正确" if correct else "错误")
            else:
                token = _strip_html(correct).lower()
                parts.append("正确" if token in {"true", "t", "对", "正确", "√", "yes", "1"} else "错误")
        elif qtype == QuestionType.CODE.value:
            parts.append(_strip_html(answer.get("code") or answer.get("text")))
        else:
            parts.append(_strip_html(answer.get("text") or answer.get("correct")))
    else:
        parts.append(_strip_html(answer))
    body = "\n".join(p for p in parts if p)
    return body.strip()


def _options(raw: object) -> tuple[PaperOption, ...]:
    if not isinstance(raw, dict) or not raw:
        return ()
    items: list[PaperOption] = []
    # Preserve A, B, C... ordering even if the dict is unordered.
    keyed = {str(k).strip().upper(): v for k, v in raw.items()}
    for label in _OPTION_LABELS:
        if label in keyed:
            items.append(PaperOption(label=label, text=_strip_html(keyed[label])))
    if items:
        return tuple(items)
    # Fallback: unknown keys, keep given order.
    return tuple(PaperOption(label=str(k), text=_strip_html(v)) for k, v in raw.items())


def _score_note(scores: list[float], total: float) -> str:
    """`每小题X分，共Y分`, where X is the predominant per-question score; any
    question whose score differs is called out as `（第N题Z分…）`."""
    total_label = _format_number(total)
    if not scores:
        return f"共{total_label}分"
    mode_score = Counter(scores).most_common(1)[0][0]
    note = f"每小题{_format_number(mode_score)}分，共{total_label}分"
    exceptions = [(index + 1, score) for index, score in enumerate(scores) if score != mode_score]
    if exceptions:
        detail = "、".join(f"第{number}题{_format_number(score)}分" for number, score in exceptions)
        note = f"{note}，其中{detail}"
    return note


_DEFAULT_SEMESTER = "2025-2026学年第一学期"
_DEFAULT_EXAM_TYPE = "期末考试"
_DEFAULT_MAJOR = "智能医疗装备技术专业"
# Specific exam-type phrases to look for in the exam name, in priority order.
_EXAM_TYPE_KEYWORDS = ("期末考试", "期中考试", "结业考试", "补考", "模拟考试", "月考")


def _extract_exam_type(title: str | None) -> str:
    text = title or ""
    for keyword in _EXAM_TYPE_KEYWORDS:
        if keyword in text:
            return keyword
    if "期末" in text:
        return "期末考试"
    if "期中" in text:
        return "期中考试"
    return _DEFAULT_EXAM_TYPE


def _extract_major(class_label: str | None, course_name: str | None, exam_title: str | None) -> str:
    # Prefer the semester's class/major label when present.
    if class_label and class_label.strip():
        label = class_label.strip()
        if "专业" not in label and "班" not in label:
            label = f"{label}专业"
        return label
    # Otherwise look for a '…专业' token in the course / exam name.
    for text in (course_name, exam_title):
        if not text:
            continue
        match = re.search(r"[一-龥A-Za-z0-9]+专业", text)
        if match:
            return match.group(0)
    return _DEFAULT_MAJOR


def paper_header_lines(paper: "ExamPaper") -> tuple[str, str, str]:
    """Three centered title lines for the paper header:

    1. 学校名称 + 学期 (semester from the exam; a fixed default when absent)
    2. 《课程名》 + 考试类型 + 试卷 (type parsed from the exam name)
    3. （专业）
    """
    semester = paper.semester_name or _DEFAULT_SEMESTER
    line1 = f"{paper.school_name}{semester}"
    course = f"《{paper.course_name}》" if paper.course_name else ""
    line2 = f"{course}{_extract_exam_type(paper.exam_title)}试卷"
    major = _extract_major(paper.class_label, paper.course_name, paper.exam_title)
    line3 = f"（{major}）"
    return line1, line2, line3


def assemble_question_item_sections(question_items: object, *, with_answers: bool) -> tuple[PaperSection, ...]:
    """Group exam/paper question association rows into ordered sections."""
    ordered = sorted(question_items or [], key=lambda item: (item.order, str(item.question_id)))
    by_type: dict[str, list] = {}
    for question_item in ordered:
        question = question_item.question
        if question is None:
            continue
        qtype = question.type.value if hasattr(question.type, "value") else str(question.type)
        by_type.setdefault(qtype, []).append(question_item)

    sections: list[PaperSection] = []
    section_idx = 0
    for qtype in _SECTION_ORDER:
        bucket = by_type.get(qtype)
        if not bucket:
            continue
        scores: list[float] = []
        questions: list[PaperQuestion] = []
        for number, question_item in enumerate(bucket, start=1):
            question = question_item.question
            score = float(question_item.score_override if question_item.score_override is not None else question.score)
            scores.append(score)
            questions.append(
                PaperQuestion(
                    number=number,
                    type=qtype,
                    stem=_stem_text(question.content, question.title),
                    options=_options(question.options),
                    score=score,
                    answer_text=(_format_answer(qtype, question.answer, question.analysis) if with_answers else None),
                    analysis=_strip_html(question.analysis) or None if with_answers else None,
                )
            )
        total = sum(scores)
        cn_index = _CN_NUMERALS[section_idx] if section_idx < len(_CN_NUMERALS) else str(section_idx + 1)
        sections.append(
            PaperSection(
                cn_index=cn_index,
                title=_SECTION_TITLE.get(qtype, "其他"),
                score_note=_score_note(scores, total),
                total_score=total,
                is_choice=qtype == QuestionType.CHOICE.value,
                questions=tuple(questions),
            )
        )
        section_idx += 1
    return tuple(sections)


def assemble_sections(exam: Exam, *, with_answers: bool) -> tuple[PaperSection, ...]:
    """Group an exam's questions into ordered sections by question type."""
    return assemble_question_item_sections(exam.exam_questions, with_answers=with_answers)


async def _resolve_course_name(db: AsyncSession, course_kp_id: uuid.UUID | None) -> str | None:
    """Walk parent links up to the root knowledge point = the course."""
    if course_kp_id is None:
        return None
    node = await db.get(KnowledgePoint, course_kp_id)
    seen: set[uuid.UUID] = set()
    while node is not None and node.parent_id is not None and node.id not in seen:
        seen.add(node.id)
        if len(seen) > _MAX_ROOT_WALK:
            break
        node = await db.get(KnowledgePoint, node.parent_id)
    return node.name if node is not None else None


async def _resolve_semester(db: AsyncSession, exam_id: uuid.UUID) -> CourseSemester | None:
    stmt = (
        select(CourseSemester)
        .join(ExamSemesterAssignment, ExamSemesterAssignment.course_semester_id == CourseSemester.id)
        .where(
            ExamSemesterAssignment.exam_id == exam_id,
            CourseSemester.deleted_at.is_(None),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


async def build_exam_paper(
    db: AsyncSession,
    exam: Exam,
    *,
    with_answers: bool,
    school_name: str,
    exam_form: str,
) -> ExamPaper:
    """Assemble the full paper view model for an exam (header + sections)."""
    sections = assemble_sections(exam, with_answers=with_answers)
    course_name = await _resolve_course_name(db, exam.course_kp_id)
    semester = await _resolve_semester(db, exam.id)
    total_score = sum(s.total_score for s in sections) or float(exam.total_score or 0)
    return ExamPaper(
        school_name=school_name,
        semester_name=(semester.name if semester else None),
        course_name=course_name,
        exam_title=exam.title,
        class_label=(semester.semester_major_label if semester else None),
        duration_minutes=int(exam.duration_minutes or 0),
        exam_form=exam_form,
        total_score=total_score,
        with_answers=with_answers,
        sections=sections,
    )


async def build_paper_export(
    db: AsyncSession,
    paper: "Paper",
    *,
    with_answers: bool,
    school_name: str,
    exam_form: str,
) -> ExamPaper:
    """Assemble the standard paper export view model for a reusable paper."""
    sections = assemble_question_item_sections(paper.paper_questions, with_answers=with_answers)
    course_name = await _resolve_course_name(db, paper.root_knowledge_point_id)
    total_score = sum(s.total_score for s in sections)
    return ExamPaper(
        school_name=school_name,
        semester_name=None,
        course_name=course_name,
        exam_title=paper.title,
        class_label=None,
        duration_minutes=0,
        exam_form=exam_form,
        total_score=total_score,
        with_answers=with_answers,
        sections=sections,
    )

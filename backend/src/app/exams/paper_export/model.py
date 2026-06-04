"""Render-agnostic exam-paper view model + assembly from ORM objects."""

from __future__ import annotations

import html
import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exams.models import Exam
from app.learning.models import KnowledgePoint
from app.questions.models import QuestionType
from app.teacher_courses.models import CourseSemester, ExamSemesterAssignment

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
    total_label = _format_number(total)
    if scores and len(set(scores)) == 1:
        return f"每小题{_format_number(scores[0])}分，共{total_label}分"
    return f"共{total_label}分"


def assemble_sections(exam: Exam, *, with_answers: bool) -> tuple[PaperSection, ...]:
    """Group an exam's questions into ordered sections by question type."""
    ordered = sorted(exam.exam_questions, key=lambda eq: (eq.order, str(eq.question_id)))
    by_type: dict[str, list] = {}
    for exam_question in ordered:
        question = exam_question.question
        if question is None:
            continue
        by_type.setdefault(question.type.value, []).append(exam_question)

    sections: list[PaperSection] = []
    section_idx = 0
    for qtype in _SECTION_ORDER:
        bucket = by_type.get(qtype)
        if not bucket:
            continue
        scores: list[float] = []
        questions: list[PaperQuestion] = []
        for number, exam_question in enumerate(bucket, start=1):
            question = exam_question.question
            score = float(exam_question.score_override if exam_question.score_override is not None else question.score)
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

"""Tests for exam paper export (view model + DOCX/PDF renderers + endpoint)."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion
from app.exams.paper_export import render_docx, render_pdf
from app.exams.paper_export.model import assemble_sections, build_exam_paper
from app.questions.models import Question, QuestionType


def _question(qtype: QuestionType, **kw) -> Question:
    return Question(
        type=qtype,
        title=kw.get("title", "题干"),
        content=kw.get("content", {"text": "题干"}),
        options=kw.get("options"),
        answer=kw.get("answer", {}),
        analysis=kw.get("analysis"),
        difficulty=1,
        score=kw.get("score", 10.0),
        created_by=uuid.uuid4(),
        owner_id=uuid.uuid4(),
    )


def _exam_with(questions: list[Question]) -> Exam:
    exam = Exam(
        title="期末考试",
        duration_minutes=90,
        total_score=0.0,
        created_by=uuid.uuid4(),
        owner_id=uuid.uuid4(),
    )
    exam.exam_questions = [
        ExamQuestion(order=index, score_override=None, question=question) for index, question in enumerate(questions)
    ]
    return exam


def test_assemble_sections_groups_orders_and_scores() -> None:
    exam = _exam_with(
        [
            _question(QuestionType.CHOICE, options={"A": "甲", "B": "乙"}, answer={"correct": "B"}, score=2.0),
            _question(QuestionType.CHOICE, options={"A": "甲", "B": "乙"}, answer={"correct": "A"}, score=2.0),
            _question(QuestionType.SHORT_ANSWER, answer={"text": "参考答案要点"}, score=10.0),
        ]
    )

    sections = assemble_sections(exam, with_answers=True)

    assert [s.title for s in sections] == ["单项选择题", "简答题"]
    assert [s.cn_index for s in sections] == ["一", "二"]
    choice = sections[0]
    assert choice.is_choice is True
    assert choice.total_score == 4.0
    assert choice.score_note == "每小题2分，共4分"
    assert choice.questions[0].answer_text == "B"
    assert tuple(o.label for o in choice.questions[0].options) == ("A", "B")
    short = sections[1]
    assert short.total_score == 10.0
    assert short.questions[0].answer_text == "参考答案要点"


def test_assemble_sections_blank_variant_has_no_answers() -> None:
    exam = _exam_with(
        [_question(QuestionType.CHOICE, options={"A": "甲", "B": "乙"}, answer={"correct": "B"}, score=2.0)]
    )
    sections = assemble_sections(exam, with_answers=False)
    assert sections[0].questions[0].answer_text is None


def test_score_note_varies_when_scores_differ() -> None:
    exam = _exam_with(
        [
            _question(QuestionType.SHORT_ANSWER, answer={"text": "a"}, score=10.0),
            _question(QuestionType.SHORT_ANSWER, answer={"text": "b"}, score=15.0),
        ]
    )
    section = assemble_sections(exam, with_answers=False)[0]
    # Predominant score + the differing question called out explicitly.
    assert section.score_note == "每小题10分，共25分，其中第2题15分"


@pytest.mark.parametrize("with_answers", [True, False])
def test_renderers_emit_valid_files(with_answers: bool) -> None:
    exam = _exam_with(
        [
            _question(
                QuestionType.CHOICE,
                options={"A": "甲", "B": "乙", "C": "丙", "D": "丁"},
                answer={"correct": "C"},
                score=2.0,
            ),
            _question(QuestionType.SHORT_ANSWER, answer={"text": "要点（5分）"}, score=10.0),
        ]
    )

    from app.exams.paper_export.model import ExamPaper

    paper = ExamPaper(
        school_name="测试学院",
        semester_name="2025～2026学年第2学期",
        course_name="数据仓库技术",
        exam_title="期末考试",
        class_label="2024级班",
        duration_minutes=90,
        exam_form="闭卷笔试",
        total_score=12.0,
        with_answers=with_answers,
        sections=assemble_sections(exam, with_answers=with_answers),
    )

    docx_bytes = render_docx(paper)
    pdf_bytes = render_pdf(paper)
    assert docx_bytes[:4] == b"PK\x03\x04"
    assert pdf_bytes[:5] == b"%PDF-"
    assert len(docx_bytes) > 0 and len(pdf_bytes) > 0


def _docx_document_xml(with_answers: bool) -> str:
    import io
    import zipfile

    from app.exams.paper_export.model import ExamPaper

    exam = _exam_with([_question(QuestionType.SHORT_ANSWER, answer={"text": "参考要点"}, score=10.0)])
    paper = ExamPaper(
        school_name="测试学院",
        semester_name=None,
        course_name="数据仓库技术",
        exam_title="期末考试",
        class_label=None,
        duration_minutes=90,
        exam_form="闭卷笔试",
        total_score=10.0,
        with_answers=with_answers,
        sections=assemble_sections(exam, with_answers=with_answers),
    )
    archive = zipfile.ZipFile(io.BytesIO(render_docx(paper)))
    return archive.read("word/document.xml").decode("utf-8")


def test_question_line_has_no_inline_score() -> None:
    # Per-question scores live in the section heading, not before each question.
    xml = _docx_document_xml(with_answers=False)
    assert "1. 题干" in xml
    assert "1.（" not in xml


def _code_question_docx_xml(with_answers: bool) -> str:
    import io
    import zipfile

    from app.exams.paper_export.model import ExamPaper

    question = _question(
        QuestionType.CODE,
        content={"text": "请编写程序。要求：\n1. 输入\n2. 输出"},
        answer={"text": "示例答案"},
        score=10.0,
    )
    paper = ExamPaper(
        school_name="x",
        semester_name=None,
        course_name="c",
        exam_title="期末考试",
        class_label=None,
        duration_minutes=90,
        exam_form="闭卷笔试",
        total_score=10.0,
        with_answers=with_answers,
        sections=assemble_sections(_exam_with([question]), with_answers=with_answers),
    )
    return zipfile.ZipFile(io.BytesIO(render_docx(paper))).read("word/document.xml").decode("utf-8")


def test_subitems_indented_and_blank_variant_leaves_writing_space() -> None:
    blank = _code_question_docx_xml(with_answers=False)
    answered = _code_question_docx_xml(with_answers=True)
    # Continuation (sub-requirement) lines are indented two characters (21pt = 420 twips).
    assert 'w:left="420"' in blank
    # The no-answer variant leaves extra blank paragraphs to write 编程 answers in.
    assert blank.count("</w:p>") > answered.count("</w:p>")


def test_score_table_uses_diagonal_corner() -> None:
    xml = _docx_document_xml(with_answers=False)
    # 得分统计表: diagonal 题号/得分 corner + 核查人签名 column + 阅卷教师 row.
    assert "w:tl2br" in xml
    assert "核查人签名" in xml
    assert "阅卷教师" in xml


def test_answer_key_docx_uses_blue_text_without_background() -> None:
    answered = _docx_document_xml(with_answers=True)
    blank = _docx_document_xml(with_answers=False)
    # Answer key: blue font, and no shaded background fill anywhere.
    assert "1D4ED8" in answered
    assert 'w:fill="EAF1FF"' not in answered
    # Blank paper carries no answer highlight.
    assert "1D4ED8" not in blank


def test_paper_header_lines_formats_and_defaults() -> None:
    from app.exams.paper_export.model import ExamPaper, paper_header_lines

    def header(**kw) -> tuple[str, str, str]:
        base = dict(
            school_name="江苏卫生健康职业学院",
            semester_name=None,
            course_name="数据可视化",
            exam_title="数据可视化期末考试",
            class_label=None,
            duration_minutes=90,
            exam_form="闭卷笔试",
            total_score=0.0,
            with_answers=False,
            sections=(),
        )
        base.update(kw)
        return paper_header_lines(ExamPaper(**base))

    # Defaults: fixed semester + major, exam type parsed from the name.
    line1, line2, line3 = header()
    assert line1 == "江苏卫生健康职业学院2025-2026学年第一学期"
    assert line2 == "《数据可视化》期末考试试卷"
    assert line3 == "（智能医疗装备技术专业）"

    # Semester from the exam; major from the class label; midterm parsed.
    line1, line2, line3 = header(
        semester_name="2025～2026学年第一学期",
        exam_title="期中测验",
        class_label="2024级健康大数据",
    )
    assert line1 == "江苏卫生健康职业学院2025～2026学年第一学期"
    assert line2 == "《数据可视化》期中考试试卷"
    assert line3 == "（2024级健康大数据专业）"


async def _make_teacher_with_exam(db_session) -> tuple[object, Exam]:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="export-teacher",
            email="export-teacher@example.com",
            password="teacherpass123",
            full_name="导出老师",
            role_name="teacher",
        ),
    )
    question = Question(
        type=QuestionType.CHOICE,
        title="以下哪项正确？",
        content={"text": "以下哪项正确？"},
        options={"A": "甲", "B": "乙"},
        answer={"correct": "B"},
        difficulty=1,
        score=2.0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()
    exam = Exam(
        title="期末考试",
        duration_minutes=90,
        total_score=2.0,
        status="draft",
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await db_session.flush()
    return teacher, exam


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "export_format,media_type",
    [
        ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("pdf", "application/pdf"),
    ],
)
@pytest.mark.parametrize("answers", ["true", "false"])
async def test_export_endpoint_returns_file(
    client: AsyncClient, db_session, export_format: str, media_type: str, answers: str
) -> None:
    teacher, exam = await _make_teacher_with_exam(db_session)
    token = create_access_token(teacher.id, "")

    response = await client.get(
        f"/api/exams/{exam.id}/export",
        params={"format": export_format, "answers": answers},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(media_type)
    disposition = response.headers["content-disposition"]
    assert "attachment" in disposition
    assert "filename*=UTF-8''" in disposition
    magic = b"PK\x03\x04" if export_format == "docx" else b"%PDF-"
    assert response.content[: len(magic)] == magic


@pytest.mark.asyncio
async def test_export_endpoint_404_for_unknown_exam(client: AsyncClient, db_session) -> None:
    teacher, _ = await _make_teacher_with_exam(db_session)
    token = create_access_token(teacher.id, "")
    response = await client.get(
        f"/api/exams/{uuid.uuid4()}/export",
        params={"format": "pdf"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_build_exam_paper_uses_config_defaults(client: AsyncClient, db_session) -> None:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    teacher, exam = await _make_teacher_with_exam(db_session)
    # Eager-load questions the way the endpoint's query does.
    loaded = (
        (
            await db_session.execute(
                select(Exam)
                .where(Exam.id == exam.id)
                .options(selectinload(Exam.exam_questions).selectinload(ExamQuestion.question))
            )
        )
        .scalars()
        .first()
    )
    paper = await build_exam_paper(db_session, loaded, with_answers=True, school_name="示例学院", exam_form="开卷")
    assert paper.school_name == "示例学院"
    assert paper.exam_form == "开卷"
    assert paper.exam_title == "期末考试"
    assert paper.sections and paper.sections[0].title == "单项选择题"

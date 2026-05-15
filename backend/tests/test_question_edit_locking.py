from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.models import User
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent, StudentExamAnswer
from app.questions.models import Question, QuestionType
from app.questions.service import (
    build_question_edit_lock_info,
    diff_question_update,
    _content_text_changed,
    question_has_submitted_attempts,
    question_is_in_use,
    question_update_requires_regrade,
    validate_in_use_question_update,
)
from app.rbac.models import Organization, Role


async def _create_org_with_teacher_role(db_session):
    org = Organization(name="Question Lock School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, teacher_role])
    await db_session.flush()
    return org


def _build_question_stub(*, question_type: QuestionType = QuestionType.CHOICE, **overrides):
    base = {
        "type": question_type,
        "title": "旧题目",
        "content": {"text": "<p>旧题干</p>"},
        "options": {"A": "选项A", "B": "选项B"},
        "answer": {"correct": "A"},
        "analysis": "旧解析",
        "difficulty": 3,
        "score": 5.0,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


async def _create_owner_user(db_session, prefix: str = "question-lock-owner") -> User:
    user = User(
        username=f"{prefix}-{datetime.now(timezone.utc).timestamp()}",
        email=f"{prefix}-{datetime.now(timezone.utc).timestamp()}@example.com",
        password_hash="hashed",
        full_name="Question Lock Owner",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _create_submitted_attempt(db_session, *, exam_id, question_id, student_id) -> None:
    db_session.add(
        ExamStudent(
            exam_id=exam_id,
            student_id=student_id,
            started_at=datetime.now(timezone.utc) - timedelta(minutes=10),
            submitted_at=datetime.now(timezone.utc),
        )
    )
    db_session.add(
        StudentExamAnswer(
            exam_id=exam_id,
            student_id=student_id,
            question_id=question_id,
            answer_content={"choice": "A"},
            score_awarded=5,
            is_correct=True,
            feedback={},
        )
    )
    await db_session.flush()


def test_diff_question_update_marks_title_change_as_allowed():
    """Title is metadata derived from content; allowed even when in use."""
    question = _build_question_stub()

    diff = diff_question_update(question, {"title": "新题目"})

    assert "title" in diff.changed_fields
    assert "title" not in diff.forbidden_fields


def test_answer_change_requires_regrade():
    question = _build_question_stub(answer={"correct": "A"})

    diff = diff_question_update(question, {"answer": {"correct": "B"}})

    assert question_update_requires_regrade(question, diff) is True


def test_analysis_change_does_not_require_regrade():
    question = _build_question_stub(analysis="旧解析")

    diff = diff_question_update(question, {"analysis": "新解析"})

    assert question_update_requires_regrade(question, diff) is False


def test_content_not_flagged_when_only_html_keys_differ():
    """Regression: RTE roundtrip adds html key but text is unchanged."""
    # Original content might not have an html key (e.g. imported questions)
    question = _build_question_stub(
        question_type=QuestionType.SHORT_ANSWER,
        content={"text": "同一段文字"},
    )

    # RTE sends back both html and text — text is the same
    diff = diff_question_update(question, {
        "content": {"html": "<p>同一段文字</p>", "text": "同一段文字"},
        "analysis": "新的解析",
    })

    assert "content" not in diff.forbidden_fields
    assert "content" not in diff.changed_fields
    assert "analysis" in diff.changed_fields


def test_content_forbidden_when_text_actually_changed():
    """When the plain text truly changes, content is still forbidden."""
    question = _build_question_stub(
        question_type=QuestionType.SHORT_ANSWER,
        content={"text": "旧文字"},
    )

    diff = diff_question_update(question, {
        "content": {"html": "<p>新文字</p>", "text": "新文字"},
    })

    assert "content" in diff.forbidden_fields
    assert "content" in diff.changed_fields


def test_content_text_changed_detects_real_changes():
    assert _content_text_changed({"text": "a"}, {"text": "b"}) is True
    assert _content_text_changed({"text": "a"}, {"text": "a"}) is False
    assert _content_text_changed({"text": "a"}, {"html": "<p>a</p>", "text": "a"}) is False
    assert _content_text_changed({"text": "a"}, {"html": "<p>b</p>", "text": "b"}) is True
    assert _content_text_changed(None, {"text": "a"}) is True
    assert _content_text_changed({"text": "  a  "}, {"text": "a"}) is False


def test_validate_in_use_question_update_rejects_score_change():
    question = _build_question_stub(score=5.0)

    diff = diff_question_update(question, {"score": 8.0})

    with pytest.raises(ValueError, match="不能修改题干、选项、题型或分值"):
        validate_in_use_question_update(question, diff)


def test_in_use_code_question_accepts_test_case_only_change():
    question = _build_question_stub(
        question_type=QuestionType.CODE,
        content={
            "mode": "program",
            "description": "旧题面",
            "sample_tests": [{"input": "1 2", "expected_output": "3"}],
        },
        options=None,
        answer={"code": "print(1)"},
    )

    diff = diff_question_update(
        question,
        {
            "content": {
                "mode": "program",
                "description": "旧题面",
                "sample_tests": [{"input": "2 3", "expected_output": "5"}],
            }
        },
    )

    assert diff.forbidden_fields == set()
    assert "sample_tests" in diff.allowed_content_change_keys
    assert question_update_requires_regrade(question, diff) is True


def test_in_use_code_question_rejects_prompt_change():
    question = _build_question_stub(
        question_type=QuestionType.CODE,
        content={
            "mode": "program",
            "description": "旧题面",
            "sample_tests": [{"input": "1 2", "expected_output": "3"}],
        },
        options=None,
        answer={"code": "print(1)"},
    )

    diff = diff_question_update(
        question,
        {
            "content": {
                "mode": "program",
                "description": "新题面",
                "sample_tests": [{"input": "2 3", "expected_output": "5"}],
            }
        },
    )

    assert "content" in diff.forbidden_fields


@pytest.mark.asyncio
async def test_update_question_api_allows_title_change_when_question_in_use(
    client: AsyncClient,
    db_session,
) -> None:
    org = await _create_org_with_teacher_role(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="question-lock-teacher",
            email="question-lock-teacher@example.com",
            password="teacherpass123",
            full_name="Question Lock Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )

    student = await create_user(
        db_session,
        UserCreate(
            username="question-lock-student",
            email="question-lock-student@example.com",
            password="studentpass123",
            full_name="Question Lock Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="原题",
        content={"text": "<p>原题干</p>"},
        options={"A": "甲", "B": "乙"},
        answer={"correct": "A"},
        analysis="解析",
        difficulty=2,
        score=5.0,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="正在引用该题的考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            ExamStudent(exam_id=exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    # title / tag_ids / question_bank_id are metadata — allowed even when in use
    response = await client.put(
        f"/api/questions/{question.id}",
        json={"title": "新的题干"},
    )
    assert response.status_code == 200

    # score / type / content / options are still forbidden
    response = await client.put(
        f"/api/questions/{question.id}",
        json={"score": 999},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "这道题正在考试或练习中使用，不能修改题干、选项、题型或分值。"


@pytest.mark.asyncio
async def test_question_is_in_use_for_any_non_deleted_exam_ref(db_session) -> None:
    """Any non-deleted exam reference should lock the question for structure edits."""
    admin = await _create_owner_user(db_session, prefix="question-lock-admin")
    question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="进行中锁题检测",
        content={"text": "<p>题干</p>"},
        options=None,
        answer={"points": ["a"]},
        analysis="解析",
        difficulty=2,
        score=5.0,
        usage_count=0,
        created_by=admin.id,
        owner_id=admin.id,
    )
    db_session.add(question)
    await db_session.flush()

    ongoing_exam = Exam(
        title="进行中试卷",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=admin.id,
        owner_id=admin.id,
    )
    db_session.add(ongoing_exam)
    await db_session.flush()
    db_session.add(ExamQuestion(exam_id=ongoing_exam.id, question_id=question.id, order=0))
    await db_session.flush()

    assert await question_is_in_use(db_session, question.id) is True

    # Soft-deleted exam: not in use
    ongoing_exam.deleted_at = datetime.now(timezone.utc)
    await db_session.flush()

    assert await question_is_in_use(db_session, question.id) is False

    # Draft exam: still in use because the exam reference remains active
    ongoing_exam.deleted_at = None
    ongoing_exam.status = "draft"
    await db_session.flush()
    assert await question_is_in_use(db_session, question.id) is True

    # Completed exam: still in use until the exam itself is deleted
    ongoing_exam.status = "completed"
    await db_session.flush()
    assert await question_is_in_use(db_session, question.id) is True


@pytest.mark.asyncio
async def test_get_question_api_returns_edit_lock_metadata(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_teacher_role(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="question-lock-meta-teacher",
            email="question-lock-meta-teacher@example.com",
            password="teacherpass123",
            full_name="Question Lock Meta Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="question-lock-meta-student",
            email="question-lock-meta-student@example.com",
            password="studentpass123",
            full_name="Question Lock Meta Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="元数据题",
        content={"text": "<p>原题干</p>"},
        options={"A": "甲", "B": "乙"},
        answer={"correct": "A"},
        analysis="解析",
        difficulty=2,
        score=5.0,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="进行中元数据考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await _create_submitted_attempt(db_session, exam_id=exam.id, question_id=question.id, student_id=student.id)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get(f"/api/questions/{question.id}")

    assert response.status_code == 200
    assert response.json()["edit_lock"] == {
        "in_use": True,
        "allowed_fields": ["answer", "analysis", "difficulty", "knowledge_point_ids", "code_test_cases"],
        "regrade_on_fields": ["answer", "code_test_cases"],
        "has_submitted_attempts": True,
    }


@pytest.mark.asyncio
async def test_build_question_edit_lock_info_marks_submitted_attempts(db_session) -> None:
    admin = await _create_owner_user(db_session, prefix="question-lock-info-admin")
    student = User(
        username="question-lock-info-student",
        email="question-lock-info-student@example.com",
        password_hash="hashed",
        full_name="Question Lock Info Student",
        is_active=True,
    )
    db_session.add(student)
    await db_session.flush()

    question = Question(
        type=QuestionType.CHOICE,
        title="锁信息题",
        content={"text": "<p>原题干</p>"},
        options={"A": "甲", "B": "乙"},
        answer={"correct": "A"},
        analysis="解析",
        difficulty=2,
        score=5.0,
        usage_count=0,
        created_by=admin.id,
        owner_id=admin.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="进行中锁信息考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=admin.id,
        owner_id=admin.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await _create_submitted_attempt(db_session, exam_id=exam.id, question_id=question.id, student_id=student.id)

    assert await question_has_submitted_attempts(db_session, question.id) is True

    lock_info = await build_question_edit_lock_info(db_session, question.id)
    assert lock_info.in_use is True
    assert lock_info.allowed_fields == [
        "answer",
        "analysis",
        "difficulty",
        "knowledge_point_ids",
        "code_test_cases",
    ]
    assert lock_info.regrade_on_fields == ["answer", "code_test_cases"]
    assert lock_info.has_submitted_attempts is True

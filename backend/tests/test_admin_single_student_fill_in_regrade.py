"""Tests for POST /api/exams/{exam_id}/students/{student_id}/questions/{question_id}/ai-grade.

The endpoint lets an exam owner (not just a platform admin) re-run DeepSeek
fill-in grading for one student's one fill-in answer from the answer-detail
view.
"""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import (
    Exam,
    ExamQuestion,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamSubmission,
    StudentExamSubmissionAnswer,
)
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _seed_org_with_roles(db_session) -> Organization:
    org = Organization(name="AI Grade Org", type="school", is_active=True)
    db_session.add_all(
        [
            org,
            Role(name="platform_admin", display_name="Platform Admin", is_system=True),
            Role(name="teacher", display_name="Teacher", is_system=True),
            Role(name="evaluator", display_name="Evaluator", is_system=True),
            Role(name="student", display_name="Student", is_system=True),
        ]
    )
    await db_session.flush()
    return org


async def _create_submitted_fill_in_attempt(
    db_session,
    *,
    exam: Exam,
    question: Question,
    student_id,
    answer_content: dict[str, object],
    score_awarded: float,
    is_correct: bool,
) -> StudentExamSubmission:
    submitted_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student_id,
        started_at=submitted_at - timedelta(minutes=20),
        submitted_at=submitted_at,
        latest_submission_id=None,
        submission_count=1,
        grading_status=GradingStatus.REVIEWED.value,
        objective_score=score_awarded,
        subjective_score=0,
        score=score_awarded,
        ai_scored_at=submitted_at,
        reviewed_at=submitted_at,
        graded_at=submitted_at,
    )
    db_session.add(exam_student)
    await db_session.flush()

    submission = StudentExamSubmission(
        exam_id=exam.id,
        student_id=student_id,
        attempt_no=1,
        submitted_at=submitted_at,
        grading_status=GradingStatus.REVIEWED.value,
        objective_score=score_awarded,
        subjective_score=0,
        score=score_awarded,
    )
    db_session.add(submission)
    await db_session.flush()

    exam_student.latest_submission_id = submission.id
    db_session.add_all(
        [
            StudentExamAnswer(
                exam_id=exam.id,
                student_id=student_id,
                question_id=question.id,
                answer_content=answer_content,
                score_awarded=score_awarded,
                is_correct=is_correct,
                feedback={},
            ),
            StudentExamSubmissionAnswer(
                submission_id=submission.id,
                exam_id=exam.id,
                student_id=student_id,
                question_id=question.id,
                answer_content=answer_content,
                score_awarded=score_awarded,
                is_correct=is_correct,
                feedback={},
            ),
        ]
    )
    await db_session.flush()
    return submission


async def _build_exam_with_fill_in(db_session, *, owner_id, question_type=QuestionType.FILL_IN):
    question = Question(
        type=question_type,
        title="Matplotlib 设置 x 轴标签的函数是____。",
        content={"text": "Matplotlib 设置 x 轴标签的函数是____。"},
        options=None,
        answer={"correct": ["xlabel"]} if question_type == QuestionType.FILL_IN else {"text": "answer"},
        analysis=None,
        difficulty=1,
        score=2,
        usage_count=0,
        created_by=owner_id,
        owner_id=owner_id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        category="exam",
        title="AI 判题考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
        total_score=2,
        status="ongoing",
        max_switch_count=0,
        created_by=owner_id,
        owner_id=owner_id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await db_session.flush()
    return exam, question


@pytest.fixture
def patched_deepseek(monkeypatch):
    state = {"calls": 0, "next_score": 1.0, "reason": "等价"}

    async def fake(*, question_text, expected_answers, student_answers, knowledge_points=None):
        state["calls"] += 1
        return [
            {
                "score": state["next_score"],
                "is_correct": state["next_score"] >= 1.0,
                "reason": state["reason"],
            }
            for _ in expected_answers
        ]

    monkeypatch.setattr(
        "app.exams.student_router._request_fill_in_equivalence_with_deepseek", fake
    )
    return state


@pytest.mark.asyncio
async def test_ai_grade_endpoint_updates_score_feedback_and_model_evaluation(
    client: AsyncClient, db_session, patched_deepseek
) -> None:
    org = await _seed_org_with_roles(db_session)
    owner = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-owner",
            email="ai-grade-owner@example.com",
            password="pass1234",
            full_name="Owner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-student",
            email="ai-grade-student@example.com",
            password="pass1234",
            full_name="Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam, question = await _build_exam_with_fill_in(db_session, owner_id=owner.id)
    await _create_submitted_fill_in_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"blanks": ["plt.xlabel()"]},
        score_awarded=0,
        is_correct=False,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(owner.id, '')}"})
    resp = await client.post(
        f"/api/exams/{exam.id}/students/{student.id}/questions/{question.id}/ai-grade"
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["question_id"] == str(question.id)
    assert body["total_score"] == 2
    assert body["score_awarded"] == 2
    assert body["is_correct"] is True
    model_eval = body["feedback"]["model_evaluation"]
    assert model_eval["model"] == "deepseek-v4-flash"
    assert model_eval["matches"][0]["is_correct"] is True
    assert model_eval["matches"][0]["reason"] == "等价"
    assert patched_deepseek["calls"] == 1

    # DB row reflects the new grade.
    refreshed = (
        await db_session.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == exam.id,
                StudentExamAnswer.student_id == student.id,
                StudentExamAnswer.question_id == question.id,
            )
        )
    ).scalar_one()
    assert refreshed.score_awarded == 2


@pytest.mark.asyncio
async def test_ai_grade_endpoint_rejects_non_fill_in_question(
    client: AsyncClient, db_session, patched_deepseek
) -> None:
    org = await _seed_org_with_roles(db_session)
    owner = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-owner-2",
            email="ai-grade-owner-2@example.com",
            password="pass1234",
            full_name="Owner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-student-2",
            email="ai-grade-student-2@example.com",
            password="pass1234",
            full_name="Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam, question = await _build_exam_with_fill_in(
        db_session, owner_id=owner.id, question_type=QuestionType.SHORT_ANSWER
    )
    await _create_submitted_fill_in_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"text": "an answer"},
        score_awarded=0,
        is_correct=False,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(owner.id, '')}"})
    resp = await client.post(
        f"/api/exams/{exam.id}/students/{student.id}/questions/{question.id}/ai-grade"
    )
    assert resp.status_code == 400
    assert "填空题" in resp.json()["detail"]
    assert patched_deepseek["calls"] == 0


@pytest.mark.asyncio
async def test_ai_grade_endpoint_rejects_student_without_submission(
    client: AsyncClient, db_session, patched_deepseek
) -> None:
    org = await _seed_org_with_roles(db_session)
    owner = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-owner-3",
            email="ai-grade-owner-3@example.com",
            password="pass1234",
            full_name="Owner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    other_student = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-other",
            email="ai-grade-other@example.com",
            password="pass1234",
            full_name="Other",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam, question = await _build_exam_with_fill_in(db_session, owner_id=owner.id)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(owner.id, '')}"})
    resp = await client.post(
        f"/api/exams/{exam.id}/students/{other_student.id}/questions/{question.id}/ai-grade"
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_ai_grade_endpoint_available_to_evaluator_owner(
    client: AsyncClient, db_session, patched_deepseek
) -> None:
    """An evaluator who owns the exam can trigger AI grading (not just platform_admin)."""
    org = await _seed_org_with_roles(db_session)
    evaluator = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-evaluator",
            email="ai-grade-evaluator@example.com",
            password="pass1234",
            full_name="Evaluator Owner",
            role_name="evaluator",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-eval-student",
            email="ai-grade-eval-student@example.com",
            password="pass1234",
            full_name="Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam, question = await _build_exam_with_fill_in(db_session, owner_id=evaluator.id)
    await _create_submitted_fill_in_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"blanks": ["plt.xlabel()"]},
        score_awarded=0,
        is_correct=False,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(evaluator.id, '')}"})
    resp = await client.post(
        f"/api/exams/{exam.id}/students/{student.id}/questions/{question.id}/ai-grade"
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["question_id"] == str(question.id)
    assert body["score_awarded"] == 2
    assert body["is_correct"] is True


@pytest.mark.asyncio
async def test_ai_grade_endpoint_available_to_teacher_owner(
    client: AsyncClient, db_session, patched_deepseek
) -> None:
    """A teacher who owns the exam can trigger AI grading without being platform_admin."""
    org = await _seed_org_with_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-teacher-owner",
            email="ai-grade-teacher-owner@example.com",
            password="pass1234",
            full_name="Teacher Owner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-tch-student",
            email="ai-grade-tch-student@example.com",
            password="pass1234",
            full_name="Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam, question = await _build_exam_with_fill_in(db_session, owner_id=teacher.id)
    await _create_submitted_fill_in_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"blanks": ["plt.xlabel()"]},
        score_awarded=0,
        is_correct=False,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    resp = await client.post(
        f"/api/exams/{exam.id}/students/{student.id}/questions/{question.id}/ai-grade"
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_ai_grade_endpoint_forbids_user_without_write_access(
    client: AsyncClient, db_session, patched_deepseek
) -> None:
    org = await _seed_org_with_roles(db_session)
    owner = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-owner-4",
            email="ai-grade-owner-4@example.com",
            password="pass1234",
            full_name="Owner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    other_teacher = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-other-teacher",
            email="ai-grade-other-teacher@example.com",
            password="pass1234",
            full_name="Other Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="ai-grade-student-4",
            email="ai-grade-student-4@example.com",
            password="pass1234",
            full_name="Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam, question = await _build_exam_with_fill_in(db_session, owner_id=owner.id)
    await _create_submitted_fill_in_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"blanks": ["plt.xlabel()"]},
        score_awarded=0,
        is_correct=False,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(other_teacher.id, '')}"})
    resp = await client.post(
        f"/api/exams/{exam.id}/students/{student.id}/questions/{question.id}/ai-grade"
    )
    # Other teacher can't see the exam at all; visibility check returns 404.
    assert resp.status_code in (403, 404)
    assert patched_deepseek["calls"] == 0

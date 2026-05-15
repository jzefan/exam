"""Tests for the exam-submission reconcile path that lets a submission leave
PENDING_AI even when individual grading tasks ended in failed /
arbitration_required rather than completed.
"""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.grading.models import GradingTask
from app.grading.service import (
    _has_pending_exam_submission_tasks,
    apply_grading_task_failure_to_exam_submission,
    recover_pending_exam_submission_tasks,
)
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _seed_user(db_session: AsyncSession, *, role_name: str, username: str):
    org = Organization(name=f"Reconcile Org {username}", type="school", is_active=True)
    role = Role(name=role_name, display_name=role_name, is_system=True)
    db_session.add_all([org, role])
    await db_session.flush()
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="password123",
            full_name=username,
            role_name=role_name,
            org_id=org.id,
        ),
    )


async def _seed_submitted_subjective_exam(
    db_session: AsyncSession,
) -> tuple[Exam, ExamStudent, Question, StudentExamAnswer, StudentExamSubmission, StudentExamSubmissionAnswer]:
    teacher = await _seed_user(db_session, role_name="teacher", username="teacher_reconcile")
    student = await _seed_user(db_session, role_name="student", username="student_reconcile")

    question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="简述 HTTP 缓存策略",
        content={"text": "<p>请简述 HTTP 缓存策略。</p>"},
        options=None,
        answer={"text": "结合强缓存与协商缓存"},
        analysis="",
        difficulty=2,
        score=10,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    exam = Exam(
        title="Reconcile Subjective Exam",
        description="",
        start_time=now - timedelta(minutes=30),
        end_time=now + timedelta(minutes=60),
        duration_minutes=60,
        total_score=10,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await db_session.flush()

    submission = StudentExamSubmission(
        exam_id=exam.id,
        student_id=student.id,
        attempt_no=1,
        submitted_at=now,
        grading_status=GradingStatus.PENDING_AI.value,
        objective_score=0.0,
        subjective_score=0.0,
        score=0.0,
    )
    db_session.add(submission)
    await db_session.flush()

    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student.id,
        submitted_at=now,
        latest_submission_id=submission.id,
        submission_count=1,
        objective_score=0.0,
        subjective_score=0.0,
        score=0.0,
        grading_status=GradingStatus.PENDING_AI.value,
    )
    db_session.add(exam_student)

    answer = StudentExamAnswer(
        exam_id=exam.id,
        student_id=student.id,
        question_id=question.id,
        answer_content={"text": "我的答案"},
        score_awarded=0.0,
        is_correct=False,
        feedback={},
    )
    submission_answer = StudentExamSubmissionAnswer(
        submission_id=submission.id,
        exam_id=exam.id,
        student_id=student.id,
        question_id=question.id,
        answer_content={"text": "我的答案"},
        score_awarded=0.0,
        is_correct=False,
        feedback={},
    )
    db_session.add_all([answer, submission_answer])
    await db_session.flush()

    return exam, exam_student, question, answer, submission, submission_answer


def _make_grading_task(
    *,
    exam_id,
    student_id,
    question_id,
    submission_id,
    status: str,
) -> GradingTask:
    return GradingTask(
        source_type="exam_submission",
        source_business_id=f"{exam_id}:{question_id}:{student_id}:{submission_id}",
        question_type=QuestionType.SHORT_ANSWER.value,
        question_content="占位",
        language="zh-CN",
        max_score=10,
        knowledge_tags=[],
        fatal_rule_enabled=True,
        student_answer_raw="我的答案",
        student_answer_structured={"text": "我的答案"},
        attachment_refs=[],
        standard_answers=[{"text": "结合强缓存与协商缓存"}],
        rubric_definition={},
        scoring_points=[],
        dimension_weights={},
        deduction_rules=[],
        fatal_error_rules=[],
        role_binding_version=1,
        programming_language=None,
        runtime_logs=[],
        status=status,
    )


@pytest.mark.asyncio
async def test_has_pending_treats_running_as_pending(db_session: AsyncSession) -> None:
    exam, exam_student, question, _answer, submission, _sub_answer = await _seed_submitted_subjective_exam(db_session)
    task = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="running",
    )
    db_session.add(task)
    await db_session.flush()

    assert await _has_pending_exam_submission_tasks(
        db_session,
        exam_id=exam.id,
        student_id=exam_student.student_id,
        submission_id=submission.id,
    ) is True


@pytest.mark.asyncio
async def test_has_pending_excludes_failed_tasks(db_session: AsyncSession) -> None:
    """Regression: a failed task must NOT count as 'still pending' or every
    classmate with one failure would be stranded in PENDING_AI forever.
    """
    exam, exam_student, question, _answer, submission, _sub_answer = await _seed_submitted_subjective_exam(db_session)
    task = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="failed",
    )
    db_session.add(task)
    await db_session.flush()

    assert await _has_pending_exam_submission_tasks(
        db_session,
        exam_id=exam.id,
        student_id=exam_student.student_id,
        submission_id=submission.id,
    ) is False


@pytest.mark.asyncio
async def test_has_pending_excludes_arbitration_required_tasks(db_session: AsyncSession) -> None:
    exam, exam_student, question, _answer, submission, _sub_answer = await _seed_submitted_subjective_exam(db_session)
    task = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="arbitration_required",
    )
    db_session.add(task)
    await db_session.flush()

    assert await _has_pending_exam_submission_tasks(
        db_session,
        exam_id=exam.id,
        student_id=exam_student.student_id,
        submission_id=submission.id,
    ) is False


@pytest.mark.asyncio
async def test_apply_failure_marks_answer_and_unblocks_status(db_session: AsyncSession) -> None:
    exam, exam_student, question, answer, submission, submission_answer = await _seed_submitted_subjective_exam(db_session)
    task = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="failed",
    )
    db_session.add(task)
    await db_session.flush()

    result = await apply_grading_task_failure_to_exam_submission(
        db_session,
        str(task.id),
        reason="qwen provider timeout",
    )

    await db_session.refresh(answer)
    await db_session.refresh(submission_answer)
    await db_session.refresh(exam_student)

    assert answer.feedback.get("grading_failed") is True
    assert "qwen provider timeout" in answer.feedback.get("grading_failure_reason", "")
    assert submission_answer.feedback.get("grading_failed") is True
    assert exam_student.grading_status == GradingStatus.AI_SCORED.value
    assert result["grading_status"] == GradingStatus.AI_SCORED.value


@pytest.mark.asyncio
async def test_apply_failure_keeps_pending_when_other_tasks_running(db_session: AsyncSession) -> None:
    exam, exam_student, question, _answer, submission, _sub_answer = await _seed_submitted_subjective_exam(db_session)

    failed_task = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="failed",
    )
    # A second question still running on the same submission.
    other_running = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,  # any uuid; reuse to avoid extra question setup
        submission_id=submission.id,
        status="running",
    )
    db_session.add_all([failed_task, other_running])
    await db_session.flush()

    result = await apply_grading_task_failure_to_exam_submission(
        db_session,
        str(failed_task.id),
        reason="provider 5xx",
    )

    await db_session.refresh(exam_student)
    assert exam_student.grading_status == GradingStatus.PENDING_AI.value
    assert result["grading_status"] == GradingStatus.PENDING_AI.value


@pytest.mark.asyncio
async def test_recover_pending_exam_submission_tasks_resets_running_to_pending(
    db_session: AsyncSession,
) -> None:
    exam, exam_student, question, _answer, submission, _sub_answer = await _seed_submitted_subjective_exam(db_session)
    interrupted_running = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="running",
    )
    waiting_pending = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="pending",
    )
    finished = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="completed",
    )
    db_session.add_all([interrupted_running, waiting_pending, finished])
    await db_session.flush()

    recovered = await recover_pending_exam_submission_tasks(db_session)
    await db_session.refresh(interrupted_running)
    await db_session.refresh(finished)

    assert set(recovered) == {str(interrupted_running.id), str(waiting_pending.id)}
    assert interrupted_running.status == "pending"
    assert finished.status == "completed"


@pytest.mark.asyncio
async def test_recover_pending_exam_submission_tasks_returns_empty_when_clean(
    db_session: AsyncSession,
) -> None:
    assert await recover_pending_exam_submission_tasks(db_session) == []


@pytest.mark.asyncio
async def test_student_regrade_endpoint_resets_failed_task_to_pending(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    exam, exam_student, question, _answer, submission, _sub_answer = await _seed_submitted_subjective_exam(db_session)
    task = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="failed",
    )
    db_session.add(task)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(exam_student.student_id, '')}"})
    response = await client.post(
        f"/api/student/exams/{exam.id}/questions/{question.id}/regrade"
    )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "pending"
    assert body["task_id"] == str(task.id)

    await db_session.refresh(task)
    assert task.status == "pending"


@pytest.mark.asyncio
async def test_student_regrade_endpoint_rejects_when_task_completed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    exam, exam_student, question, _answer, submission, _sub_answer = await _seed_submitted_subjective_exam(db_session)
    task = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="completed",
    )
    db_session.add(task)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(exam_student.student_id, '')}"})
    response = await client.post(
        f"/api/student/exams/{exam.id}/questions/{question.id}/regrade"
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_apply_failure_uses_human_review_messaging_for_arbitration(db_session: AsyncSession) -> None:
    exam, exam_student, question, answer, submission, _sub_answer = await _seed_submitted_subjective_exam(db_session)
    task = _make_grading_task(
        exam_id=exam.id,
        student_id=exam_student.student_id,
        question_id=question.id,
        submission_id=submission.id,
        status="arbitration_required",
    )
    db_session.add(task)
    await db_session.flush()

    await apply_grading_task_failure_to_exam_submission(
        db_session,
        str(task.id),
        reason="score_disagreement",
        needs_human_review=True,
    )

    await db_session.refresh(answer)
    assert answer.feedback.get("needs_human_review") is True
    assert "等待教师人工复核" in answer.feedback["deductions"][0]

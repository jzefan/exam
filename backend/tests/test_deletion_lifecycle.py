from datetime import datetime, timezone
import uuid

import pytest
from sqlalchemy import select

from app.auth.models import User
from app.exams.models import Exam, ExamQuestion, ExamStudent, StudentExamAnswer, StudentExamSubmission
from app.questions.models import Question, QuestionType
from app.questions.service import cleanup_soft_deleted_question_if_orphaned, soft_delete_question


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _get_admin_user(db_session):
    result = await db_session.execute(select(User).where(User.username == "admin"))
    return result.scalar_one()


async def _create_owner_user(db_session, prefix: str = "owner"):
    user = User(
        username=f"{prefix}-{uuid.uuid4()}",
        email=f"{prefix}-{uuid.uuid4()}@example.com",
        password_hash="hashed",
        full_name="Owner",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _create_question(db_session, owner_id):
    question = Question(
      type=QuestionType.CODE,
      title="待删除代码题",
      content={"html": "<p>test</p>", "text": "test"},
      options=None,
      answer={"code": "print(1)"},
      analysis=None,
      difficulty=3,
      score=10,
      created_by=owner_id,
      owner_id=owner_id,
    )
    db_session.add(question)
    await db_session.flush()
    return question


async def _create_exam(db_session, owner_id, question_ids):
    exam = Exam(
      category="exam",
      title=f"考试-{uuid.uuid4()}",
      description=None,
      start_time=None,
      end_time=None,
      duration_minutes=60,
      total_score=100,
      status="draft",
      created_by=owner_id,
      owner_id=owner_id,
    )
    db_session.add(exam)
    await db_session.flush()
    for order, question_id in enumerate(question_ids):
        db_session.add(
            ExamQuestion(
                exam_id=exam.id,
                question_id=question_id,
                order=order,
                score_override=None,
            )
        )
    await db_session.flush()
    return exam


async def _create_student_submission_history(db_session, exam_id, student_id, question_id):
    db_session.add(
        ExamStudent(
            exam_id=exam_id,
            student_id=student_id,
            started_at=_utcnow(),
            submitted_at=_utcnow(),
        )
    )
    await db_session.flush()
    db_session.add(
        StudentExamAnswer(
            exam_id=exam_id,
            student_id=student_id,
            question_id=question_id,
            answer_content={"code": "print(1)"},
            score_awarded=0,
            is_correct=False,
            feedback={},
        )
    )
    db_session.add(
        StudentExamSubmission(
            exam_id=exam_id,
            student_id=student_id,
            attempt_no=1,
            submitted_at=_utcnow(),
            grading_status="pending_ai",
            objective_score=0,
            subjective_score=0,
            score=0,
        )
    )
    await db_session.flush()


@pytest.mark.asyncio
async def test_delete_exam_with_submissions_soft_deletes_only(admin_client, db_session):
    admin = await _get_admin_user(db_session)
    question = await _create_question(db_session, admin.id)
    exam = await _create_exam(db_session, admin.id, [question.id])

    student = User(
        username=f"student-{uuid.uuid4()}",
        email=f"student-{uuid.uuid4()}@example.com",
        password_hash="hashed",
        full_name="Student",
        is_active=True,
    )
    db_session.add(student)
    await db_session.flush()
    await _create_student_submission_history(db_session, exam.id, student.id, question.id)
    await db_session.commit()

    response = await admin_client.delete(f"/api/exams/{exam.id}")

    assert response.status_code == 204
    refreshed_exam = await db_session.get(Exam, exam.id)
    assert refreshed_exam is not None
    assert refreshed_exam.deleted_at is not None
    submission = await db_session.scalar(
        select(StudentExamSubmission).where(StudentExamSubmission.exam_id == exam.id)
    )
    assert submission is not None


@pytest.mark.asyncio
async def test_delete_exam_without_student_history_hard_deletes(admin_client, db_session):
    admin = await _get_admin_user(db_session)
    question = await _create_question(db_session, admin.id)
    exam = await _create_exam(db_session, admin.id, [question.id])
    await db_session.commit()

    response = await admin_client.delete(f"/api/exams/{exam.id}")

    assert response.status_code == 204
    assert await db_session.get(Exam, exam.id) is None


@pytest.mark.asyncio
async def test_cleanup_soft_deleted_question_hard_deletes_only_when_no_refs_or_history(db_session):
    admin = await _create_owner_user(db_session)

    question = await _create_question(db_session, admin.id)
    await soft_delete_question(db_session, question)
    deleted = await cleanup_soft_deleted_question_if_orphaned(db_session, question.id)
    assert deleted is True
    assert await db_session.get(Question, question.id) is None

    question_with_exam = await _create_question(db_session, admin.id)
    exam = await _create_exam(db_session, admin.id, [question_with_exam.id])
    await soft_delete_question(db_session, question_with_exam)
    deleted = await cleanup_soft_deleted_question_if_orphaned(db_session, question_with_exam.id)
    assert deleted is False
    assert await db_session.get(Question, question_with_exam.id) is not None

    student = User(
        username=f"student-{uuid.uuid4()}",
        email=f"student-{uuid.uuid4()}@example.com",
        password_hash="hashed",
        full_name="Student",
        is_active=True,
    )
    db_session.add(student)
    await db_session.flush()

    question_with_history = await _create_question(db_session, admin.id)
    history_exam = await _create_exam(db_session, admin.id, [question_with_history.id])
    await _create_student_submission_history(db_session, history_exam.id, student.id, question_with_history.id)
    await soft_delete_question(db_session, question_with_history)
    history_exam.deleted_at = _utcnow()
    await db_session.flush()

    deleted = await cleanup_soft_deleted_question_if_orphaned(db_session, question_with_history.id)
    assert deleted is False
    assert await db_session.get(Question, question_with_history.id) is not None

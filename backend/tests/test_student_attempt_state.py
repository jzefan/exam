"""Tests for ExamAttemptState transitions and expired-attempt rejection."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamAttemptState, ExamQuestion, ExamStudent
from app.questions.models import Question, QuestionType


async def _make_exam_with_student(db_session, *, start_offset_min=-30, end_offset_min=30):
    teacher = await create_user(
        db_session,
        UserCreate(
            username=f"teacher_state_{id(db_session)}",
            email=f"teacher_state_{id(db_session)}@example.com",
            password="pass123",
            full_name="Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username=f"student_state_{id(db_session)}",
            email=f"student_state_{id(db_session)}@example.com",
            password="pass123",
            full_name="Student",
            role_name="student",
        ),
    )
    question = Question(
        type=QuestionType.CHOICE,
        title="State test Q",
        content={"text": "<p>Q?</p>"},
        options={"A": "Yes", "B": "No"},
        answer={"correct": "A"},
        analysis="",
        difficulty=1,
        score=10,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    exam = Exam(
        title="状态机测试",
        description="",
        start_time=now + timedelta(minutes=start_offset_min),
        end_time=now + timedelta(minutes=end_offset_min),
        duration_minutes=abs(end_offset_min - start_offset_min),
        total_score=10,
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
    return exam, question, student


@pytest.mark.asyncio
async def test_start_exam_transitions_to_in_progress(
    client: AsyncClient, db_session
) -> None:
    exam, question, student = await _make_exam_with_student(db_session)
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    r = await client.post(f"/api/student/exams/{exam.id}/start")
    assert r.status_code == 200
    # Verify attempt-status reflects in_progress
    status_r = await client.get(f"/api/student/exams/{exam.id}/attempt-status")
    assert status_r.status_code == 200
    assert status_r.json()["state"] == "in_progress"


@pytest.mark.asyncio
async def test_submit_transitions_to_submitted(
    client: AsyncClient, db_session
) -> None:
    exam, question, student = await _make_exam_with_student(db_session)
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    await client.post(f"/api/student/exams/{exam.id}/start")
    r = await client.post(
        f"/api/student/exams/{exam.id}/submit",
        json={"answers": [{"question_id": str(question.id), "answer_content": {"selected": ["A"]}}]},
    )
    assert r.status_code == 200
    status_r = await client.get(f"/api/student/exams/{exam.id}/attempt-status")
    assert status_r.json()["state"] in ("submitted", "graded")


@pytest.mark.asyncio
async def test_save_after_deadline_returns_410(
    client: AsyncClient, db_session
) -> None:
    """After exam end_time, saving answers should return 410 Gone."""
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_expired_save",
            email="teacher_expired_save@example.com",
            password="pass123",
            full_name="Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_expired_save",
            email="student_expired_save@example.com",
            password="pass123",
            full_name="Student",
            role_name="student",
        ),
    )
    question = Question(
        type=QuestionType.CHOICE,
        title="Expired Q",
        content={"text": "<p>Q?</p>"},
        options={"A": "Yes", "B": "No"},
        answer={"correct": "A"},
        analysis="",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    exam = Exam(
        title="已过期考试",
        description="",
        start_time=now - timedelta(minutes=60),
        end_time=now - timedelta(seconds=5),
        duration_minutes=30,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    # Create an ExamStudent already in_progress (simulating a session that started before end_time)
    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student.id,
        attempt_state=ExamAttemptState.IN_PROGRESS.value,
        started_at=now - timedelta(minutes=30),
    )
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            exam_student,
        ]
    )
    await db_session.commit()

    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    r = await client.post(
        f"/api/student/exams/{exam.id}/answers",
        json={"answers": [{"question_id": str(question.id), "answer_content": {"selected": ["A"]}}]},
    )
    assert r.status_code == 410


@pytest.mark.asyncio
async def test_expired_attempt_status_shows_expired(
    client: AsyncClient, db_session
) -> None:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_exp_status",
            email="teacher_exp_status@example.com",
            password="pass123",
            full_name="Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_exp_status",
            email="student_exp_status@example.com",
            password="pass123",
            full_name="Student",
            role_name="student",
        ),
    )
    question = Question(
        type=QuestionType.CHOICE,
        title="Status Q",
        content={"text": "<p>Q?</p>"},
        options={"A": "Y", "B": "N"},
        answer={"correct": "A"},
        analysis="",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    exam = Exam(
        title="已过期状态",
        description="",
        start_time=now - timedelta(minutes=60),
        end_time=now - timedelta(seconds=5),
        duration_minutes=30,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student.id,
        attempt_state=ExamAttemptState.IN_PROGRESS.value,
        started_at=now - timedelta(minutes=50),
    )
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            exam_student,
        ]
    )
    await db_session.commit()

    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    r = await client.get(f"/api/student/exams/{exam.id}/attempt-status")
    assert r.status_code == 200
    assert r.json()["state"] == "expired"

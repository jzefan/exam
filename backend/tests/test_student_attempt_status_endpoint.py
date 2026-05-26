"""Tests for GET /api/student/exams/{exam_id}/attempt-status."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamAttemptState, ExamQuestion, ExamStudent
from app.questions.models import Question, QuestionType


async def _make_exam_student(db_session, *, state=ExamAttemptState.IN_PROGRESS.value,
                              end_offset_min=30, username_suffix=""):
    suffix = username_suffix or str(id(db_session))
    teacher = await create_user(
        db_session,
        UserCreate(
            username=f"teacher_as_{suffix}",
            email=f"teacher_as_{suffix}@example.com",
            password="pass123",
            full_name="Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username=f"student_as_{suffix}",
            email=f"student_as_{suffix}@example.com",
            password="pass123",
            full_name="Student",
            role_name="student",
        ),
    )
    question = Question(
        type=QuestionType.CHOICE,
        title="Q",
        content={"text": "Q?"},
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
        title="状态查询测试",
        description="",
        start_time=now - timedelta(minutes=10),
        end_time=now + timedelta(minutes=end_offset_min),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=3,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student.id,
        attempt_state=state,
        started_at=now - timedelta(minutes=5),
        switch_count=1,
    )
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            exam_student,
        ]
    )
    await db_session.commit()
    return exam, student


@pytest.mark.asyncio
async def test_attempt_status_returns_correct_shape(
    client: AsyncClient, db_session
) -> None:
    exam, student = await _make_exam_student(db_session, username_suffix="shape")
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    r = await client.get(f"/api/student/exams/{exam.id}/attempt-status")
    assert r.status_code == 200
    data = r.json()
    assert "state" in data
    assert "switch_count" in data
    assert "max_switch_count" not in data  # not in AttemptStatusResponse
    assert data["state"] == "in_progress"
    assert data["switch_count"] == 1


@pytest.mark.asyncio
async def test_attempt_status_submitted_state(
    client: AsyncClient, db_session
) -> None:
    exam, student = await _make_exam_student(
        db_session, state=ExamAttemptState.SUBMITTED.value, username_suffix="sub"
    )
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    r = await client.get(f"/api/student/exams/{exam.id}/attempt-status")
    assert r.status_code == 200
    assert r.json()["state"] == "submitted"


@pytest.mark.asyncio
async def test_attempt_status_lazily_expires_in_progress(
    client: AsyncClient, db_session
) -> None:
    """An in_progress attempt past end_time should be lazily expired on GET."""
    exam, student = await _make_exam_student(
        db_session,
        state=ExamAttemptState.IN_PROGRESS.value,
        end_offset_min=-1,  # already ended
        username_suffix="lazy",
    )
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    r = await client.get(f"/api/student/exams/{exam.id}/attempt-status")
    assert r.status_code == 200
    assert r.json()["state"] == "expired"

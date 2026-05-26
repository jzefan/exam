"""Tests for idempotent exam submission: second submit returns 200 with existing data."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamAttemptState, ExamQuestion, ExamStudent
from app.questions.models import Question, QuestionType


@pytest.mark.asyncio
async def test_second_submit_returns_200_with_existing_data(
    client: AsyncClient, db_session
) -> None:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_idem",
            email="teacher_idem@example.com",
            password="teacherpass123",
            full_name="Teacher Idem",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_idem",
            email="student_idem@example.com",
            password="studentpass123",
            full_name="Student Idem",
            role_name="student",
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="测试题",
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

    exam = Exam(
        title="幂等提交测试",
        description="",
        start_time=datetime.now(timezone.utc) - timedelta(minutes=30),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=30),
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

    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            ExamStudent(exam_id=exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    # Start the exam
    start_r = await client.post(f"/api/student/exams/{exam.id}/start")
    assert start_r.status_code == 200

    # First submit
    submit_payload = {
        "answers": [
            {"question_id": str(question.id), "answer_content": {"selected": ["A"]}}
        ]
    }
    first_r = await client.post(f"/api/student/exams/{exam.id}/submit", json=submit_payload)
    assert first_r.status_code == 200
    first_data = first_r.json()
    assert first_data["submitted"] is True

    # Second submit must also return 200 (not 400)
    second_r = await client.post(f"/api/student/exams/{exam.id}/submit", json=submit_payload)
    assert second_r.status_code == 200
    second_data = second_r.json()
    assert second_data["submitted"] is True


@pytest.mark.asyncio
async def test_second_submit_preserves_grading_status(
    client: AsyncClient, db_session
) -> None:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_idem2",
            email="teacher_idem2@example.com",
            password="teacherpass123",
            full_name="Teacher Idem2",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_idem2",
            email="student_idem2@example.com",
            password="studentpass123",
            full_name="Student Idem2",
            role_name="student",
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="Q2",
        content={"text": "<p>Q?</p>"},
        options={"A": "Yes", "B": "No"},
        answer={"correct": "B"},
        analysis="",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="幂等保留状态测试",
        description="",
        start_time=datetime.now(timezone.utc) - timedelta(minutes=30),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=30),
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

    # Pre-create an already-submitted ExamStudent
    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student.id,
        attempt_state=ExamAttemptState.SUBMITTED.value,
        submitted_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        score=5,
        grading_status="reviewed",
    )
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            exam_student,
        ]
    )
    await db_session.commit()

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    # Submit on an already-submitted attempt returns 200
    r = await client.post(
        f"/api/student/exams/{exam.id}/submit",
        json={"answers": []},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["submitted"] is True

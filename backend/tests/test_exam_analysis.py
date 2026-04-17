"""Tests for GET /api/exams/{exam_id}/analysis."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent, StudentExamAnswer
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role, UserOrganization


async def _create_org_with_roles(db_session):
    org = Organization(name="Analysis School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()
    return org, teacher_role, student_role


async def _assign_role(db_session, user_id, org_id, role_id) -> None:
    db_session.add(
        UserOrganization(user_id=user_id, org_id=org_id, role_id=role_id, is_primary=True)
    )
    await db_session.flush()


@pytest.mark.asyncio
async def test_exam_analysis_computes_overall_and_distribution(
    client: AsyncClient, db_session
) -> None:
    org, teacher_role, student_role = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-analysis",
            email="teacher-analysis@example.com",
            password="teacherpass123",
            full_name="Teacher Analysis",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student_a = await create_user(
        db_session,
        UserCreate(
            username="student-a",
            email="student-a@example.com",
            password="studentpass123",
            full_name="Student A",
            role_name="student",
            org_id=org.id,
        ),
    )
    student_b = await create_user(
        db_session,
        UserCreate(
            username="student-b",
            email="student-b@example.com",
            password="studentpass123",
            full_name="Student B",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="1+1=?",
        content={"text": "1+1=?"},
        options={"A": "1", "B": "2"},
        answer={"value": "B"},
        difficulty=1,
        score=10.0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="分析考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(hours=2),
        end_time=datetime.now(timezone.utc) - timedelta(minutes=5),
        duration_minutes=60,
        total_score=100.0,
        status="completed",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    now = datetime.now(timezone.utc)
    db_session.add(
        ExamStudent(
            exam_id=exam.id,
            student_id=student_a.id,
            submitted_at=now,
            objective_score=90.0,
            subjective_score=0.0,
            score=90.0,
            grading_status="reviewed",
        )
    )
    db_session.add(
        ExamStudent(
            exam_id=exam.id,
            student_id=student_b.id,
            submitted_at=now,
            objective_score=40.0,
            subjective_score=0.0,
            score=40.0,
            grading_status="reviewed",
        )
    )
    db_session.add(
        StudentExamAnswer(
            exam_id=exam.id,
            student_id=student_a.id,
            question_id=question.id,
            answer_content={"value": "B"},
            score_awarded=10.0,
            is_correct=True,
        )
    )
    db_session.add(
        StudentExamAnswer(
            exam_id=exam.id,
            student_id=student_b.id,
            question_id=question.id,
            answer_content={"value": "A"},
            score_awarded=0.0,
            is_correct=False,
        )
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get(f"/api/exams/{exam.id}/analysis")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["exam_id"] == str(exam.id)
    assert payload["overall"]["total_students"] == 2
    assert payload["overall"]["submitted_count"] == 2
    assert payload["overall"]["graded_count"] == 2
    assert payload["overall"]["highest_score"] == 90.0
    assert payload["overall"]["lowest_score"] == 40.0
    assert payload["overall"]["average_score"] == 65.0
    assert payload["overall"]["pass_count"] == 1
    assert payload["overall"]["pass_rate"] == 0.5

    buckets = {b["label"]: b["count"] for b in payload["score_distribution"]}
    assert buckets["不及格"] == 1
    assert buckets["优秀"] == 1

    assert len(payload["students"]) == 2
    assert payload["students"][0]["score"] == 90.0
    assert payload["students"][1]["score"] == 40.0

    assert len(payload["questions"]) == 1
    q = payload["questions"][0]
    assert q["attempt_count"] == 2
    assert q["correct_count"] == 1
    assert q["correct_rate"] == 0.5
    assert q["average_score"] == 5.0


@pytest.mark.asyncio
async def test_student_cannot_access_exam_analysis(
    client: AsyncClient, db_session
) -> None:
    org, _, _ = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-forbid",
            email="teacher-forbid@example.com",
            password="teacherpass123",
            full_name="Teacher Forbid",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student-forbid",
            email="student-forbid@example.com",
            password="studentpass123",
            full_name="Student Forbid",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam = Exam(
        title="禁止分析考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(hours=2),
        end_time=datetime.now(timezone.utc) - timedelta(minutes=5),
        duration_minutes=60,
        total_score=100.0,
        status="completed",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    db_session.add(ExamStudent(exam_id=exam.id, student_id=student.id))
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    response = await client.get(f"/api/exams/{exam.id}/analysis")

    assert response.status_code == 403

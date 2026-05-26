"""Tests for teacher manual per-question scoring from answer details."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent, GradingStatus, StudentExamAnswer
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _seed_org_with_roles(db_session) -> Organization:
    org = Organization(name="Manual Score School", type="school", is_active=True)
    db_session.add_all(
        [
            org,
            Role(name="teacher", display_name="Teacher", is_system=True),
            Role(name="student", display_name="Student", is_system=True),
        ]
    )
    await db_session.flush()
    return org


@pytest.mark.asyncio
async def test_teacher_manual_score_updates_question_and_exam_totals(
    client: AsyncClient, db_session
) -> None:
    org = await _seed_org_with_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="manual-score-teacher",
            email="manual-score-teacher@example.com",
            password="pass1234",
            full_name="Manual Score Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="manual-score-student",
            email="manual-score-student@example.com",
            password="pass1234",
            full_name="Manual Score Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    choice = Question(
        type=QuestionType.CHOICE,
        title="1+1=?",
        content={"text": "1+1=?"},
        options={"A": "1", "B": "2"},
        answer={"value": "B"},
        difficulty=1,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    essay = Question(
        type=QuestionType.ESSAY,
        title="说明二分查找",
        content={"text": "说明二分查找。"},
        options=None,
        answer={"points": ["有序", "折半"]},
        difficulty=1,
        score=10,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([choice, essay])
    await db_session.flush()

    exam = Exam(
        title="Manual Score Exam",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(hours=2),
        end_time=datetime.now(timezone.utc) + timedelta(hours=2),
        duration_minutes=60,
        total_score=15,
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
            ExamQuestion(exam_id=exam.id, question_id=choice.id, order=0, score_override=5),
            ExamQuestion(exam_id=exam.id, question_id=essay.id, order=1, score_override=10),
        ]
    )

    submitted_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.add(
        ExamStudent(
            exam_id=exam.id,
            student_id=student.id,
            submitted_at=submitted_at,
            grading_status=GradingStatus.REVIEWED.value,
            objective_score=5,
            subjective_score=4,
            score=9,
        )
    )
    db_session.add_all(
        [
            StudentExamAnswer(
                exam_id=exam.id,
                student_id=student.id,
                question_id=choice.id,
                answer_content={"selected": ["B"]},
                score_awarded=5,
                is_correct=True,
                feedback={},
            ),
            StudentExamAnswer(
                exam_id=exam.id,
                student_id=student.id,
                question_id=essay.id,
                answer_content={"html": "<p>折半查找</p>"},
                score_awarded=4,
                is_correct=False,
                feedback={},
            ),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.patch(
        f"/api/exams/{exam.id}/students/{student.id}/questions/{essay.id}/score",
        json={"score_awarded": 7},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["question_id"] == str(essay.id)
    assert body["score_awarded"] == 7
    assert body["total_score"] == 10
    assert body["exam_score"] == 12
    assert body["objective_score"] == 5
    assert body["subjective_score"] == 7

    refreshed_answer = (
        await db_session.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == exam.id,
                StudentExamAnswer.student_id == student.id,
                StudentExamAnswer.question_id == essay.id,
            )
        )
    ).scalar_one()
    assert refreshed_answer.score_awarded == 7

    refreshed_student = (
        await db_session.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == exam.id,
                ExamStudent.student_id == student.id,
            )
        )
    ).scalar_one()
    assert refreshed_student.objective_score == 5
    assert refreshed_student.subjective_score == 7
    assert refreshed_student.score == 12


@pytest.mark.asyncio
async def test_teacher_manual_score_rejects_score_above_question_total(
    client: AsyncClient, db_session
) -> None:
    org = await _seed_org_with_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="manual-score-limit-teacher",
            email="manual-score-limit-teacher@example.com",
            password="pass1234",
            full_name="Manual Score Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="manual-score-limit-student",
            email="manual-score-limit-student@example.com",
            password="pass1234",
            full_name="Manual Score Student",
            role_name="student",
            org_id=org.id,
        ),
    )
    question = Question(
        type=QuestionType.ESSAY,
        title="说明二分查找",
        content={"text": "说明二分查找。"},
        options=None,
        answer={"points": ["有序", "折半"]},
        difficulty=1,
        score=10,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()
    exam = Exam(
        title="Manual Score Limit Exam",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(hours=2),
        end_time=datetime.now(timezone.utc) + timedelta(hours=2),
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
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0, score_override=10))
    db_session.add(
        ExamStudent(
            exam_id=exam.id,
            student_id=student.id,
            submitted_at=datetime.now(timezone.utc),
            grading_status=GradingStatus.REVIEWED.value,
            subjective_score=4,
            score=4,
        )
    )
    db_session.add(
        StudentExamAnswer(
            exam_id=exam.id,
            student_id=student.id,
            question_id=question.id,
            answer_content={},
            score_awarded=4,
            is_correct=False,
            feedback={},
        )
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.patch(
        f"/api/exams/{exam.id}/students/{student.id}/questions/{question.id}/score",
        json={"score_awarded": 11},
    )

    assert response.status_code == 400
    assert "cannot exceed" in response.json()["detail"]

"""Tests for GET /api/wrong-answers carrying exam/practice grouping info."""

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, StudentQuestionProgress
from app.questions.models import Question, QuestionType


async def _make_student_with_wrong_answers(db_session, *, suffix: str):
    teacher = await create_user(
        db_session,
        UserCreate(
            username=f"teacher_wa_{suffix}",
            email=f"teacher_wa_{suffix}@example.com",
            password="pass123",
            full_name="Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username=f"student_wa_{suffix}",
            email=f"student_wa_{suffix}@example.com",
            password="pass123",
            full_name="Student",
            role_name="student",
        ),
    )

    exam = Exam(
        category="practice",
        title="SQL 基础练习",
        description="",
        duration_minutes=30,
        total_score=10,
        status="ongoing",
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    exam_questions = []
    for index in range(2):
        question = Question(
            type=QuestionType.CHOICE,
            title=f"题目 {index}",
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
        exam_questions.append(question)

    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            StudentQuestionProgress(
                student_id=student.id,
                question_id=exam_questions[0].id,
                last_exam_id=exam.id,
                wrong_count=2,
                last_wrong_at=now,
                mastered=False,
            ),
            StudentQuestionProgress(
                student_id=student.id,
                question_id=exam_questions[1].id,
                last_exam_id=None,
                wrong_count=1,
                last_wrong_at=now,
                mastered=True,
                mastered_at=now,
            ),
        ]
    )
    await db_session.commit()
    return exam, student


@pytest.mark.asyncio
async def test_list_wrong_answers_exposes_exam_identity(client: AsyncClient, db_session) -> None:
    exam, student = await _make_student_with_wrong_answers(db_session, suffix="exam")
    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    response = await client.get("/api/wrong-answers")
    assert response.status_code == 200

    items = response.json()
    assert len(items) == 1
    item = items[0]
    assert item["exam_id"] == str(exam.id)
    assert item["exam_category"] == "practice"
    assert item["exam_title"] == "SQL 基础练习"
    assert item["mastered"] is False


@pytest.mark.asyncio
async def test_list_wrong_answers_without_exam_falls_back_to_exam_category(
    client: AsyncClient, db_session
) -> None:
    _exam, student = await _make_student_with_wrong_answers(db_session, suffix="mastered")
    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    response = await client.get("/api/wrong-answers", params={"mastered": "true"})
    assert response.status_code == 200

    items = response.json()
    assert len(items) == 1
    assert items[0]["exam_id"] is None
    assert items[0]["exam_category"] == "exam"
    assert items[0]["mastered"] is True


@pytest.mark.asyncio
async def test_wrong_answer_detail_also_carries_exam_id(client: AsyncClient, db_session) -> None:
    exam, student = await _make_student_with_wrong_answers(db_session, suffix="detail")
    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    list_response = await client.get("/api/wrong-answers")
    progress_id = list_response.json()[0]["id"]

    response = await client.get(f"/api/wrong-answers/{progress_id}")
    assert response.status_code == 200

    detail = response.json()
    assert detail["exam_id"] == str(exam.id)
    assert detail["exam_category"] == "practice"

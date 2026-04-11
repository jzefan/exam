from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent
from app.questions.models import Question, QuestionType


@pytest.mark.asyncio
async def test_student_can_submit_with_final_answers_after_exam_end(
    client: AsyncClient, db_session
) -> None:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_submit_after_end",
            email="teacher_submit_after_end@example.com",
            password="teacherpass123",
            full_name="Teacher Submit After End",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_submit_after_end",
            email="student_submit_after_end@example.com",
            password="studentpass123",
            full_name="Student Submit After End",
            role_name="student",
        ),
    )

    choice_question = Question(
        type=QuestionType.CHOICE,
        title="网络分层题",
        content={"text": "<p>OSI 共有几层？</p>"},
        options={"A": "5", "B": "7"},
        answer={"correct": "B"},
        analysis="OSI 七层模型。",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(choice_question)
    await db_session.flush()

    exam = Exam(
        title="已结束补提交考试",
        description="验证考试结束后仍可随最终提交携带答案",
        start_time=datetime.now(timezone.utc) - timedelta(minutes=20),
        end_time=datetime.now(timezone.utc) - timedelta(seconds=5),
        duration_minutes=10,
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
            ExamQuestion(exam_id=exam.id, question_id=choice_question.id, order=0),
            ExamStudent(exam_id=exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    submit_response = await client.post(
        f"/api/student/exams/{exam.id}/submit",
        json={
            "answers": [
                {
                    "question_id": str(choice_question.id),
                    "answer_content": {"selected": ["B"]},
                }
            ]
        },
    )

    assert submit_response.status_code == 200
    assert submit_response.json()["submitted"] is True
    assert submit_response.json()["score"] == 5

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.exams.models import Exam, ExamQuestion
from app.questions.models import Question, QuestionBank, QuestionType
from app.rbac.models import Organization, Role


@pytest.mark.asyncio
async def test_exam_owner_can_load_private_referenced_question_details(
    client: AsyncClient,
    db_session,
) -> None:
    org = Organization(name="Exam Question Detail School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, teacher_role])
    await db_session.flush()

    exam_owner = await create_user(
        db_session,
        UserCreate(
            username="exam-detail-owner",
            email="exam-detail-owner@example.com",
            password="teacherpass123",
            full_name="Exam Detail Owner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    question_owner = await create_user(
        db_session,
        UserCreate(
            username="exam-detail-question-owner",
            email="exam-detail-question-owner@example.com",
            password="teacherpass123",
            full_name="Question Owner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    private_bank = QuestionBank(
        name="Private Course Bank",
        description=None,
        owner_id=question_owner.id,
        visibility=VisibilityScope.PRIVATE,
    )
    question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Private referenced question",
        content={"text": "Explain decorators"},
        options=None,
        answer={"text": "A callable wrapper"},
        analysis="Mention higher-order functions.",
        difficulty=3,
        score=10,
        created_by=question_owner.id,
        owner_id=question_owner.id,
        question_bank=private_bank,
    )
    exam = Exam(
        category="practice",
        title="Referenced question practice",
        description=None,
        start_time=None,
        end_time=None,
        duration_minutes=60,
        total_score=10,
        status="draft",
        created_by=exam_owner.id,
        owner_id=exam_owner.id,
    )
    db_session.add_all([private_bank, question, exam])
    await db_session.flush()
    db_session.add(
        ExamQuestion(
            exam_id=exam.id,
            question_id=question.id,
            order=0,
            score_override=10,
        )
    )
    await db_session.commit()

    client.headers.update(
        {"Authorization": f"Bearer {create_access_token(exam_owner.id, '')}"}
    )

    general_response = await client.get(f"/api/questions?id_in={question.id}")
    assert general_response.status_code == 200
    assert general_response.json() == []

    exam_response = await client.get(f"/api/exams/{exam.id}/question-details")
    assert exam_response.status_code == 200
    assert [item["id"] for item in exam_response.json()] == [str(question.id)]
    assert exam_response.json()[0]["content"] == {"text": "Explain decorators"}
    assert exam_response.json()[0]["answer"] == {"text": "A callable wrapper"}

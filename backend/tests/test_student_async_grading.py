from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent
from app.grading.models import GradingResultSnapshot, GradingTask, ModelConfig, ProviderConfig, RoleBinding
from app.questions.models import Question, QuestionType


async def _seed_role_binding(db_session) -> None:
    provider = ProviderConfig(
        key="test-provider",
        provider_type="qwen",
        base_url="https://example.com",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    db_session.add(provider)
    await db_session.flush()

    grader = ModelConfig(
        key="grader",
        display_name="Grader",
        model_name="grader-model",
        provider_id=provider.id,
        temperature=0.1,
        is_active=True,
    )
    reviewer = ModelConfig(
        key="reviewer",
        display_name="Reviewer",
        model_name="reviewer-model",
        provider_id=provider.id,
        temperature=0.1,
        is_active=True,
    )
    arbiter = ModelConfig(
        key="arbiter",
        display_name="Arbiter",
        model_name="arbiter-model",
        provider_id=provider.id,
        temperature=0.0,
        is_active=True,
    )
    db_session.add_all([grader, reviewer, arbiter])
    await db_session.flush()

    db_session.add(
        RoleBinding(
            version=1,
            grader_model_id=grader.id,
            reviewer_model_id=reviewer.id,
            arbiter_model_id=arbiter.id,
            is_active=True,
        )
    )
    await db_session.flush()


@pytest.mark.asyncio
async def test_submit_exam_with_subjective_question_enters_pending_ai_and_creates_grading_task(
    client: AsyncClient, db_session, monkeypatch
) -> None:
    async def fake_schedule(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        "app.exams.student_router._schedule_subjective_grading_tasks",
        fake_schedule,
        raising=False,
    )

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_async_grading",
            email="teacher_async_grading@example.com",
            password="teacherpass123",
            full_name="Teacher Async",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_async_grading",
            email="student_async_grading@example.com",
            password="studentpass123",
            full_name="Student Async",
            role_name="student",
        ),
    )
    await _seed_role_binding(db_session)

    choice_question = Question(
        type=QuestionType.CHOICE,
        title="选择题",
        content={"text": "<p>2+2=?</p>"},
        options={"A": "3", "B": "4"},
        answer={"correct": "B"},
        analysis="答案为 4。",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
    )
    short_question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="简答题",
        content={"text": "<p>请解释索引覆盖。</p>"},
        options=None,
        answer={"points": ["减少回表", "覆盖查询列"]},
        analysis="需要说明减少回表。",
        difficulty=2,
        score=10,
        usage_count=0,
        created_by=teacher.id,
    )
    db_session.add_all([choice_question, short_question])
    await db_session.flush()

    exam = Exam(
        title="异步评分考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=15,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=choice_question.id, order=0),
            ExamQuestion(exam_id=exam.id, question_id=short_question.id, order=1),
            ExamStudent(exam_id=exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    response = await client.post(
        f"/api/student/exams/{exam.id}/submit",
        json={
            "answers": [
                {"question_id": str(choice_question.id), "answer_content": {"selected": ["B"]}},
                {"question_id": str(short_question.id), "answer_content": {"html": "<p>我认为索引覆盖是...</p>"}},
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["submitted"] is True
    assert response.json()["grading_status"] == "pending_ai"
    assert response.json()["score"] == 5

    exam_student = (
        await db_session.execute(
            select(ExamStudent).where(ExamStudent.exam_id == exam.id, ExamStudent.student_id == student.id)
        )
    ).scalar_one()
    assert exam_student.grading_status == "pending_ai"
    assert exam_student.objective_score == 5
    assert exam_student.subjective_score == 0

    tasks = (await db_session.execute(select(GradingTask))).scalars().all()
    assert len(tasks) == 1
    assert tasks[0].source_type == "exam_submission"


@pytest.mark.asyncio
async def test_teacher_can_confirm_ai_scored_exam_and_create_student_notification(
    client: AsyncClient, db_session
) -> None:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_confirm_grading",
            email="teacher_confirm_grading@example.com",
            password="teacherpass123",
            full_name="Teacher Confirm",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_confirm_grading",
            email="student_confirm_grading@example.com",
            password="studentpass123",
            full_name="Student Confirm",
            role_name="student",
        ),
    )
    await _seed_role_binding(db_session)

    question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="简答题",
        content={"text": "<p>请解释事务隔离。</p>"},
        options=None,
        answer={"points": ["隔离级别"]},
        analysis="说明隔离级别。",
        difficulty=2,
        score=10,
        usage_count=0,
        created_by=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="审核确认考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) - timedelta(hours=1),
        duration_minutes=60,
        total_score=10,
        status="completed",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()
    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student.id,
        submitted_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        grading_status="ai_scored",
        objective_score=0,
        subjective_score=8,
        score=8,
        ai_scored_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            exam_student,
        ]
    )
    await db_session.flush()

    task = GradingTask(
        source_type="exam_submission",
        source_business_id=f"{exam.id}:{question.id}:{student.id}",
        status="completed",
        question_type="short_answer",
        question_content="请解释事务隔离。",
        subject="数据库",
        language="zh-CN",
        max_score=10,
        knowledge_tags=[],
        fatal_rule_enabled=True,
        student_answer_raw="答案",
        standard_answers=[],
        rubric_definition={},
        scoring_points=[],
        dimension_weights={},
        deduction_rules=[],
        fatal_error_rules=[],
        role_binding_version=1,
        attachment_refs=[],
        runtime_logs=[],
    )
    db_session.add(task)
    await db_session.flush()

    snapshot = GradingResultSnapshot(
        task_id=task.id,
        snapshot_type="final",
        score_total=8,
        dimension_scores={},
        deduction_reasons=[],
        strengths=["要点完整"],
        improvement_suggestions=[],
        evidence_summary={},
        risk_flags=[],
        role_binding_version=1,
        created_by="system",
    )
    db_session.add(snapshot)
    await db_session.flush()
    task.latest_final_snapshot = snapshot
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(f"/api/grading/tasks/{task.id}/confirm")

    assert response.status_code == 200
    assert response.json()["grading_status"] == "reviewed"

    await db_session.refresh(exam_student)
    assert exam_student.grading_status == "reviewed"
    assert exam_student.reviewed_at is not None

    unread = await client.get(f"/api/student/notifications/unread", headers={"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    assert unread.status_code == 200
    payload = unread.json()
    assert len(payload) == 1
    assert payload[0]["title"] == "考试成绩已审核确认"

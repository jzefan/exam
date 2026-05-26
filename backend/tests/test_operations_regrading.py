from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import (
    Exam,
    ExamQuestion,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamSubmission,
    StudentExamSubmissionAnswer,
    StudentQuestionProgress,
)
from app.grading.models import ModelConfig, ProviderConfig, RoleBinding
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _seed_active_role_binding(db_session) -> None:
    provider = ProviderConfig(
        key="ops-test-provider",
        provider_type="qwen",
        base_url="https://example.com",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    db_session.add(provider)
    await db_session.flush()

    models = [
        ModelConfig(
            key=f"ops-{role}",
            display_name=role.title(),
            model_name=f"{role}-model",
            provider_id=provider.id,
            temperature=0.1,
            is_active=True,
        )
        for role in ("grader", "reviewer", "arbiter")
    ]
    db_session.add_all(models)
    await db_session.flush()
    db_session.add(
        RoleBinding(
            version=1,
            grader_model_id=models[0].id,
            reviewer_model_id=models[1].id,
            arbiter_model_id=models[2].id,
            is_active=True,
        )
    )
    await db_session.flush()


async def _create_org_with_roles(db_session) -> Organization:
    org = Organization(name="Operations School", type="school", is_active=True)
    db_session.add_all(
        [
            org,
            Role(name="platform_admin", display_name="Platform Admin", is_system=True),
            Role(name="teacher", display_name="Teacher", is_system=True),
            Role(name="evaluator", display_name="Evaluator", is_system=True),
            Role(name="student", display_name="Student", is_system=True),
        ]
    )
    await db_session.flush()
    return org


async def _create_submitted_fill_in_attempt(
    db_session,
    *,
    exam: Exam,
    question: Question,
    student_id,
    answer_content: dict[str, object],
    score_awarded: float,
    is_correct: bool,
) -> StudentExamSubmission:
    submitted_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student_id,
        started_at=submitted_at - timedelta(minutes=20),
        submitted_at=submitted_at,
        latest_submission_id=None,
        submission_count=1,
        grading_status=GradingStatus.REVIEWED.value,
        objective_score=score_awarded,
        subjective_score=0,
        score=score_awarded,
        ai_scored_at=submitted_at,
        reviewed_at=submitted_at,
        graded_at=submitted_at,
    )
    db_session.add(exam_student)
    await db_session.flush()

    submission = StudentExamSubmission(
        exam_id=exam.id,
        student_id=student_id,
        attempt_no=1,
        submitted_at=submitted_at,
        grading_status=GradingStatus.REVIEWED.value,
        objective_score=score_awarded,
        subjective_score=0,
        score=score_awarded,
    )
    db_session.add(submission)
    await db_session.flush()

    exam_student.latest_submission_id = submission.id
    db_session.add_all(
        [
            StudentExamAnswer(
                exam_id=exam.id,
                student_id=student_id,
                question_id=question.id,
                answer_content=answer_content,
                score_awarded=score_awarded,
                is_correct=is_correct,
                feedback={},
            ),
            StudentExamSubmissionAnswer(
                submission_id=submission.id,
                exam_id=exam.id,
                student_id=student_id,
                question_id=question.id,
                answer_content=answer_content,
                score_awarded=score_awarded,
                is_correct=is_correct,
                feedback={},
            ),
        ]
    )
    await db_session.flush()
    return submission


@pytest.mark.asyncio
async def test_regrading_cascade_is_platform_admin_only(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="ops-teacher",
            email="ops-teacher@example.com",
            password="teacherpass123",
            full_name="Ops Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    evaluator = await create_user(
        db_session,
        UserCreate(
            username="ops-evaluator",
            email="ops-evaluator@example.com",
            password="teacherpass123",
            full_name="Ops Evaluator",
            role_name="evaluator",
            org_id=org.id,
        ),
    )
    admin = await create_user(
        db_session,
        UserCreate(
            username="ops-admin",
            email="ops-admin@example.com",
            password="adminpass123",
            full_name="Ops Admin",
            role_name="platform_admin",
            org_id=org.id,
        ),
    )
    teacher_id = teacher.id
    evaluator_id = evaluator.id
    admin_id = admin.id

    fill_question = Question(
        type=QuestionType.FILL_IN,
        title="填空题",
        content={"text": "请填写____。"},
        options=None,
        answer={"blanks": ["A"]},
        analysis=None,
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    short_question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="简答题",
        content={"text": "请简答。"},
        options=None,
        answer={"reference": "参考答案"},
        analysis=None,
        difficulty=2,
        score=8,
        usage_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    choice_question = Question(
        type=QuestionType.CHOICE,
        title="选择题",
        content={"text": "请选择。"},
        options={"A": "A", "B": "B"},
        answer={"correct": "A"},
        analysis=None,
        difficulty=1,
        score=2,
        usage_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    db_session.add_all([fill_question, short_question, choice_question])
    await db_session.flush()

    exam = Exam(
        category="exam",
        title="运营重评分考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
        total_score=15,
        status="ongoing",
        max_switch_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    practice = Exam(
        category="practice",
        title="运营重评分作业",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    db_session.add_all([exam, practice])
    await db_session.flush()
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=fill_question.id, order=0),
            ExamQuestion(exam_id=exam.id, question_id=short_question.id, order=1),
            ExamQuestion(exam_id=exam.id, question_id=choice_question.id, order=2),
            ExamQuestion(exam_id=practice.id, question_id=fill_question.id, order=0),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher_id, '')}"})
    forbidden = await client.get("/api/operations/regrading/assignees")
    assert forbidden.status_code == 403

    client.headers.update({"Authorization": f"Bearer {create_access_token(admin_id, '')}"})
    assignees = await client.get("/api/operations/regrading/assignees")
    assert assignees.status_code == 200
    assignee_payload = assignees.json()
    assert {item["id"] for item in assignee_payload} == {str(admin_id), str(teacher_id), str(evaluator_id)}

    exams = await client.get(f"/api/operations/regrading/assignees/{evaluator_id}/exams")
    assert exams.status_code == 200
    exam_payload = exams.json()
    assert {item["kind"] for item in exam_payload} == {"exam", "practice"}
    assert {item["title"] for item in exam_payload} == {"运营重评分考试", "运营重评分作业"}

    questions = await client.get(f"/api/operations/regrading/exams/{exam.id}/questions")
    assert questions.status_code == 200
    question_payload = questions.json()
    assert {item["question_id"] for item in question_payload} == {
        str(fill_question.id),
        str(short_question.id),
    }


@pytest.mark.asyncio
async def test_regrading_fill_in_question_updates_only_selected_exam(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    admin = await create_user(
        db_session,
        UserCreate(
            username="ops-admin-regrade",
            email="ops-admin-regrade@example.com",
            password="adminpass123",
            full_name="Ops Admin Regrade",
            role_name="platform_admin",
            org_id=org.id,
        ),
    )
    evaluator = await create_user(
        db_session,
        UserCreate(
            username="ops-evaluator-regrade",
            email="ops-evaluator-regrade@example.com",
            password="teacherpass123",
            full_name="Ops Evaluator Regrade",
            role_name="evaluator",
            org_id=org.id,
        ),
    )
    selected_student = await create_user(
        db_session,
        UserCreate(
            username="ops-selected-student",
            email="ops-selected-student@example.com",
            password="studentpass123",
            full_name="Ops Selected Student",
            role_name="student",
            org_id=org.id,
        ),
    )
    other_student = await create_user(
        db_session,
        UserCreate(
            username="ops-other-student",
            email="ops-other-student@example.com",
            password="studentpass123",
            full_name="Ops Other Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.FILL_IN,
        title="重评填空题",
        content={"text": "请填写____。"},
        options=None,
        answer={"blanks": ["A"]},
        analysis=None,
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    db_session.add(question)
    await db_session.flush()

    selected_exam = Exam(
        category="exam",
        title="被选中的考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    other_exam = Exam(
        category="exam",
        title="不应被重评的考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    db_session.add_all([selected_exam, other_exam])
    await db_session.flush()
    db_session.add_all(
        [
            ExamQuestion(exam_id=selected_exam.id, question_id=question.id, order=0),
            ExamQuestion(exam_id=other_exam.id, question_id=question.id, order=0),
        ]
    )
    await db_session.flush()
    await _create_submitted_fill_in_attempt(
        db_session,
        exam=selected_exam,
        question=question,
        student_id=selected_student.id,
        answer_content={"blanks": ["A"]},
        score_awarded=0,
        is_correct=False,
    )
    await _create_submitted_fill_in_attempt(
        db_session,
        exam=other_exam,
        question=question,
        student_id=other_student.id,
        answer_content={"blanks": ["A"]},
        score_awarded=0,
        is_correct=False,
    )
    db_session.add(
        StudentQuestionProgress(
            student_id=selected_student.id,
            question_id=question.id,
            last_exam_id=selected_exam.id,
            wrong_count=1,
            mastered=False,
            last_wrong_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(admin.id, '')}"})
    response = await client.post(
        f"/api/operations/regrading/exams/{selected_exam.id}/questions/{question.id}",
    )

    assert response.status_code == 200, f"detail: {response.json().get('detail', response.text)}"
    body = response.json()
    assert body["affected_submissions"] == 1
    # FILL_IN always uses the synchronous fill-in grader (the LLM task
    # pipeline raises "unsupported question_type" for fill_in), so we expect
    # the latest answer to be updated in place regardless of RoleBinding.
    assert body["updated_latest_answers"] == 1
    assert body["created_grading_tasks"] == 0

    selected_answer = (
        await db_session.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == selected_exam.id,
                StudentExamAnswer.student_id == selected_student.id,
                StudentExamAnswer.question_id == question.id,
            )
        )
    ).scalar_one()
    assert selected_answer.score_awarded == 5
    assert selected_answer.is_correct is True

    selected_exam_student = (
        await db_session.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == selected_exam.id,
                ExamStudent.student_id == selected_student.id,
            )
        )
    ).scalar_one()
    assert selected_exam_student.score == 5

    # Other exam submission is untouched
    other_answer = (
        await db_session.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == other_exam.id,
                StudentExamAnswer.student_id == other_student.id,
                StudentExamAnswer.question_id == question.id,
            )
        )
    ).scalar_one()
    assert other_answer.score_awarded == 0
    assert other_answer.is_correct is False

    # Progress refreshed
    progress = (
        await db_session.execute(
            select(StudentQuestionProgress).where(
                StudentQuestionProgress.student_id == selected_student.id,
                StudentQuestionProgress.question_id == question.id,
            )
        )
    ).scalar_one()
    assert progress.wrong_count == 0
    assert progress.mastered is True


@pytest.mark.asyncio
async def test_fill_in_regrade_uses_sync_grader_even_with_active_role_binding(
    client: AsyncClient, db_session, monkeypatch
) -> None:
    """Regression: FILL_IN must always use the synchronous fill-in grader.

    Previously the regrading flow created a subjective LLM grading task for
    fill_in when an active RoleBinding existed — but the grading task pipeline
    raises `unsupported question_type: fill_in`. The fix routes fill_in through
    the synchronous DeepSeek-backed equivalence grader instead, and exposes
    `force_recompute=True` so the cache doesn't short-circuit the regrade.
    """
    # Patch the DeepSeek call so the regrade gets a deterministic "equivalent"
    # verdict. The submission was pre-seeded with score 0; the regrade triggers
    # the only DeepSeek call exercised by this test.
    call_count = {"value": 0}

    async def fake_ai(*, question_text, expected_answers, student_answers, knowledge_points=None):
        call_count["value"] += 1
        return [{"score": 1.0, "is_correct": True, "reason": "plt.xlabel() refers to xlabel"}]

    monkeypatch.setattr(
        "app.exams.student_router._request_fill_in_equivalence_with_deepseek", fake_ai
    )

    org = await _create_org_with_roles(db_session)
    await _seed_active_role_binding(db_session)
    admin = await create_user(
        db_session,
        UserCreate(
            username="ops-admin-rb",
            email="ops-admin-rb@example.com",
            password="adminpass123",
            full_name="Ops Admin RB",
            role_name="platform_admin",
            org_id=org.id,
        ),
    )
    evaluator = await create_user(
        db_session,
        UserCreate(
            username="ops-evaluator-rb",
            email="ops-evaluator-rb@example.com",
            password="teacherpass123",
            full_name="Ops Evaluator RB",
            role_name="evaluator",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="ops-student-rb",
            email="ops-student-rb@example.com",
            password="studentpass123",
            full_name="Ops Student RB",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.FILL_IN,
        title="Matplotlib 设置 x 轴标签的函数是____。",
        content={"text": "Matplotlib 设置 x 轴标签的函数是____。"},
        options=None,
        answer={"correct": ["xlabel"]},
        analysis=None,
        difficulty=1,
        score=2,
        usage_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        category="exam",
        title="重评 fill_in",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
        total_score=2,
        status="ongoing",
        max_switch_count=0,
        created_by=evaluator.id,
        owner_id=evaluator.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await db_session.flush()

    await _create_submitted_fill_in_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"blanks": ["plt.xlabel()"]},
        score_awarded=0,
        is_correct=False,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(admin.id, '')}"})
    response = await client.post(
        f"/api/operations/regrading/exams/{exam.id}/questions/{question.id}",
    )

    assert response.status_code == 200, response.text
    body = response.json()
    # FILL_IN must use the synchronous grader (not the LLM task pipeline),
    # so no grading tasks are created — affected_submissions == updated_latest_answers == 1.
    assert body["affected_submissions"] == 1
    assert body["updated_latest_answers"] == 1
    assert body["created_grading_tasks"] == 0

    # And force_recompute should have invalidated the cache, so the AI was
    # actually re-invoked — proving the regrade isn't returning the stale 0.
    assert call_count["value"] == 1  # only the regrade call; submission used a pre-seeded result

    refreshed = (
        await db_session.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == exam.id,
                StudentExamAnswer.student_id == student.id,
                StudentExamAnswer.question_id == question.id,
            )
        )
    ).scalar_one()
    assert refreshed.score_awarded == 2
    assert refreshed.is_correct is True

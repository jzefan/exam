from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent, GradingStatus, StudentExamAnswer, StudentExamSubmission, StudentExamSubmissionAnswer, StudentQuestionProgress
from app.grading.models import GradingTask, ModelConfig, ProviderConfig, RoleBinding
from app.questions.models import Question, QuestionType
from app.questions.service import regrade_submitted_attempts_for_question_update
from app.rbac.models import Organization, Role


async def _seed_role_binding(db_session) -> None:
    provider = ProviderConfig(
        key="question-regrade-provider",
        provider_type="qwen",
        base_url="https://example.com",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    db_session.add(provider)
    await db_session.flush()

    grader = ModelConfig(
        key="question-regrade-grader",
        display_name="Grader",
        model_name="grader-model",
        provider_id=provider.id,
        temperature=0.1,
        is_active=True,
    )
    reviewer = ModelConfig(
        key="question-regrade-reviewer",
        display_name="Reviewer",
        model_name="reviewer-model",
        provider_id=provider.id,
        temperature=0.1,
        is_active=True,
    )
    arbiter = ModelConfig(
        key="question-regrade-arbiter",
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


async def _create_org_with_teacher_role(db_session) -> Organization:
    org = Organization(name="Question Regrade School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()
    return org


class _SessionFactory:
    def __init__(self, db_session):
        self._db_session = db_session

    async def __aenter__(self):
        return self._db_session

    async def __aexit__(self, exc_type, exc, tb):
        return None


async def _create_submitted_attempt(
    db_session,
    *,
    exam: Exam,
    question: Question,
    student_id,
    answer_content: dict[str, Any],
    score_awarded: float,
    is_correct: bool,
) -> StudentExamSubmission:
    exam_student = ExamStudent(
        exam_id=exam.id,
        student_id=student_id,
        started_at=datetime.now(timezone.utc) - timedelta(minutes=20),
        submitted_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        submission_count=1,
        grading_status=GradingStatus.REVIEWED.value,
        objective_score=score_awarded if question.type != QuestionType.CODE else 0.0,
        subjective_score=score_awarded if question.type == QuestionType.CODE else 0.0,
        score=score_awarded,
        ai_scored_at=datetime.now(timezone.utc) - timedelta(minutes=4),
        reviewed_at=datetime.now(timezone.utc) - timedelta(minutes=3),
        graded_at=datetime.now(timezone.utc) - timedelta(minutes=4),
    )
    db_session.add(exam_student)
    await db_session.flush()

    submission = StudentExamSubmission(
        exam_id=exam.id,
        student_id=student_id,
        attempt_no=1,
        submitted_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        grading_status=GradingStatus.REVIEWED.value,
        objective_score=score_awarded if question.type != QuestionType.CODE else 0.0,
        subjective_score=score_awarded if question.type == QuestionType.CODE else 0.0,
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
async def test_update_question_api_runs_background_regrading_for_answer_changes(
    client: AsyncClient,
    db_session,
    monkeypatch,
) -> None:
    calls: list[tuple[str, set[str]]] = []

    async def fake_regrade(question_id, regrade_fields):
        calls.append((str(question_id), set(regrade_fields)))

    monkeypatch.setattr(
        "app.questions.router.regrade_submitted_attempts_for_question_update",
        fake_regrade,
    )

    org = await _create_org_with_teacher_role(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-api-teacher",
            email="question-regrade-api-teacher@example.com",
            password="teacherpass123",
            full_name="Question Regrade API Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-api-student",
            email="question-regrade-api-student@example.com",
            password="studentpass123",
            full_name="Question Regrade API Student",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="原题",
        content={"text": "<p>原题干</p>"},
        options={"A": "甲", "B": "乙"},
        answer={"correct": "A"},
        analysis="解析",
        difficulty=2,
        score=5.0,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="已提交考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=15),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=45),
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
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await _create_submitted_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"selected": ["B"]},
        score_awarded=0.0,
        is_correct=False,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.put(
        f"/api/questions/{question.id}",
        json={"answer": {"correct": "B"}},
    )

    assert response.status_code == 200
    assert calls == [(str(question.id), {"answer"})]


@pytest.mark.asyncio
async def test_regrade_objective_question_updates_only_submitted_non_deleted_attempts(
    db_session,
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.questions.service.async_session", lambda: _SessionFactory(db_session))

    teacher = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-objective-teacher",
            email="question-regrade-objective-teacher@example.com",
            password="teacherpass123",
            full_name="Question Regrade Objective Teacher",
            role_name="teacher",
        ),
    )
    submitted_student = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-submitted-student",
            email="question-regrade-submitted-student@example.com",
            password="studentpass123",
            full_name="Submitted Student",
            role_name="student",
        ),
    )
    unsubmitted_student = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-unsubmitted-student",
            email="question-regrade-unsubmitted-student@example.com",
            password="studentpass123",
            full_name="Unsubmitted Student",
            role_name="student",
        ),
    )
    deleted_exam_student = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-deleted-student",
            email="question-regrade-deleted-student@example.com",
            password="studentpass123",
            full_name="Deleted Exam Student",
            role_name="student",
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="选择题",
        content={"text": "<p>2+2=?</p>"},
        options={"A": "3", "B": "4"},
        answer={"correct": "A"},
        analysis="旧答案",
        difficulty=1,
        score=5.0,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    active_exam = Exam(
        title="有效考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=15),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=45),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    deleted_exam = Exam(
        title="已删除考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) - timedelta(hours=1),
        duration_minutes=60,
        total_score=5,
        status="completed",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
        deleted_at=datetime.now(timezone.utc),
    )
    db_session.add_all([active_exam, deleted_exam])
    await db_session.flush()
    db_session.add_all(
        [
            ExamQuestion(exam_id=active_exam.id, question_id=question.id, order=0),
            ExamQuestion(exam_id=deleted_exam.id, question_id=question.id, order=0),
            ExamStudent(
                exam_id=active_exam.id,
                student_id=unsubmitted_student.id,
                started_at=datetime.now(timezone.utc) - timedelta(minutes=8),
                saved_answers={str(question.id): {"selected": ["B"]}},
            ),
            StudentExamAnswer(
                exam_id=active_exam.id,
                student_id=unsubmitted_student.id,
                question_id=question.id,
                answer_content={"selected": ["B"]},
                score_awarded=0.0,
                is_correct=False,
                feedback={},
            ),
        ]
    )
    await db_session.flush()

    await _create_submitted_attempt(
        db_session,
        exam=active_exam,
        question=question,
        student_id=submitted_student.id,
        answer_content={"selected": ["B"]},
        score_awarded=0.0,
        is_correct=False,
    )
    await _create_submitted_attempt(
        db_session,
        exam=deleted_exam,
        question=question,
        student_id=deleted_exam_student.id,
        answer_content={"selected": ["B"]},
        score_awarded=0.0,
        is_correct=False,
    )
    question.answer = {"correct": "B"}
    await db_session.commit()

    await regrade_submitted_attempts_for_question_update(question.id, {"answer"})

    submitted_answer = (
        await db_session.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == active_exam.id,
                StudentExamAnswer.student_id == submitted_student.id,
                StudentExamAnswer.question_id == question.id,
            )
        )
    ).scalar_one()
    assert submitted_answer.score_awarded == 5.0
    assert submitted_answer.is_correct is True

    unsubmitted_answer = (
        await db_session.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == active_exam.id,
                StudentExamAnswer.student_id == unsubmitted_student.id,
                StudentExamAnswer.question_id == question.id,
            )
        )
    ).scalar_one()
    assert unsubmitted_answer.score_awarded == 0.0
    assert unsubmitted_answer.is_correct is False

    deleted_exam_answer = (
        await db_session.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == deleted_exam.id,
                StudentExamAnswer.student_id == deleted_exam_student.id,
                StudentExamAnswer.question_id == question.id,
            )
        )
    ).scalar_one()
    assert deleted_exam_answer.score_awarded == 0.0
    assert deleted_exam_answer.is_correct is False


@pytest.mark.asyncio
async def test_regrade_objective_question_removes_fixed_wrong_answer_from_progress(
    db_session,
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.questions.service.async_session", lambda: _SessionFactory(db_session))

    teacher = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-progress-fixed-teacher",
            email="question-regrade-progress-fixed-teacher@example.com",
            password="teacherpass123",
            full_name="Question Regrade Progress Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-progress-fixed-student",
            email="question-regrade-progress-fixed-student@example.com",
            password="studentpass123",
            full_name="Question Regrade Progress Student",
            role_name="student",
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="选择题",
        content={"text": "<p>2+2=?</p>"},
        options={"A": "3", "B": "4"},
        answer={"correct": "A"},
        analysis="旧答案",
        difficulty=1,
        score=5.0,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="错题本同步考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=15),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=45),
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
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await _create_submitted_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"selected": ["B"]},
        score_awarded=0.0,
        is_correct=False,
    )
    db_session.add(
        StudentQuestionProgress(
            student_id=student.id,
            question_id=question.id,
            last_exam_id=exam.id,
            wrong_count=1,
            last_wrong_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            mastered=False,
        )
    )
    question.answer = {"correct": "B"}
    await db_session.commit()

    await regrade_submitted_attempts_for_question_update(question.id, {"answer"})

    progress = (
        await db_session.execute(
            select(StudentQuestionProgress).where(
                StudentQuestionProgress.student_id == student.id,
                StudentQuestionProgress.question_id == question.id,
            )
        )
    ).scalar_one()
    assert progress.wrong_count == 0
    assert progress.mastered is True
    assert progress.last_exam_id is None
    assert progress.last_wrong_at is None
    assert progress.mastered_at is not None


@pytest.mark.asyncio
async def test_regrade_objective_question_adds_newly_wrong_answer_to_progress(
    db_session,
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.questions.service.async_session", lambda: _SessionFactory(db_session))

    teacher = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-progress-new-teacher",
            email="question-regrade-progress-new-teacher@example.com",
            password="teacherpass123",
            full_name="Question Regrade Progress New Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-progress-new-student",
            email="question-regrade-progress-new-student@example.com",
            password="studentpass123",
            full_name="Question Regrade Progress New Student",
            role_name="student",
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="选择题",
        content={"text": "<p>2+2=?</p>"},
        options={"A": "3", "B": "4"},
        answer={"correct": "B"},
        analysis="旧答案",
        difficulty=1,
        score=5.0,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="错题本新增考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=15),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=45),
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
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    await _create_submitted_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"selected": ["B"]},
        score_awarded=5.0,
        is_correct=True,
    )
    question.answer = {"correct": "A"}
    await db_session.commit()

    await regrade_submitted_attempts_for_question_update(question.id, {"answer"})

    progress = (
        await db_session.execute(
            select(StudentQuestionProgress).where(
                StudentQuestionProgress.student_id == student.id,
                StudentQuestionProgress.question_id == question.id,
            )
        )
    ).scalar_one()
    assert progress.wrong_count == 1
    assert progress.mastered is False
    assert progress.last_exam_id == exam.id
    assert progress.last_wrong_at is not None


@pytest.mark.asyncio
async def test_regrade_code_question_enqueues_grading_tasks_for_submitted_attempts(
    db_session,
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.questions.service.async_session", lambda: _SessionFactory(db_session))

    dispatched_task_ids: list[str] = []

    async def fake_run(task_ids: list[str]) -> None:
        dispatched_task_ids.extend(task_ids)

    monkeypatch.setattr("app.exams.student_router._run_subjective_grading_tasks", fake_run)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-code-teacher",
            email="question-regrade-code-teacher@example.com",
            password="teacherpass123",
            full_name="Question Regrade Code Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="question-regrade-code-student",
            email="question-regrade-code-student@example.com",
            password="studentpass123",
            full_name="Question Regrade Code Student",
            role_name="student",
        ),
    )
    await _seed_role_binding(db_session)

    question = Question(
        type=QuestionType.CODE,
        title="代码题",
        content={
            "text": "<p>实现加法</p>",
            "sample_tests": [{"input": "1 2", "expected_output": "3"}],
        },
        options=None,
        answer={"required_patterns": ["return"]},
        analysis="旧测试",
        difficulty=2,
        score=10.0,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="代码考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=15),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=45),
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
    db_session.add(ExamQuestion(exam_id=exam.id, question_id=question.id, order=0))
    submission = await _create_submitted_attempt(
        db_session,
        exam=exam,
        question=question,
        student_id=student.id,
        answer_content={"code": "def solve(a, b):\n    return a + b\n", "language": "python"},
        score_awarded=6.0,
        is_correct=True,
    )
    question.content = {
        "text": "<p>实现加法</p>",
        "sample_tests": [{"input": "2 3", "expected_output": "5"}],
    }
    await db_session.commit()

    await regrade_submitted_attempts_for_question_update(question.id, {"code_test_cases"})

    tasks = (await db_session.execute(select(GradingTask))).scalars().all()
    assert len(tasks) == 1
    assert tasks[0].source_type == "exam_submission"
    assert tasks[0].source_business_id == f"{exam.id}:{question.id}:{student.id}:{submission.id}"
    assert dispatched_task_ids == [str(tasks[0].id)]

    refreshed_exam_student = (
        await db_session.execute(
            select(ExamStudent).where(ExamStudent.exam_id == exam.id, ExamStudent.student_id == student.id)
        )
    ).scalar_one()
    refreshed_submission = await db_session.get(StudentExamSubmission, submission.id)
    assert refreshed_exam_student.grading_status == GradingStatus.PENDING_AI.value
    assert refreshed_submission is not None
    assert refreshed_submission.grading_status == GradingStatus.PENDING_AI.value

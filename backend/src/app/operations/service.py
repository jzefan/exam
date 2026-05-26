import uuid
from dataclasses import dataclass

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.exams.models import (
    Exam,
    ExamQuestion,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamSubmission,
    StudentExamSubmissionAnswer,
)
from app.grading.service import (
    _recompute_historical_submission_scores,
    _recompute_submission_scores,
    create_grading_task,
    refresh_student_question_progress_for_regrade,
)
from app.questions.models import Question, QuestionType


ALLOWED_REGRADING_QUESTION_TYPES = {
    QuestionType.FILL_IN.value,
    QuestionType.SHORT_ANSWER.value,
}


@dataclass(frozen=True)
class ExamQuestionRegradeResult:
    exam_id: uuid.UUID
    question_id: uuid.UUID
    question_type: str
    affected_submissions: int
    updated_latest_answers: int
    created_grading_tasks: int


@dataclass(frozen=True)
class SingleStudentFillInRegradeResult:
    exam_id: uuid.UUID
    question_id: uuid.UUID
    student_id: uuid.UUID
    total_score: float
    score_awarded: float
    is_correct: bool
    feedback: dict


def _strip_html(value: str | None) -> str:
    if not value:
        return ""
    import re

    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", value)).strip()


def question_preview(question: Question, max_length: int = 120) -> str:
    content = question.content if isinstance(question.content, dict) else {}
    raw = content.get("text") or content.get("html") or question.title
    preview = _strip_html(str(raw))
    if len(preview) <= max_length:
        return preview
    return f"{preview[: max_length - 1].rstrip()}…"


async def list_regrading_assignees(db: AsyncSession) -> list[dict]:
    from app.rbac.models import Role, UserOrganization

    rows = (
        await db.execute(
            select(User, Role.name)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .join(Role, Role.id == UserOrganization.role_id)
            .where(
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                Role.name.in_(["platform_admin", "teacher", "evaluator"]),
                Role.deleted_at.is_(None),
            )
            .order_by(User.full_name.asc(), User.username.asc())
        )
    ).all()

    users_by_id: dict[uuid.UUID, dict] = {}
    for user, role_name in rows:
        item = users_by_id.setdefault(
            user.id,
            {
                "id": user.id,
                "username": user.username,
                "full_name": user.full_name,
                "roles": [],
                "exam_count": 0,
                "practice_count": 0,
            },
        )
        if role_name not in item["roles"]:
            item["roles"].append(role_name)

    for item in users_by_id.values():
        exam_count = await db.scalar(
            select(func.count(Exam.id)).where(
                Exam.owner_id == item["id"],
                Exam.deleted_at.is_(None),
                Exam.status != "draft",
                Exam.category != "practice",
            )
        )
        practice_count = await db.scalar(
            select(func.count(Exam.id)).where(
                Exam.owner_id == item["id"],
                Exam.deleted_at.is_(None),
                Exam.status != "draft",
                Exam.category == "practice",
            )
        )
        item["exam_count"] = int(exam_count or 0)
        item["practice_count"] = int(practice_count or 0)

    return list(users_by_id.values())


async def list_regrading_exams_for_assignee(db: AsyncSession, assignee_id: uuid.UUID) -> list[dict]:
    exams = (
        await db.execute(
            select(Exam)
            .where(
                Exam.owner_id == assignee_id,
                Exam.deleted_at.is_(None),
                Exam.status != "draft",
            )
            .order_by(Exam.updated_at.desc(), Exam.created_at.desc())
        )
    ).scalars().unique().all()

    result: list[dict] = []
    for exam in exams:
        question_count = await db.scalar(
            select(func.count(ExamQuestion.question_id)).where(ExamQuestion.exam_id == exam.id)
        )
        submitted_count = await db.scalar(
            select(func.count(ExamStudent.student_id)).where(
                ExamStudent.exam_id == exam.id,
                ExamStudent.submitted_at.is_not(None),
            )
        )
        result.append(
            {
                "id": exam.id,
                "title": exam.title,
                "kind": "practice" if exam.category == "practice" else "exam",
                "status": exam.status,
                "total_questions": int(question_count or 0),
                "submitted_count": int(submitted_count or 0),
                "start_time": exam.start_time,
                "end_time": exam.end_time,
            }
        )
    return result


async def list_regrading_questions_for_exam(db: AsyncSession, exam_id: uuid.UUID) -> list[dict]:
    rows = (
        await db.execute(
            select(ExamQuestion, Question)
            .join(Exam, Exam.id == ExamQuestion.exam_id)
            .join(Question, Question.id == ExamQuestion.question_id)
            .where(
                ExamQuestion.exam_id == exam_id,
                Exam.deleted_at.is_(None),
                Question.deleted_at.is_(None),
                Question.type.in_([QuestionType.FILL_IN, QuestionType.SHORT_ANSWER]),
            )
            .order_by(ExamQuestion.order.asc())
        )
    ).all()

    result: list[dict] = []
    for exam_question, question in rows:
        question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
        submitted_count = await db.scalar(
            select(func.count(func.distinct(StudentExamSubmissionAnswer.student_id))).where(
                StudentExamSubmissionAnswer.exam_id == exam_id,
                StudentExamSubmissionAnswer.question_id == question.id,
            )
        )
        result.append(
            {
                "question_id": question.id,
                "order": exam_question.order,
                "type": question_type,
                "title": question.title,
                "content_preview": question_preview(question),
                "score": exam_question.score_override if exam_question.score_override is not None else question.score,
                "submitted_count": int(submitted_count or 0),
            }
        )
    return result


async def _get_regradable_exam_question(
    db: AsyncSession,
    *,
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
) -> tuple[Exam, ExamQuestion, Question]:
    row = (
        await db.execute(
            select(Exam, ExamQuestion, Question)
            .join(ExamQuestion, ExamQuestion.exam_id == Exam.id)
            .join(Question, Question.id == ExamQuestion.question_id)
            .where(
                Exam.id == exam_id,
                Exam.deleted_at.is_(None),
                ExamQuestion.question_id == question_id,
                Question.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        raise ValueError("考试或题目不存在")
    exam, exam_question, question = row
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    if question_type not in ALLOWED_REGRADING_QUESTION_TYPES:
        raise ValueError("仅支持重新评分填空题和简答题")
    return exam, exam_question, question


async def regrade_exam_question_submissions(
    db: AsyncSession,
    *,
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
) -> ExamQuestionRegradeResult:
    from app.exams.student_router import (
        _build_grading_task_payload,
        _get_active_role_binding_version,
        _grade_question_with_ai,
        _run_subjective_grading_tasks,
    )

    exam, exam_question, question = await _get_regradable_exam_question(
        db,
        exam_id=exam_id,
        question_id=question_id,
    )
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    question_score = float(exam_question.score_override if exam_question.score_override is not None else question.score)

    submission_answers = (
        await db.execute(
            select(StudentExamSubmissionAnswer)
            .join(
                ExamStudent,
                and_(
                    ExamStudent.exam_id == StudentExamSubmissionAnswer.exam_id,
                    ExamStudent.student_id == StudentExamSubmissionAnswer.student_id,
                ),
            )
            .where(
                StudentExamSubmissionAnswer.exam_id == exam_id,
                StudentExamSubmissionAnswer.question_id == question_id,
                ExamStudent.submitted_at.is_not(None),
            )
            .order_by(StudentExamSubmissionAnswer.student_id.asc(), StudentExamSubmissionAnswer.created_at.asc())
        )
    ).scalars().all()

    task_ids: list[str] = []
    role_binding_version: int | None = None
    updated_latest_answers = 0
    progress_refresh_keys: set[tuple[uuid.UUID, uuid.UUID]] = set()

    for submission_answer in submission_answers:
        exam_student = (
            await db.execute(
                select(ExamStudent).where(
                    ExamStudent.exam_id == exam_id,
                    ExamStudent.student_id == submission_answer.student_id,
                )
            )
        ).scalar_one_or_none()
        if exam_student is None:
            continue

        submission = await db.get(StudentExamSubmission, submission_answer.submission_id)
        if submission is None:
            continue

        live_answer = (
            await db.execute(
                select(StudentExamAnswer).where(
                    StudentExamAnswer.exam_id == exam_id,
                    StudentExamAnswer.student_id == submission_answer.student_id,
                    StudentExamAnswer.question_id == question_id,
                )
            )
        ).scalar_one_or_none()

        # Short-answer/essay/code go through the LLM-based subjective grading
        # task pipeline. Fill-in has its own dedicated synchronous grader
        # (DeepSeek equivalence checking) — routing fill-in through the
        # subjective pipeline would raise "unsupported question_type".
        if question_type == QuestionType.SHORT_ANSWER.value:
            if role_binding_version is None:
                try:
                    role_binding_version = await _get_active_role_binding_version(db)
                except Exception:
                    # No active role binding — fall back to synchronous grading
                    # for this submission only.
                    pass
            if role_binding_version is not None:
                task = await create_grading_task(
                    db,
                    _build_grading_task_payload(
                        exam=exam,
                        question=question,
                        question_score=question_score,
                        answer_content=dict(submission_answer.answer_content or {}),
                        role_binding_version=role_binding_version,
                        source_business_id=f"{exam_id}:{question_id}:{submission_answer.student_id}:{submission_answer.submission_id}",
                    ),
                )
                task_ids.append(str(task.id))
                submission.grading_status = GradingStatus.PENDING_AI.value
                if exam_student.latest_submission_id == submission_answer.submission_id:
                    exam_student.grading_status = GradingStatus.PENDING_AI.value
                    exam_student.ai_scored_at = None
                    exam_student.reviewed_at = None
                    exam_student.graded_at = None
                continue

        # Fill-in (or short-answer fallback when no role binding):
        # synchronous grader; force_recompute drops the cached verdict so a
        # manual regrade actually re-evaluates instead of returning a stale
        # signature-matched result.
        answer_content_copy = dict(submission_answer.answer_content or {})
        score_awarded, is_correct, feedback = await _grade_question_with_ai(
            question,
            answer_content_copy,
            question_score,
            force_recompute=True,
        )
        # Persist any updated grading cache back to the DB row.
        submission_answer.answer_content = answer_content_copy
        submission_answer.score_awarded = score_awarded
        submission_answer.is_correct = is_correct
        submission_answer.feedback = feedback

        objective_score, subjective_score = await _recompute_historical_submission_scores(
            db,
            submission_id=submission_answer.submission_id,
        )
        submission.objective_score = objective_score
        submission.subjective_score = subjective_score
        submission.score = round(objective_score + subjective_score, 2)

        if exam_student.latest_submission_id == submission_answer.submission_id and live_answer is not None:
            live_answer.answer_content = dict(answer_content_copy)
            live_answer.score_awarded = score_awarded
            live_answer.is_correct = is_correct
            live_answer.feedback = feedback
            latest_objective_score, latest_subjective_score = await _recompute_submission_scores(
                db,
                exam_id=exam_id,
                student_id=submission_answer.student_id,
            )
            exam_student.objective_score = latest_objective_score
            exam_student.subjective_score = latest_subjective_score
            exam_student.score = round(latest_objective_score + latest_subjective_score, 2)
            progress_refresh_keys.add((submission_answer.student_id, question_id))
            updated_latest_answers += 1

    for student_id, refresh_question_id in progress_refresh_keys:
        await refresh_student_question_progress_for_regrade(
            db,
            student_id=student_id,
            question_id=refresh_question_id,
        )

    await db.commit()

    if task_ids:
        try:
            await _run_subjective_grading_tasks(task_ids)
        except Exception:
            # Tasks are persisted; recovery will pick them up if the
            # synchronous run fails (e.g. LLM provider timeout).
            pass

    return ExamQuestionRegradeResult(
        exam_id=exam_id,
        question_id=question_id,
        question_type=question_type,
        affected_submissions=len(submission_answers),
        updated_latest_answers=updated_latest_answers,
        created_grading_tasks=len(task_ids),
    )


async def regrade_single_student_fill_in(
    db: AsyncSession,
    *,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    question_id: uuid.UUID,
) -> SingleStudentFillInRegradeResult:
    """Re-run DeepSeek fill-in grading for one student's latest submission of a question.

    Used by the per-row "AI 判题" action on the admin answer detail page. The
    caller is expected to have already verified write permission on the exam.
    Raises ValueError on validation failures so the router can map to 4xx codes.
    """
    from app.exams.student_router import _grade_question_with_ai

    exam, exam_question, question = await _get_regradable_exam_question(
        db,
        exam_id=exam_id,
        question_id=question_id,
    )
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    if question_type != QuestionType.FILL_IN.value:
        # Short-answer regrade for a single student would need to enqueue an
        # LLM grading task; keep this entry-point fill-in-only for now.
        raise ValueError("仅支持对填空题执行 AI 判题")

    question_score = float(
        exam_question.score_override if exam_question.score_override is not None else question.score
    )

    exam_student = (
        await db.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == exam_id,
                ExamStudent.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if exam_student is None or exam_student.submitted_at is None:
        raise LookupError("该考生尚未提交该考试")

    submission_id = exam_student.latest_submission_id
    submission_answer = None
    if submission_id is not None:
        submission_answer = (
            await db.execute(
                select(StudentExamSubmissionAnswer).where(
                    StudentExamSubmissionAnswer.exam_id == exam_id,
                    StudentExamSubmissionAnswer.student_id == student_id,
                    StudentExamSubmissionAnswer.question_id == question_id,
                    StudentExamSubmissionAnswer.submission_id == submission_id,
                )
            )
        ).scalar_one_or_none()

    if submission_answer is None:
        raise LookupError("找不到该考生对该题的作答记录")

    submission = await db.get(StudentExamSubmission, submission_answer.submission_id)
    if submission is None:
        raise LookupError("找不到该考生的提交记录")

    live_answer = (
        await db.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == exam_id,
                StudentExamAnswer.student_id == student_id,
                StudentExamAnswer.question_id == question_id,
            )
        )
    ).scalar_one_or_none()

    answer_content_copy = dict(submission_answer.answer_content or {})
    score_awarded, is_correct, feedback = await _grade_question_with_ai(
        question,
        answer_content_copy,
        question_score,
        force_recompute=True,
    )

    submission_answer.answer_content = answer_content_copy
    submission_answer.score_awarded = score_awarded
    submission_answer.is_correct = is_correct
    submission_answer.feedback = feedback

    objective_score, subjective_score = await _recompute_historical_submission_scores(
        db,
        submission_id=submission_answer.submission_id,
    )
    submission.objective_score = objective_score
    submission.subjective_score = subjective_score
    submission.score = round(objective_score + subjective_score, 2)

    if live_answer is not None:
        live_answer.answer_content = dict(answer_content_copy)
        live_answer.score_awarded = score_awarded
        live_answer.is_correct = is_correct
        live_answer.feedback = feedback
        latest_objective_score, latest_subjective_score = await _recompute_submission_scores(
            db,
            exam_id=exam_id,
            student_id=student_id,
        )
        exam_student.objective_score = latest_objective_score
        exam_student.subjective_score = latest_subjective_score
        exam_student.score = round(latest_objective_score + latest_subjective_score, 2)
        await refresh_student_question_progress_for_regrade(
            db,
            student_id=student_id,
            question_id=question_id,
        )

    await db.commit()

    return SingleStudentFillInRegradeResult(
        exam_id=exam_id,
        question_id=question_id,
        student_id=student_id,
        total_score=question_score,
        score_awarded=score_awarded,
        is_correct=is_correct,
        feedback=feedback,
    )

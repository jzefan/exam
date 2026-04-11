import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import async_session, get_db
from app.exams.models import (
    AppealStatus,
    Exam,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamAppeal,
    StudentNotification,
    StudentQuestionProgress,
)
from app.exams.student_schemas import (
    AppealCreateRequest,
    AppealResponse,
    SaveAnswersRequest,
    SubmitExamRequest,
    SubmitExamResponse,
    StudentNotificationResponse,
    StudentExamResultQuestionResponse,
    StudentExamResultResponse,
    StudentExamStartResponse,
    StudentQuestionPayload,
    SwitchReportRequest,
    WrongAnswerDetailResponse,
    WrongAnswerListItem,
)
from app.grading.models import RoleBinding
from app.grading.service import apply_grading_task_result_to_exam_submission, create_grading_task, run_grading_task_with_role_binding
from app.questions.models import Question, QuestionType

router = APIRouter()
wrong_answers_router = APIRouter()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def _strip_html(value: str | None) -> str:
    if not value:
        return ""
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", without_tags).strip()


def _extract_answer_text(answer_content: dict[str, Any]) -> str:
    code = answer_content.get("code")
    if isinstance(code, str) and code.strip():
        language = answer_content.get("language")
        custom_input = answer_content.get("custom_input")
        parts = [code.strip()]
        if isinstance(language, str) and language.strip():
            parts.append(language.strip())
        if isinstance(custom_input, str) and custom_input.strip():
            parts.append(custom_input.strip())
        return " ".join(parts)

    html = answer_content.get("html")
    if isinstance(html, str) and html.strip():
        return _strip_html(html)

    blanks = answer_content.get("blanks")
    if isinstance(blanks, list):
        return " ".join(str(item).strip() for item in blanks if str(item).strip())

    selected = answer_content.get("selected")
    if isinstance(selected, list):
        return " ".join(str(item) for item in selected)

    value = answer_content.get("value")
    if isinstance(value, bool):
        return "true" if value else "false"

    return ""


def _is_subjective_question_type(question_type: str) -> bool:
    return question_type in {
        QuestionType.SHORT_ANSWER.value,
        QuestionType.ESSAY.value,
        QuestionType.CODE.value,
    }


async def _get_active_role_binding_version(db: AsyncSession) -> int:
    binding = (
        await db.execute(
            select(RoleBinding).where(RoleBinding.is_active.is_(True)).order_by(RoleBinding.version.desc())
        )
    ).scalar_one_or_none()
    if binding is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No active grading role binding")
    return binding.version


def _build_grading_task_payload(
    *,
    exam: Exam,
    question: Question,
    question_score: float,
    answer_content: dict[str, Any],
    role_binding_version: int,
    source_business_id: str,
) -> dict[str, Any]:
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    question_content = question.content.get("text") if isinstance(question.content, dict) else None
    raw_question_content = _strip_html(question_content if isinstance(question_content, str) else question.title)
    standard_answer = question.answer if isinstance(question.answer, dict) else {}
    language = answer_content.get("language") if isinstance(answer_content.get("language"), str) else None

    return {
        "source_type": "exam_submission",
        "source_business_id": source_business_id,
        "question_type": question_type,
        "question_content": raw_question_content or question.title,
        "subject": exam.title,
        "language": "zh-CN",
        "max_score": int(round(question_score)),
        "knowledge_tags": [],
        "fatal_rule_enabled": True,
        "student_answer_raw": _extract_answer_text(answer_content),
        "student_answer_structured": answer_content,
        "attachment_refs": [],
        "standard_answers": [standard_answer],
        "rubric_definition": {},
        "scoring_points": [],
        "dimension_weights": {},
        "deduction_rules": [],
        "fatal_error_rules": [],
        "role_binding_version": role_binding_version,
        "programming_language": language,
        "runtime_logs": [],
    }


async def _run_subjective_grading_tasks(task_ids: list[str]) -> None:
    async with async_session() as db:
        for task_id in task_ids:
            try:
                await run_grading_task_with_role_binding(db, task_id)
                await apply_grading_task_result_to_exam_submission(db, task_id)
                await db.commit()
            except Exception:
                await db.rollback()


async def _schedule_subjective_grading_tasks(background_tasks: BackgroundTasks, task_ids: list[str]) -> None:
    if task_ids:
        background_tasks.add_task(_run_subjective_grading_tasks, task_ids)


def _build_objective_feedback(
    *,
    correct: bool,
    max_score: float,
    actual_score: float,
    standard_answer: str,
    student_answer: str,
) -> dict[str, Any]:
    return {
        "dimensions": [
            {
                "name": "答案准确性",
                "score": actual_score,
                "max_score": max_score,
                "comment": "答案正确。" if correct else f"标准答案为 {standard_answer or '未设置'}。",
            }
        ],
        "strengths": ["答案与标准一致。"] if correct else [],
        "deductions": [] if correct else [f"你的答案为 {student_answer or '未作答'}，与标准答案不一致。"],
        "suggestions": [] if correct else ["回看对应知识点并复盘判断依据。"],
    }


def _build_subjective_feedback(
    *,
    max_score: float,
    actual_score: float,
    matched_points: list[str],
    missing_points: list[str],
) -> dict[str, Any]:
    structure_score = round(max_score * (0.3 if matched_points else 0.1), 2)
    coverage_score = round(max(actual_score - structure_score, 0), 2)
    return {
        "dimensions": [
            {
                "name": "要点覆盖",
                "score": coverage_score,
                "max_score": round(max_score * 0.7, 2),
                "comment": f"命中 {len(matched_points)} 个关键要点。",
            },
            {
                "name": "表达完整度",
                "score": min(structure_score, actual_score),
                "max_score": round(max_score * 0.3, 2),
                "comment": "答案结构较完整。" if matched_points else "答案内容较少，建议补充核心论述。",
            },
        ],
        "strengths": [f"涉及要点：{point}" for point in matched_points[:3]],
        "deductions": [f"缺少要点：{point}" for point in missing_points[:3]],
        "suggestions": (
            ["继续补充结论、依据或示例，让答案更完整。"]
            if missing_points
            else ["要点覆盖较好，可继续优化表述精炼度。"]
        ),
    }


def _build_code_feedback(
    *,
    max_score: float,
    actual_score: float,
    matched_points: list[str],
    missing_points: list[str],
    language: str | None,
    function_name: str | None,
) -> dict[str, Any]:
    syntax_score = round(min(actual_score, max_score * 0.4), 2)
    logic_score = round(max(actual_score - syntax_score, 0), 2)
    return {
        "dimensions": [
            {
                "name": "实现完整度",
                "score": logic_score,
                "max_score": round(max_score * 0.6, 2),
                "comment": f"命中 {len(matched_points)} 个关键实现点。",
            },
            {
                "name": "代码结构",
                "score": syntax_score,
                "max_score": round(max_score * 0.4, 2),
                "comment": (
                    f"已使用 {language} 语言作答。"
                    if language
                    else "已保存代码作答。"
                ),
            },
        ],
        "strengths": [
            *( [f"函数命名围绕 {function_name} 展开。"] if function_name else [] ),
            *[f"已覆盖：{point}" for point in matched_points[:3]],
        ],
        "deductions": [f"仍缺少：{point}" for point in missing_points[:3]],
        "suggestions": (
            ["继续补全边界处理、返回值和示例测试。"] if missing_points else ["核心逻辑较完整，可继续优化时间复杂度与可读性。"]
        ),
    }


def _grade_question(question: Question, answer_content: dict[str, Any], score: float) -> tuple[float, bool, dict[str, Any]]:
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    standard_answer = question.answer or {}

    if question_type == QuestionType.CHOICE.value:
        expected = standard_answer.get("correct", [])
        expected_list = expected if isinstance(expected, list) else [expected]
        selected = answer_content.get("selected", [])
        selected_list = selected if isinstance(selected, list) else [selected]
        correct = sorted(str(item) for item in expected_list) == sorted(str(item) for item in selected_list)
        student_text = "、".join(str(item) for item in selected_list if item)
        expected_text = "、".join(str(item) for item in expected_list if item)
        return (
            score if correct else 0.0,
            correct,
            _build_objective_feedback(
                correct=correct,
                max_score=score,
                actual_score=score if correct else 0.0,
                standard_answer=expected_text,
                student_answer=student_text,
            ),
        )

    if question_type == QuestionType.TRUE_FALSE.value:
        expected = bool(standard_answer.get("correct"))
        student = answer_content.get("value")
        correct = student is expected
        return (
            score if correct else 0.0,
            correct,
            _build_objective_feedback(
                correct=correct,
                max_score=score,
                actual_score=score if correct else 0.0,
                standard_answer="正确" if expected else "错误",
                student_answer="正确" if student is True else "错误" if student is False else "",
            ),
        )

    if question_type == QuestionType.FILL_IN.value:
        expected = standard_answer.get("blanks", [])
        expected_list = [str(item) for item in expected] if isinstance(expected, list) else [str(expected)]
        provided = answer_content.get("blanks", [])
        provided_list = [str(item) for item in provided] if isinstance(provided, list) else [str(provided)]
        total = max(len(expected_list), 1)
        matched = 0
        missing_points: list[str] = []
        for index, expected_item in enumerate(expected_list):
            actual = provided_list[index] if index < len(provided_list) else ""
            if _normalize_text(actual) == _normalize_text(expected_item):
                matched += 1
            else:
                missing_points.append(f"第 {index + 1} 空应为 {expected_item}")
        actual_score = round(score * matched / total, 2)
        correct = matched == total
        return (
            actual_score,
            correct,
            {
                "dimensions": [
                    {
                        "name": "填空准确率",
                        "score": actual_score,
                        "max_score": score,
                        "comment": f"共命中 {matched}/{total} 个空。",
                    }
                ],
                "strengths": [f"命中 {matched} 个空。"] if matched else [],
                "deductions": missing_points,
                "suggestions": ["复查拼写、术语与顺序。"] if not correct else [],
            },
        )

    if question_type == QuestionType.CODE.value:
        code = answer_content.get("code")
        code_text = code.strip() if isinstance(code, str) else ""
        if not code_text:
            return 0.0, False, {
                "dimensions": [
                    {
                        "name": "代码提交",
                        "score": 0.0,
                        "max_score": score,
                        "comment": "尚未提交代码。",
                    }
                ],
                "strengths": [],
                "deductions": ["未检测到代码内容。"],
                "suggestions": ["请先补充代码实现，再提交考试。"],
            }

        required_patterns = standard_answer.get("required_patterns", [])
        pattern_list = [str(item) for item in required_patterns if str(item).strip()] if isinstance(required_patterns, list) else []
        if not pattern_list:
            pattern_list = [str(item) for item in standard_answer.get("points", []) if str(item).strip()] if isinstance(standard_answer.get("points", []), list) else []

        normalized_code = _normalize_text(code_text)
        matched_points = [point for point in pattern_list if _normalize_text(point) in normalized_code]
        missing_points = [point for point in pattern_list if point not in matched_points]
        coverage = len(matched_points) / len(pattern_list) if pattern_list else 0.5
        actual_score = round(score * coverage, 2)
        language = answer_content.get("language")
        function_name = None
        if isinstance(question.content, dict):
            raw_name = question.content.get("function_name")
            function_name = str(raw_name) if raw_name else None
        correct = coverage >= 0.6
        return (
            actual_score,
            correct,
            _build_code_feedback(
                max_score=score,
                actual_score=actual_score,
                matched_points=matched_points,
                missing_points=missing_points,
                language=str(language) if isinstance(language, str) else None,
                function_name=function_name,
            ),
        )

    points = standard_answer.get("points", [])
    point_list = [str(item) for item in points if str(item).strip()] if isinstance(points, list) else []
    answer_text = _normalize_text(_extract_answer_text(answer_content))
    if not point_list:
        feedback = _build_subjective_feedback(
            max_score=score,
            actual_score=0.0,
            matched_points=[],
            missing_points=["暂未配置评分要点"],
        )
        return 0.0, False, feedback

    matched_points = [point for point in point_list if _normalize_text(point) in answer_text]
    missing_points = [point for point in point_list if point not in matched_points]
    coverage = len(matched_points) / len(point_list)
    actual_score = round(score * coverage, 2)
    correct = coverage >= 0.6
    feedback = _build_subjective_feedback(
        max_score=score,
        actual_score=actual_score,
        matched_points=matched_points,
        missing_points=missing_points,
    )
    return actual_score, correct, feedback


async def _get_exam_for_student(
    db: AsyncSession,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
) -> tuple[Exam, ExamStudent]:
    result = await db.execute(
        select(Exam)
        .join(ExamStudent, ExamStudent.exam_id == Exam.id)
        .where(
            Exam.id == exam_id,
            Exam.deleted_at.is_(None),
            ExamStudent.student_id == student_id,
        )
    )
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    exam_student = next((item for item in exam.exam_students if item.student_id == student_id), None)
    if exam_student is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Exam not assigned")

    return exam, exam_student


def _ensure_exam_open(exam: Exam) -> None:
    now = _utcnow()
    start_time = _as_utc(exam.start_time)
    end_time = _as_utc(exam.end_time)
    if exam.status == "closed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam is closed")
    if start_time and start_time > now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam has not started")
    if end_time and end_time < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam has ended")


@router.post("/exams/{exam_id}/start", response_model=StudentExamStartResponse)
async def start_exam(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> StudentExamStartResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    _ensure_exam_open(exam)
    if exam_student.submitted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")

    if exam_student.started_at is None:
        exam_student.started_at = _utcnow()
        await db.commit()
        await db.refresh(exam)
        exam_student = next(item for item in exam.exam_students if item.student_id == user.id)

    questions = [
        StudentQuestionPayload(
            question_id=eq.question_id,
            order=eq.order,
            score=eq.score_override if eq.score_override is not None else eq.question.score,
            type=eq.question.type.value,
            title=eq.question.title,
            content=eq.question.content,
            options=eq.question.options,
        )
        for eq in sorted(exam.exam_questions, key=lambda item: item.order)
    ]

    return StudentExamStartResponse(
        exam_id=exam.id,
        title=exam.title,
        duration_minutes=exam.duration_minutes,
        max_switch_count=exam.max_switch_count,
        started_at=exam_student.started_at,
        end_time=exam.end_time,
        questions=questions,
        saved_answers={str(key): value for key, value in (exam_student.saved_answers or {}).items()},
        switch_count=exam_student.switch_count,
    )


@router.post("/exams/{exam_id}/answers")
async def save_answers(
    exam_id: uuid.UUID,
    payload: SaveAnswersRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, Any]:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    _ensure_exam_open(exam)
    if exam_student.submitted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")

    saved_answers = dict(exam_student.saved_answers or {})
    for item in payload.answers:
        saved_answers[str(item.question_id)] = item.answer_content
    exam_student.saved_answers = saved_answers
    await db.commit()
    return {"saved": len(payload.answers)}


@router.post("/exams/{exam_id}/switch")
async def report_switch(
    exam_id: uuid.UUID,
    payload: SwitchReportRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, Any]:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    exam_student.switch_count = payload.switch_count
    await db.commit()
    return {
        "switch_count": exam_student.switch_count,
        "max_switch_count": exam.max_switch_count,
        "force_submit": exam.max_switch_count > 0 and exam_student.switch_count >= exam.max_switch_count,
    }


@router.post("/exams/{exam_id}/submit", response_model=SubmitExamResponse)
async def submit_exam(
    exam_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    payload: SubmitExamRequest | None = None,
) -> SubmitExamResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    if exam_student.submitted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")

    answers_map = dict(exam_student.saved_answers or {})
    for item in payload.answers if payload else []:
        answers_map[str(item.question_id)] = item.answer_content
    exam_student.saved_answers = answers_map

    await db.execute(
        delete(StudentExamAnswer).where(
            StudentExamAnswer.exam_id == exam.id,
            StudentExamAnswer.student_id == user.id,
        )
    )

    objective_score = 0.0
    subjective_score = 0.0
    now = _utcnow()
    subjective_task_ids: list[str] = []
    role_binding_version: int | None = None
    for exam_question in sorted(exam.exam_questions, key=lambda item: item.order):
        question = exam_question.question
        answer_content = answers_map.get(str(question.id), {})
        question_score = exam_question.score_override if exam_question.score_override is not None else question.score
        question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)

        if _is_subjective_question_type(question_type):
            if role_binding_version is None:
                role_binding_version = await _get_active_role_binding_version(db)
            score_awarded = 0.0
            is_correct = False
            feedback = {}
        else:
            score_awarded, is_correct, feedback = _grade_question(question, answer_content, question_score)
            objective_score += score_awarded

        db.add(
            StudentExamAnswer(
                exam_id=exam.id,
                student_id=user.id,
                question_id=question.id,
                answer_content=answer_content,
                score_awarded=score_awarded,
                is_correct=is_correct,
                feedback=feedback,
            )
        )

        if _is_subjective_question_type(question_type):
            task = await create_grading_task(
                db,
                _build_grading_task_payload(
                    exam=exam,
                    question=question,
                    question_score=question_score,
                    answer_content=answer_content,
                    role_binding_version=role_binding_version or 1,
                    source_business_id=f"{exam.id}:{question.id}:{user.id}",
                ),
            )
            subjective_task_ids.append(str(task.id))

        progress_result = await db.execute(
            select(StudentQuestionProgress).where(
                StudentQuestionProgress.student_id == user.id,
                StudentQuestionProgress.question_id == question.id,
            )
        )
        progress = progress_result.scalar_one_or_none()
        if progress is None:
            progress = StudentQuestionProgress(
                student_id=user.id,
                question_id=question.id,
                wrong_count=0,
                mastered=False,
            )
            db.add(progress)

        if not is_correct:
            progress.last_exam_id = exam.id
            progress.wrong_count += 1
            progress.last_wrong_at = now
            progress.mastered = False
            progress.mastered_at = None

    exam_student.submitted_at = now
    exam_student.objective_score = round(objective_score, 2)
    exam_student.subjective_score = round(subjective_score, 2)
    exam_student.score = round(objective_score + subjective_score, 2)
    if subjective_task_ids:
        exam_student.grading_status = GradingStatus.PENDING_AI.value
        exam_student.ai_scored_at = None
        exam_student.reviewed_at = None
        exam_student.graded_at = None
    else:
        exam_student.grading_status = GradingStatus.REVIEWED.value
        exam_student.ai_scored_at = now
        exam_student.reviewed_at = now
        exam_student.graded_at = now
    await db.commit()
    await _schedule_subjective_grading_tasks(background_tasks, subjective_task_ids)

    return SubmitExamResponse(
        submitted=True,
        score=exam_student.score,
        grading_status=exam_student.grading_status,
    )


@router.get("/exams/{exam_id}/result", response_model=StudentExamResultResponse)
async def get_exam_result(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> StudentExamResultResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    if exam_student.submitted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam not submitted")
    if exam_student.grading_status == GradingStatus.PENDING_AI.value:
        return StudentExamResultResponse(
            exam_id=exam.id,
            title=exam.title,
            submitted_at=exam_student.submitted_at,
            total_score=exam.total_score,
            score=exam_student.score,
            grading_status=exam_student.grading_status,
            can_view=False,
            blocked_reason="主观题正在进行 AI 评分，结果稍后可查看。",
        )
    if not exam.show_result:
        return StudentExamResultResponse(
            exam_id=exam.id,
            title=exam.title,
            submitted_at=exam_student.submitted_at,
            total_score=exam.total_score,
            score=exam_student.score,
            grading_status=exam_student.grading_status,
            can_view=False,
            blocked_reason="教师暂未开放查看结果权限",
        )

    answers_result = await db.execute(
        select(StudentExamAnswer).where(
            StudentExamAnswer.exam_id == exam.id,
            StudentExamAnswer.student_id == user.id,
        )
    )
    answers = {
        item.question_id: item for item in answers_result.scalars().all()
    }
    appeals_result = await db.execute(
        select(StudentExamAppeal).where(
            StudentExamAppeal.exam_id == exam.id,
            StudentExamAppeal.student_id == user.id,
        )
    )
    appeals = {
        item.question_id: item for item in appeals_result.scalars().all()
    }

    question_items: list[StudentExamResultQuestionResponse] = []
    for exam_question in sorted(exam.exam_questions, key=lambda item: item.order):
        question = exam_question.question
        answer = answers.get(question.id)
        appeal = appeals.get(question.id)
        question_items.append(
            StudentExamResultQuestionResponse(
                question_id=question.id,
                order=exam_question.order,
                type=question.type.value,
                title=question.title,
                content=question.content,
                options=question.options,
                total_score=exam_question.score_override if exam_question.score_override is not None else question.score,
                score_awarded=answer.score_awarded if answer else 0.0,
                is_correct=answer.is_correct if answer else False,
                answer_content=answer.answer_content if answer else {},
                standard_answer=question.answer or {},
                analysis=question.analysis,
                feedback=answer.feedback if answer else {},
                appeal_status=appeal.status if appeal else None,
                appeal_reason=appeal.reason if appeal else None,
                appeal_reply=appeal.teacher_reply if appeal else None,
            )
        )

    return StudentExamResultResponse(
        exam_id=exam.id,
        title=exam.title,
        submitted_at=exam_student.submitted_at,
        total_score=exam.total_score,
        score=exam_student.score,
        grading_status=exam_student.grading_status,
        can_view=True,
        questions=question_items,
    )


@router.get("/notifications/unread", response_model=list[StudentNotificationResponse])
async def list_unread_notifications(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[StudentNotificationResponse]:
    notifications = (
        await db.execute(
            select(StudentNotification)
            .where(
                StudentNotification.student_id == user.id,
                StudentNotification.read_at.is_(None),
            )
            .order_by(StudentNotification.created_at.desc())
        )
    ).scalars().all()
    return [StudentNotificationResponse.model_validate(notification) for notification in notifications]


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, Any]:
    notification = (
        await db.execute(
            select(StudentNotification).where(
                StudentNotification.id == notification_id,
                StudentNotification.student_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.read_at = _utcnow()
    await db.commit()
    return {"read": True}


@router.post("/exams/{exam_id}/appeals", response_model=AppealResponse, status_code=status.HTTP_201_CREATED)
async def create_appeal(
    exam_id: uuid.UUID,
    payload: AppealCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> AppealResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    if exam_student.submitted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam not submitted")

    existing_result = await db.execute(
        select(StudentExamAppeal).where(
            StudentExamAppeal.exam_id == exam.id,
            StudentExamAppeal.student_id == user.id,
            StudentExamAppeal.question_id == payload.question_id,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Appeal already submitted")

    appeal = StudentExamAppeal(
        exam_id=exam.id,
        student_id=user.id,
        question_id=payload.question_id,
        reason=payload.reason,
        status=AppealStatus.PENDING.value,
    )
    db.add(appeal)
    await db.commit()
    await db.refresh(appeal)
    return AppealResponse.model_validate(appeal)


@wrong_answers_router.get("", response_model=list[WrongAnswerListItem])
async def list_wrong_answers(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    question_type: Annotated[str | None, Query(alias="question_type")] = None,
    tag: str | None = None,
) -> list[WrongAnswerListItem]:
    result = await db.execute(
        select(StudentQuestionProgress, Question, Exam)
        .join(Question, Question.id == StudentQuestionProgress.question_id)
        .outerjoin(Exam, Exam.id == StudentQuestionProgress.last_exam_id)
        .where(
            StudentQuestionProgress.student_id == user.id,
            StudentQuestionProgress.wrong_count > 0,
            StudentQuestionProgress.mastered.is_(False),
        )
        .order_by(StudentQuestionProgress.last_wrong_at.desc())
    )

    items: list[WrongAnswerListItem] = []
    for progress, question, exam in result.all():
        if question_type and question.type.value != question_type:
            continue
        tag_names = [item.name for item in question.tags]
        if tag and tag not in tag_names:
            continue
        items.append(
            WrongAnswerListItem(
                id=progress.id,
                question_id=question.id,
                question_title=question.title,
                question_type=question.type.value,
                exam_title=exam.title if exam else "历史考试",
                wrong_count=progress.wrong_count,
                last_wrong_at=progress.last_wrong_at or progress.updated_at,
                tags=tag_names,
                mastered=progress.mastered,
            )
        )
    return items


@wrong_answers_router.get("/{progress_id}", response_model=WrongAnswerDetailResponse)
async def get_wrong_answer_detail(
    progress_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> WrongAnswerDetailResponse:
    result = await db.execute(
        select(StudentQuestionProgress, Question, Exam)
        .join(Question, Question.id == StudentQuestionProgress.question_id)
        .outerjoin(Exam, Exam.id == StudentQuestionProgress.last_exam_id)
        .where(
            StudentQuestionProgress.id == progress_id,
            StudentQuestionProgress.student_id == user.id,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wrong answer not found")

    progress, question, exam = row
    latest_answer_result = await db.execute(
        select(StudentExamAnswer).where(
            StudentExamAnswer.student_id == user.id,
            StudentExamAnswer.question_id == question.id,
        ).order_by(StudentExamAnswer.created_at.desc())
    )
    latest_answer = latest_answer_result.scalars().first()

    return WrongAnswerDetailResponse(
        id=progress.id,
        question_id=question.id,
        question_title=question.title,
        question_type=question.type.value,
        exam_title=exam.title if exam else "历史考试",
        wrong_count=progress.wrong_count,
        last_wrong_at=progress.last_wrong_at or progress.updated_at,
        tags=[item.name for item in question.tags],
        mastered=progress.mastered,
        question_content=question.content,
        standard_answer=question.answer,
        analysis=question.analysis,
        student_answer=latest_answer.answer_content if latest_answer else {},
        feedback=latest_answer.feedback if latest_answer else {},
    )


@wrong_answers_router.post("/{progress_id}/mastered")
async def mark_wrong_answer_mastered(
    progress_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, Any]:
    result = await db.execute(
        select(StudentQuestionProgress).where(
            StudentQuestionProgress.id == progress_id,
            StudentQuestionProgress.student_id == user.id,
        )
    )
    progress = result.scalar_one_or_none()
    if progress is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wrong answer not found")

    progress.mastered = True
    progress.mastered_at = _utcnow()
    await db.commit()
    return {"mastered": True}

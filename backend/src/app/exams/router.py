"""Exam API router."""

import uuid
from typing import Annotated, Literal
from urllib.parse import quote

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.config import settings
from app.auth.dependencies import CurrentUser, user_has_role
from app.exams.paper_export import build_exam_paper, render_docx, render_pdf
from app.common.resource_access import can_write_owned_resource
from app.common.pagination import (
    PaginationParams,
    apply_filters,
    apply_pagination,
    get_total_count,
    parse_filters,
    parse_pagination,
)
from app.database import get_db
from app.exams.models import (
    Exam,
    ExamQuestion,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamAppeal,
    StudentExamSubmission,
    StudentExamSubmissionAnswer,
)
from app.teacher_courses.models import ExamSemesterAssignment
from app.exams.schemas import (
    AnalysisOverall,
    AnswerRecord,
    ExamAnalysisResponse,
    ExamCreate,
    ExamDetailResponse,
    ExamMockGenerateRequest,
    ExamMockGenerateResponse,
    ExamQuestionItem,
    ExamQuestionResponse,
    ExamResponse,
    ExamStudentResponse,
    ExamUpdate,
    KnowledgePointStatRow,
    QuestionStatRow,
    ScoreBucket,
    StudentResultRow,
)
from app.exams.student_schemas import (
    ManualQuestionScoreRequest,
    ManualQuestionScoreResponse,
    SingleQuestionAIGradeResponse,
    StudentExamResultQuestionResponse,
    StudentExamResultResponse,
)
from app.exams.student_router import _build_student_question_content
from app.exams.time_utils import (
    coerce_exam_input_datetime_to_utc,
    coerce_persisted_exam_datetime_to_utc,
)
from app.papers.service import generate_question_items_from_source_items
from app.questions.schemas import QuestionResponse
from app.questions.service import cleanup_soft_deleted_question_if_orphaned
from app.questions.models import Question, question_knowledge_points
from app.learning.models import KnowledgePoint

router = APIRouter()

_OBJECTIVE_QUESTION_TYPES = {"choice", "true_false", "fill_in"}


async def _exam_has_student_history(db: AsyncSession, exam_id: uuid.UUID) -> bool:
    exam_student_history = await db.scalar(
        select(ExamStudent.exam_id)
        .where(
            ExamStudent.exam_id == exam_id,
            (ExamStudent.started_at.is_not(None) | ExamStudent.submitted_at.is_not(None)),
        )
        .limit(1)
    )
    if exam_student_history is not None:
        return True

    answer_history = await db.scalar(
        select(StudentExamAnswer.exam_id).where(StudentExamAnswer.exam_id == exam_id).limit(1)
    )
    if answer_history is not None:
        return True

    submission_history = await db.scalar(
        select(StudentExamSubmission.exam_id).where(StudentExamSubmission.exam_id == exam_id).limit(1)
    )
    if submission_history is not None:
        return True

    return False


async def _is_exam_admin(db: AsyncSession, user_id: uuid.UUID) -> bool:
    return await user_has_role(
        db,
        user_id,
        "platform_admin",
        "school_admin",
        "admin",
        "enterprise_admin",
    )


async def _is_student_user(db: AsyncSession, user_id: uuid.UUID) -> bool:
    return await user_has_role(db, user_id, "student", "assessee")


async def _exam_query_for_user(db: AsyncSession, user: CurrentUser):
    query = select(Exam).where(Exam.deleted_at.is_(None))
    if await _is_student_user(db, user.id):
        return (
            query.join(ExamStudent, ExamStudent.exam_id == Exam.id)
            .where(
                ExamStudent.student_id == user.id,
                Exam.status != "draft",
            )
            .distinct()
        )
    if not await _is_exam_admin(db, user.id):
        query = query.where(Exam.owner_id == user.id)
    return query


async def _get_visible_exam_or_404(
    db: AsyncSession,
    exam_id: uuid.UUID,
    user: CurrentUser,
) -> Exam:
    result = await db.execute((await _exam_query_for_user(db, user)).where(Exam.id == exam_id))
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    return exam


async def _get_writable_exam_or_404(
    db: AsyncSession,
    exam_id: uuid.UUID,
    user: CurrentUser,
) -> Exam:
    exam = await _get_visible_exam_or_404(db, exam_id, user)
    is_admin = await _is_exam_admin(db, user.id)
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=exam.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this exam")
    return exam


def _build_exam_response(exam: Exam, student_id: uuid.UUID | None = None) -> ExamResponse:
    submitted = sum(1 for s in exam.exam_students if s.submitted_at is not None)
    has_student_history = any(s.started_at is not None or s.submitted_at is not None for s in exam.exam_students)
    knowledge_points_by_id: dict[uuid.UUID, object] = {}
    for exam_question in exam.exam_questions:
        question = exam_question.question
        if question is None:
            continue
        for knowledge_point in question.knowledge_points or []:
            knowledge_points_by_id.setdefault(knowledge_point.id, knowledge_point)
    exam_student = (
        next((s for s in exam.exam_students if s.student_id == student_id), None) if student_id is not None else None
    )
    return ExamResponse(
        id=exam.id,
        category=exam.category,
        title=exam.title,
        description=exam.description,
        start_time=coerce_persisted_exam_datetime_to_utc(exam.start_time),
        end_time=coerce_persisted_exam_datetime_to_utc(exam.end_time),
        duration_minutes=exam.duration_minutes,
        total_score=exam.total_score,
        status=exam.status if isinstance(exam.status, str) else exam.status.value,
        position_id=exam.position_id,
        position_name=exam.position.name if exam.position else None,
        max_switch_count=exam.max_switch_count,
        allow_retake=exam.allow_retake,
        show_result=exam.show_result,
        notes_template=exam.notes_template,
        question_mode=exam.question_mode,
        total_questions=len(exam.exam_questions),
        total_students=len(exam.exam_students),
        submitted_count=submitted,
        has_student_history=has_student_history,
        knowledge_points=list(knowledge_points_by_id.values()),
        participated=(
            exam_student.started_at is not None or exam_student.submitted_at is not None
            if exam_student is not None
            else None
        ),
        started_at=exam_student.started_at if exam_student is not None else None,
        submitted_at=exam_student.submitted_at if exam_student is not None else None,
        grading_status=exam_student.grading_status if exam_student is not None else None,
        objective_score=exam_student.objective_score if exam_student is not None else None,
        subjective_score=exam_student.subjective_score if exam_student is not None else None,
        score=exam_student.score if exam_student is not None else None,
        ai_scored_at=exam_student.ai_scored_at if exam_student is not None else None,
        reviewed_at=exam_student.reviewed_at if exam_student is not None else None,
        owner_id=exam.owner_id,
        created_by=exam.created_by,
        created_by_name=exam.creator.full_name if exam.creator else "",
        created_at=exam.created_at,
        updated_at=exam.updated_at,
    )


def _build_detail_response(exam: Exam) -> ExamDetailResponse:
    base = _build_exam_response(exam)
    questions = [
        ExamQuestionResponse(
            question_id=eq.question_id,
            order=eq.order,
            score_override=eq.score_override,
            source_exam_id=eq.source_exam_id,
            source_question_id=eq.source_question_id,
            question_title=eq.question.title if eq.question else None,
            question_type=eq.question.type.value if eq.question else None,
            question_score=eq.question.score if eq.question else None,
            question_difficulty=eq.question.difficulty if eq.question else None,
        )
        for eq in sorted(exam.exam_questions, key=lambda x: x.order)
    ]
    students = [
        ExamStudentResponse(
            student_id=es.student_id,
            full_name=es.student.full_name if es.student else None,
            username=es.student.username if es.student else None,
            phone=es.student.phone if es.student else None,
            user_type=es.student.user_type if es.student else None,
            started_at=es.started_at,
            submitted_at=es.submitted_at,
            grading_status=es.grading_status,
        )
        for es in exam.exam_students
    ]
    return ExamDetailResponse(
        **base.model_dump(),
        questions=questions,
        students=students,
    )


async def _sync_questions(db: AsyncSession, exam_id: uuid.UUID, question_items: list[ExamQuestionItem]) -> None:
    existing_rows = (
        await db.execute(select(ExamQuestion).where(ExamQuestion.exam_id == exam_id))
    ).scalars().all()
    existing_by_question_id = {row.question_id: row for row in existing_rows}
    await db.execute(delete(ExamQuestion).where(ExamQuestion.exam_id == exam_id))
    for i, item in enumerate(question_items):
        existing = existing_by_question_id.get(item.question_id)
        source_exam_id = item.source_exam_id
        source_question_id = item.source_question_id
        if source_exam_id is None and source_question_id is None and existing is not None:
            source_exam_id = existing.source_exam_id
            source_question_id = existing.source_question_id
        db.add(
            ExamQuestion(
                exam_id=exam_id,
                question_id=item.question_id,
                order=item.order if item.order is not None else i,
                score_override=item.score_override,
                source_exam_id=source_exam_id,
                source_question_id=source_question_id,
            )
        )


async def _unique_exam_title_for_owner(
    db: AsyncSession,
    *,
    owner_id: uuid.UUID,
    category: str,
    base_title: str,
) -> str:
    normalized = base_title.strip() or "模拟试卷"
    existing_titles = set(
        await db.scalars(
            select(Exam.title).where(
                Exam.owner_id == owner_id,
                Exam.category == category,
                Exam.deleted_at.is_(None),
                Exam.title.like(f"{normalized}%"),
            )
        )
    )
    if normalized not in existing_titles:
        return normalized

    index = 2
    while True:
        candidate = f"{normalized}-{index}"
        if candidate not in existing_titles:
            return candidate
        index += 1


async def _sync_students(db: AsyncSession, exam_id: uuid.UUID, student_ids: list[uuid.UUID]) -> None:
    existing_rows = (await db.execute(select(ExamStudent).where(ExamStudent.exam_id == exam_id))).scalars().all()
    existing_by_student = {row.student_id: row for row in existing_rows}
    requested_ids = set(student_ids)

    for sid in requested_ids:
        if sid not in existing_by_student:
            db.add(ExamStudent(exam_id=exam_id, student_id=sid))

    for row in existing_rows:
        if row.student_id in requested_ids:
            continue

        has_progress = any(
            [
                row.started_at is not None,
                row.submitted_at is not None,
                bool(row.saved_answers),
                row.switch_count > 0,
                row.score is not None,
                row.graded_at is not None,
            ]
        )
        if not has_progress:
            await db.delete(row)


# ── CRUD ──


@router.get("", response_model=list[ExamResponse])
async def list_exams(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    pagination: Annotated[PaginationParams, Depends(parse_pagination)],
    user: CurrentUser,
) -> list[ExamResponse]:
    base_query = await _exam_query_for_user(db, user)

    filters = parse_filters(request, Exam)
    filtered_query = apply_filters(base_query, filters, Exam)

    root_kp_id_str = request.query_params.get("root_knowledge_point_id")
    if root_kp_id_str:
        try:
            root_kp_id = uuid.UUID(root_kp_id_str)
            kp_anchor = (
                select(KnowledgePoint.id).where(KnowledgePoint.id == root_kp_id).cte(name="kp_subtree", recursive=True)
            )
            kp_subtree = kp_anchor.union_all(
                select(KnowledgePoint.id).where(KnowledgePoint.parent_id == kp_anchor.c.id)
            )
            matching_exam_ids = (
                select(ExamQuestion.exam_id)
                .join(question_knowledge_points, ExamQuestion.question_id == question_knowledge_points.c.question_id)
                .where(question_knowledge_points.c.knowledge_point_id.in_(select(kp_subtree.c.id)))
                .distinct()
            )
            filtered_query = filtered_query.where(Exam.id.in_(matching_exam_ids))
        except ValueError:
            pass

    total = await get_total_count(db, filtered_query)
    response.headers["X-Total-Count"] = str(total)

    paginated_query = apply_pagination(filtered_query, pagination, Exam)
    result = await db.execute(paginated_query)
    exams = result.scalars().unique().all()

    student_id = user.id if await _is_student_user(db, user.id) else None
    return [_build_exam_response(e, student_id=student_id) for e in exams]


@router.get("/{exam_id}", response_model=ExamDetailResponse)
async def get_exam(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ExamDetailResponse:
    exam = await _get_visible_exam_or_404(db, exam_id, user)
    return _build_detail_response(exam)


_EXPORT_MEDIA_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


@router.get("/{exam_id}/export")
async def export_exam_paper(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    export_format: Annotated[Literal["docx", "pdf"], Query(alias="format")] = "docx",
    answers: bool = False,
) -> Response:
    """Export an exam as a standard-format paper (docx/pdf, with/without answers)."""
    exam = await _get_visible_exam_or_404(db, exam_id, user)
    paper = await build_exam_paper(
        db,
        exam,
        with_answers=answers,
        school_name=settings.exam_export_school_name,
        exam_form=settings.exam_export_form,
    )
    content = render_docx(paper) if export_format == "docx" else render_pdf(paper)

    variant = "（含答案）" if answers else "（空白）"
    name_parts = [p for p in (paper.course_name, paper.class_label, paper.exam_title) if p]
    base = "-".join(name_parts) or "试卷"
    filename = f"{base}{variant}.{export_format}"
    disposition = f'attachment; filename="exam-{exam_id}.{export_format}"; ' f"filename*=UTF-8''{quote(filename)}"
    return Response(
        content=content,
        media_type=_EXPORT_MEDIA_TYPES[export_format],
        headers={"Content-Disposition": disposition},
    )


@router.post("/{exam_id}/mock-generate", response_model=ExamMockGenerateResponse, status_code=status.HTTP_201_CREATED)
async def generate_mock_exam(
    exam_id: uuid.UUID,
    body: ExamMockGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ExamMockGenerateResponse:
    source = await _get_writable_exam_or_404(db, exam_id, user)
    source_items = [
        item
        for item in sorted(source.exam_questions, key=lambda question_item: question_item.order)
        if item.question is not None
    ]
    source_question_count = len(source_items)
    if source_question_count == 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="原考试没有可用于生成模拟卷的题目")

    target_count = body.question_count or source_question_count
    if target_count < source_question_count:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="模拟试卷题目数不能少于原考试题目数",
        )

    source_start_time = coerce_persisted_exam_datetime_to_utc(source.start_time)
    inferred_mock_end_time = (
        source_start_time - timedelta(minutes=1) if source_start_time is not None else None
    )
    mock_end_time = (
        inferred_mock_end_time
        if inferred_mock_end_time is not None and inferred_mock_end_time > datetime.now(timezone.utc)
        else None
    )

    is_admin = await _is_exam_admin(db, user.id)
    try:
        generated = await generate_question_items_from_source_items(
            db,
            source_items,
            total_count=target_count,
            source_reuse_rate=body.source_reuse_rate,
            root_knowledge_point_id=source.course_kp_id,
            prefer_root_knowledge_point=False,
            difficulty_strategy=body.difficulty_strategy,
            model=body.model,
            user=user,
            is_admin=is_admin,
            exam_title=source.title,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    total_score = sum(float(item.score_override or 0) for item in generated.question_items) or source.total_score
    requested_title = (body.title or "").strip() or f"{source.title} - 模拟试卷"
    title = await _unique_exam_title_for_owner(
        db,
        owner_id=user.id,
        category=source.category,
        base_title=requested_title,
    )
    mock_exam = Exam(
        category=source.category,
        title=title,
        description=f"基于「{source.title}」生成的模拟试卷。",
        start_time=None,
        end_time=mock_end_time,
        duration_minutes=source.duration_minutes,
        total_score=total_score,
        status="ongoing",
        position_id=source.position_id,
        max_switch_count=source.max_switch_count,
        allow_retake=source.allow_retake,
        show_result=source.show_result,
        notes_template=source.notes_template,
        question_mode="auto",
        course_kp_id=source.course_kp_id,
        created_by=user.id,
        owner_id=user.id,
    )
    db.add(mock_exam)
    await db.flush()

    for index, item in enumerate(generated.question_items):
        reused_from_source = item.question_id in generated.reused_source_question_ids
        db.add(
            ExamQuestion(
                exam_id=mock_exam.id,
                question_id=item.question_id,
                order=item.order if item.order is not None else index,
                score_override=item.score_override,
                source_exam_id=source.id if reused_from_source else None,
                source_question_id=item.question_id if reused_from_source else None,
            )
        )

    seen_student_ids: set[uuid.UUID] = set()
    for source_student in source.exam_students:
        if source_student.student_id in seen_student_ids:
            continue
        seen_student_ids.add(source_student.student_id)
        db.add(ExamStudent(exam_id=mock_exam.id, student_id=source_student.student_id))

    source_semester_id = await db.scalar(
        select(ExamSemesterAssignment.course_semester_id).where(ExamSemesterAssignment.exam_id == source.id)
    )
    if source_semester_id is not None:
        db.add(ExamSemesterAssignment(exam_id=mock_exam.id, course_semester_id=source_semester_id))

    await db.commit()

    return ExamMockGenerateResponse(
        exam_id=mock_exam.id,
        generated_question_count=generated.generated_question_count,
        reused_source_question_count=generated.reused_source_question_count,
        reused_bank_question_count=generated.reused_bank_question_count,
    )


@router.post("", response_model=ExamDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_exam(
    body: ExamCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ExamDetailResponse:
    exam = Exam(
        category=body.category,
        title=body.title,
        description=body.description,
        start_time=coerce_exam_input_datetime_to_utc(body.start_time),
        end_time=coerce_exam_input_datetime_to_utc(body.end_time),
        duration_minutes=body.duration_minutes,
        total_score=body.total_score,
        status=body.status,
        position_id=body.position_id,
        max_switch_count=body.max_switch_count,
        allow_retake=body.allow_retake,
        show_result=body.show_result,
        notes_template=body.notes_template,
        question_mode=body.question_mode,
        course_kp_id=body.course_kp_id,
        created_by=user.id,
        owner_id=user.id,
    )
    db.add(exam)
    await db.flush()

    # 在某个学期下创建考试/练习时，直接归档到该学期，无需再手动归档。
    if body.course_semester_id is not None:
        db.add(ExamSemesterAssignment(exam_id=exam.id, course_semester_id=body.course_semester_id))

    question_items = body.question_items or [
        ExamQuestionItem(question_id=qid, order=i, score_override=None) for i, qid in enumerate(body.question_ids)
    ]
    if question_items:
        for i, item in enumerate(question_items):
            db.add(
                ExamQuestion(
                    exam_id=exam.id,
                    question_id=item.question_id,
                    order=item.order if item.order is not None else i,
                    score_override=item.score_override,
                )
            )

    if body.student_ids:
        for sid in body.student_ids:
            db.add(ExamStudent(exam_id=exam.id, student_id=sid))

    await db.commit()
    await db.refresh(exam)

    return _build_detail_response(exam)


@router.patch("/{exam_id}", response_model=ExamDetailResponse)
async def update_exam(
    exam_id: uuid.UUID,
    body: ExamUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ExamDetailResponse:
    exam = await _get_writable_exam_or_404(db, exam_id, user)

    data = body.model_dump(exclude_unset=True)
    has_explicit_total_score = "total_score" in data
    question_ids = data.pop("question_ids", None)
    question_items = data.pop("question_items", None)
    student_ids = data.pop("student_ids", None)

    for field, value in data.items():
        if field in {"start_time", "end_time"}:
            value = coerce_exam_input_datetime_to_utc(value)
        setattr(exam, field, value)

    if question_items is not None:
        normalized_question_items = [
            ExamQuestionItem(**item) if isinstance(item, dict) else item for item in question_items
        ]
        if not has_explicit_total_score:
            computed_total_score = sum(float(item.score_override or 0) for item in normalized_question_items)
            if computed_total_score > 0:
                exam.total_score = computed_total_score
        await _sync_questions(
            db,
            exam.id,
            normalized_question_items,
        )
    elif question_ids is not None:
        await _sync_questions(
            db,
            exam.id,
            [ExamQuestionItem(question_id=qid, order=i, score_override=None) for i, qid in enumerate(question_ids)],
        )

    if student_ids is not None:
        await _sync_students(db, exam.id, student_ids)

    await db.commit()
    await db.refresh(exam)

    return _build_detail_response(exam)


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exam(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    exam = await _get_writable_exam_or_404(db, exam_id, user)
    question_ids = [item.question_id for item in exam.exam_questions]

    await db.execute(
        delete(ExamSemesterAssignment).where(
            ExamSemesterAssignment.exam_id == exam.id,
        )
    )

    if await _exam_has_student_history(db, exam.id):
        exam.deleted_at = datetime.now(timezone.utc)
    else:
        await db.delete(exam)
        await db.flush()
        for question_id in question_ids:
            await cleanup_soft_deleted_question_if_orphaned(db, question_id)

    await db.commit()


# ── Status change ──


@router.patch("/{exam_id}/status", response_model=ExamResponse)
async def change_exam_status(
    exam_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ExamResponse:
    exam = await _get_writable_exam_or_404(db, exam_id, user)

    new_status = body.get("status")
    if new_status is None:
        raise HTTPException(status_code=400, detail="status is required")

    valid = {"draft", "upcoming", "ongoing", "completed", "closed"}
    if new_status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status: {new_status}")
    exam.status = new_status

    await db.commit()
    await db.refresh(exam)
    return _build_exam_response(exam)


# ── Sub-resource: Questions ──


@router.get("/{exam_id}/questions", response_model=list[ExamQuestionResponse])
async def list_exam_questions(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[ExamQuestionResponse]:
    exam = await _get_visible_exam_or_404(db, exam_id, user)

    return [
        ExamQuestionResponse(
            question_id=eq.question_id,
            order=eq.order,
            score_override=eq.score_override,
            source_exam_id=eq.source_exam_id,
            source_question_id=eq.source_question_id,
            question_title=eq.question.title if eq.question else None,
            question_type=eq.question.type.value if eq.question else None,
            question_score=eq.question.score if eq.question else None,
            question_difficulty=eq.question.difficulty if eq.question else None,
        )
        for eq in sorted(exam.exam_questions, key=lambda x: x.order)
    ]


@router.get("/{exam_id}/question-details", response_model=list[QuestionResponse])
async def list_exam_question_details(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[QuestionResponse]:
    """Return full question data within the exam's write permission boundary."""
    exam = await _get_writable_exam_or_404(db, exam_id, user)
    exam_questions = sorted(exam.exam_questions, key=lambda item: item.order)
    question_ids = [item.question_id for item in exam_questions]
    if not question_ids:
        return []

    result = await db.execute(
        select(Question)
        .where(Question.id.in_(question_ids))
        .options(
            joinedload(Question.creator),
            joinedload(Question.question_bank),
            selectinload(Question.tags),
            selectinload(Question.knowledge_points),
        )
    )
    question_by_id = {
        question.id: question for question in result.unique().scalars().all()
    }

    questions: list[QuestionResponse] = []
    for exam_question in exam_questions:
        question = question_by_id.get(exam_question.question_id)
        if question is None:
            continue
        questions.append(QuestionResponse.from_question(question))
    return questions


@router.post("/{exam_id}/questions", status_code=status.HTTP_201_CREATED)
async def add_exam_questions(
    exam_id: uuid.UUID,
    body: list[ExamQuestionItem],
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict:
    await _get_writable_exam_or_404(db, exam_id, user)

    for item in body:
        db.add(
            ExamQuestion(
                exam_id=exam_id,
                question_id=item.question_id,
                order=item.order,
                score_override=item.score_override,
            )
        )
    await db.commit()
    return {"added": len(body)}


@router.delete("/{exam_id}/questions", status_code=status.HTTP_204_NO_CONTENT)
async def remove_exam_questions(
    exam_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    await _get_writable_exam_or_404(db, exam_id, user)
    question_ids = body.get("question_ids", [])
    if question_ids:
        await db.execute(
            delete(ExamQuestion).where(
                ExamQuestion.exam_id == exam_id,
                ExamQuestion.question_id.in_(question_ids),
            )
        )
        await db.commit()


# ── Sub-resource: Students ──


@router.get("/{exam_id}/students", response_model=list[ExamStudentResponse])
async def list_exam_students(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[ExamStudentResponse]:
    exam = await _get_visible_exam_or_404(db, exam_id, user)

    return [
        ExamStudentResponse(
            student_id=es.student_id,
            full_name=es.student.full_name if es.student else None,
            username=es.student.username if es.student else None,
            phone=es.student.phone if es.student else None,
            user_type=es.student.user_type if es.student else None,
            started_at=es.started_at,
            submitted_at=es.submitted_at,
            grading_status=es.grading_status,
        )
        for es in exam.exam_students
    ]


@router.get("/{exam_id}/students/{student_id}/result", response_model=StudentExamResultResponse)
async def get_student_result_for_teacher(
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> StudentExamResultResponse:
    exam = await _get_visible_exam_or_404(db, exam_id, user)

    exam_student_result = await db.execute(
        select(ExamStudent).where(
            ExamStudent.exam_id == exam_id,
            ExamStudent.student_id == student_id,
        )
    )
    exam_student = exam_student_result.scalar_one_or_none()
    if exam_student is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found in this exam")

    if exam_student.submitted_at is None:
        return StudentExamResultResponse(
            exam_id=exam.id,
            title=exam.title,
            submitted_at=None,
            total_score=exam.total_score,
            score=exam_student.score,
            objective_score=exam_student.objective_score,
            subjective_score=exam_student.subjective_score,
            grading_status=exam_student.grading_status,
            can_view=False,
            blocked_reason="该考生尚未提交考试",
        )

    is_pending_ai = exam_student.grading_status == GradingStatus.PENDING_AI.value

    answers_result = await db.execute(
        select(StudentExamAnswer).where(
            StudentExamAnswer.exam_id == exam_id,
            StudentExamAnswer.student_id == student_id,
        )
    )
    answers = {item.question_id: item for item in answers_result.scalars().all()}

    appeals_result = await db.execute(
        select(StudentExamAppeal).where(
            StudentExamAppeal.exam_id == exam_id,
            StudentExamAppeal.student_id == student_id,
        )
    )
    appeals = {item.question_id: item for item in appeals_result.scalars().all()}

    _SUBJECTIVE_TYPES = {"short_answer", "essay", "code"}
    question_items: list[StudentExamResultQuestionResponse] = []
    for exam_question in sorted(exam.exam_questions, key=lambda item: item.order):
        question = exam_question.question
        answer = answers.get(question.id)
        appeal = appeals.get(question.id)
        answer_feedback = (answer.feedback or {}) if answer else {}
        grading_failed = bool(answer_feedback.get("grading_failed"))
        needs_human_review = bool(answer_feedback.get("needs_human_review"))
        grading_pending = is_pending_ai and question.type.value in _SUBJECTIVE_TYPES and not grading_failed
        question_items.append(
            StudentExamResultQuestionResponse(
                question_id=question.id,
                order=exam_question.order,
                type=question.type.value,
                title=question.title,
                content=_build_student_question_content(question),
                options=question.options,
                total_score=(
                    exam_question.score_override if exam_question.score_override is not None else question.score
                ),
                score_awarded=answer.score_awarded if answer else 0.0,
                is_correct=answer.is_correct if answer else False,
                answer_content=answer.answer_content if answer else {},
                standard_answer=question.answer or {},
                analysis=question.analysis,
                feedback=answer.feedback if answer else {},
                appeal_status=appeal.status if appeal else None,
                appeal_reason=appeal.reason if appeal else None,
                appeal_reply=appeal.teacher_reply if appeal else None,
                grading_pending=grading_pending,
                grading_failed=grading_failed,
                needs_human_review=needs_human_review,
            )
        )

    return StudentExamResultResponse(
        exam_id=exam.id,
        title=exam.title,
        submitted_at=exam_student.submitted_at,
        total_score=exam.total_score,
        score=exam_student.score,
        objective_score=exam_student.objective_score,
        subjective_score=exam_student.subjective_score,
        grading_status=exam_student.grading_status,
        can_view=True,
        blocked_reason=(
            "主观题正在进行 AI 评分，主观题分数将在评估完成后更新。客观题分数已可见。" if is_pending_ai else None
        ),
        questions=question_items,
    )


@router.post(
    "/{exam_id}/students/{student_id}/questions/{question_id}/ai-grade",
    response_model=SingleQuestionAIGradeResponse,
)
async def ai_grade_single_fill_in_for_student(
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    question_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> SingleQuestionAIGradeResponse:
    """Re-run DeepSeek fill-in grading for one student's one fill-in answer.

    Returns only this question's updated score, correctness, and feedback so
    the answer-detail view can refresh the row in place without re-fetching
    the entire exam result.

    Access: any user who can write the exam — that is, platform/school/
    enterprise admins for any exam, plus the exam owner (typically a teacher
    or evaluator) for their own exams. The frontend "AI 判题" button on the
    answer-detail view targets this endpoint.
    """
    from app.operations.service import regrade_single_student_fill_in

    await _get_writable_exam_or_404(db, exam_id, user)
    try:
        outcome = await regrade_single_student_fill_in(
            db,
            exam_id=exam_id,
            student_id=student_id,
            question_id=question_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return SingleQuestionAIGradeResponse(
        question_id=outcome.question_id,
        total_score=outcome.total_score,
        score_awarded=outcome.score_awarded,
        is_correct=outcome.is_correct,
        feedback=outcome.feedback,
    )


@router.patch(
    "/{exam_id}/students/{student_id}/questions/{question_id}/score",
    response_model=ManualQuestionScoreResponse,
)
async def update_student_question_score_for_teacher(
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    question_id: uuid.UUID,
    body: ManualQuestionScoreRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ManualQuestionScoreResponse:
    exam = await _get_writable_exam_or_404(db, exam_id, user)

    exam_student = (
        await db.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == exam_id,
                ExamStudent.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if exam_student is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found in this exam")
    if exam_student.submitted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Student has not submitted this exam")

    exam_question = (
        await db.execute(
            select(ExamQuestion).where(
                ExamQuestion.exam_id == exam_id,
                ExamQuestion.question_id == question_id,
            )
        )
    ).scalar_one_or_none()
    if exam_question is None or exam_question.question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found in this exam")

    total_score = (
        exam_question.score_override if exam_question.score_override is not None else exam_question.question.score
    )
    total_score = float(total_score or 0.0)
    score_awarded = round(float(body.score_awarded), 2)
    if score_awarded > total_score:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Score cannot exceed question total score ({total_score})",
        )

    answer = (
        await db.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == exam_id,
                StudentExamAnswer.student_id == student_id,
                StudentExamAnswer.question_id == question_id,
            )
        )
    ).scalar_one_or_none()
    if answer is None:
        answer = StudentExamAnswer(
            exam_id=exam_id,
            student_id=student_id,
            question_id=question_id,
            answer_content={},
            feedback={},
        )
        db.add(answer)

    now = datetime.now(timezone.utc)
    feedback = dict(answer.feedback or {})
    feedback["manual_score"] = {
        "score_awarded": score_awarded,
        "updated_by": str(user.id),
        "updated_at": now.isoformat(),
    }
    answer.score_awarded = score_awarded
    answer.is_correct = total_score > 0 and score_awarded >= total_score
    answer.feedback = feedback

    latest_submission_id = exam_student.latest_submission_id
    if latest_submission_id is not None:
        submission_answer = (
            await db.execute(
                select(StudentExamSubmissionAnswer).where(
                    StudentExamSubmissionAnswer.submission_id == latest_submission_id,
                    StudentExamSubmissionAnswer.question_id == question_id,
                )
            )
        ).scalar_one_or_none()
        if submission_answer is None:
            submission_answer = StudentExamSubmissionAnswer(
                submission_id=latest_submission_id,
                exam_id=exam_id,
                student_id=student_id,
                question_id=question_id,
                answer_content=answer.answer_content or {},
                feedback={},
            )
            db.add(submission_answer)
        submission_answer.score_awarded = score_awarded
        submission_answer.is_correct = answer.is_correct
        submission_answer.feedback = feedback

    answers_result = await db.execute(
        select(StudentExamAnswer).where(
            StudentExamAnswer.exam_id == exam_id,
            StudentExamAnswer.student_id == student_id,
        )
    )
    answers_by_question = {item.question_id: item for item in answers_result.scalars().all()}

    objective_score = 0.0
    subjective_score = 0.0
    for item in exam.exam_questions:
        question = item.question
        if question is None:
            continue
        row = answers_by_question.get(question.id)
        awarded = float(row.score_awarded) if row is not None else 0.0
        question_type = getattr(question.type, "value", str(question.type))
        if question_type in _OBJECTIVE_QUESTION_TYPES:
            objective_score += awarded
        else:
            subjective_score += awarded

    exam_student.objective_score = round(objective_score, 2)
    exam_student.subjective_score = round(subjective_score, 2)
    exam_student.score = round(objective_score + subjective_score, 2)
    exam_student.grading_status = GradingStatus.REVIEWED.value
    exam_student.reviewed_at = now

    if latest_submission_id is not None:
        submission = (
            await db.execute(select(StudentExamSubmission).where(StudentExamSubmission.id == latest_submission_id))
        ).scalar_one_or_none()
        if submission is not None:
            submission.objective_score = exam_student.objective_score
            submission.subjective_score = exam_student.subjective_score
            submission.score = exam_student.score
            submission.grading_status = exam_student.grading_status

    await db.commit()
    await db.refresh(answer)
    await db.refresh(exam_student)

    return ManualQuestionScoreResponse(
        question_id=question_id,
        total_score=total_score,
        score_awarded=answer.score_awarded,
        is_correct=answer.is_correct,
        objective_score=exam_student.objective_score,
        subjective_score=exam_student.subjective_score,
        exam_score=exam_student.score,
        grading_status=exam_student.grading_status,
        feedback=answer.feedback or {},
    )


@router.post("/{exam_id}/students", status_code=status.HTTP_201_CREATED)
async def add_exam_students(
    exam_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict:
    await _get_writable_exam_or_404(db, exam_id, user)

    student_ids = body.get("student_ids", [])
    for sid in student_ids:
        db.add(ExamStudent(exam_id=exam_id, student_id=uuid.UUID(sid)))
    await db.commit()
    return {"added": len(student_ids)}


@router.delete("/{exam_id}/students", status_code=status.HTTP_204_NO_CONTENT)
async def remove_exam_students(
    exam_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    await _get_writable_exam_or_404(db, exam_id, user)
    student_ids = body.get("student_ids", [])
    if student_ids:
        await db.execute(
            delete(ExamStudent).where(
                ExamStudent.exam_id == exam_id,
                ExamStudent.student_id.in_([uuid.UUID(s) for s in student_ids]),
            )
        )
        await db.commit()


# ── Analysis ──


_SCORE_BUCKETS: list[tuple[str, float, float]] = [
    ("不及格", 0.0, 60.0),
    ("及格", 60.0, 70.0),
    ("中等", 70.0, 80.0),
    ("良好", 80.0, 90.0),
    ("优秀", 90.0, 100.0001),
]


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _build_analysis_response(exam: Exam, answers: list[StudentExamAnswer]) -> ExamAnalysisResponse:
    total_score = exam.total_score or 0.0
    students = list(exam.exam_students)
    exam_questions = sorted(exam.exam_questions, key=lambda q: q.order)

    submitted = [s for s in students if s.submitted_at is not None]
    graded_scores = [s.score for s in students if s.score is not None]
    pass_threshold = total_score * 0.6
    pass_count = sum(1 for score in graded_scores if score >= pass_threshold)

    overall = AnalysisOverall(
        total_students=len(students),
        submitted_count=len(submitted),
        graded_count=len(graded_scores),
        average_score=(sum(graded_scores) / len(graded_scores)) if graded_scores else None,
        median_score=_median(graded_scores),
        highest_score=max(graded_scores) if graded_scores else None,
        lowest_score=min(graded_scores) if graded_scores else None,
        pass_count=pass_count,
        pass_rate=(pass_count / len(graded_scores)) if graded_scores else None,
        total_score=total_score,
    )

    buckets: list[ScoreBucket] = []
    for label, lo, hi in _SCORE_BUCKETS:
        count = 0
        for score in graded_scores:
            percent = (score / total_score * 100.0) if total_score > 0 else 0.0
            if lo <= percent < hi:
                count += 1
        buckets.append(ScoreBucket(label=label, min_percent=lo, max_percent=min(hi, 100.0), count=count))

    student_rows: list[StudentResultRow] = []
    for es in students:
        percent = (es.score / total_score * 100.0) if (es.score is not None and total_score > 0) else None
        student_rows.append(
            StudentResultRow(
                student_id=es.student_id,
                full_name=es.student.full_name if es.student else None,
                username=es.student.username if es.student else None,
                phone=es.student.phone if es.student else None,
                user_type=es.student.user_type if es.student else None,
                submitted_at=es.submitted_at,
                grading_status=es.grading_status,
                objective_score=es.objective_score,
                subjective_score=es.subjective_score,
                score=es.score,
                percent=percent,
            )
        )
    student_rows.sort(key=lambda r: (r.score is None, -(r.score or 0.0)))

    answers_by_question: dict[uuid.UUID, list[StudentExamAnswer]] = {}
    for ans in answers:
        answers_by_question.setdefault(ans.question_id, []).append(ans)

    question_rows: list[QuestionStatRow] = []
    for eq in exam_questions:
        q_answers = answers_by_question.get(eq.question_id, [])
        attempt_count = len(q_answers)
        correct_count = sum(1 for a in q_answers if a.is_correct)
        avg_score = sum(a.score_awarded for a in q_answers) / attempt_count if attempt_count else None
        max_score = eq.score_override if eq.score_override is not None else (eq.question.score if eq.question else 0.0)
        question_rows.append(
            QuestionStatRow(
                question_id=eq.question_id,
                order=eq.order,
                title=eq.question.title if eq.question else None,
                type=eq.question.type.value if eq.question else None,
                max_score=max_score or 0.0,
                attempt_count=attempt_count,
                correct_count=correct_count,
                correct_rate=(correct_count / attempt_count) if attempt_count else None,
                average_score=avg_score,
                knowledge_point_ids=[kp.id for kp in (eq.question.knowledge_points or [])] if eq.question else [],
            )
        )

    kp_accumulator: dict[uuid.UUID, dict[str, object]] = {}
    for eq in exam_questions:
        question = eq.question
        if not question:
            continue
        q_answers = answers_by_question.get(eq.question_id, [])
        if not q_answers:
            rate = None
        else:
            rate = sum(1 for a in q_answers if a.is_correct) / len(q_answers)
        for kp in question.knowledge_points or []:
            bucket = kp_accumulator.setdefault(kp.id, {"name": kp.name, "count": 0, "rate_sum": 0.0, "rate_n": 0})
            bucket["count"] = int(bucket["count"]) + 1
            if rate is not None:
                bucket["rate_sum"] = float(bucket["rate_sum"]) + rate
                bucket["rate_n"] = int(bucket["rate_n"]) + 1

    knowledge_points: list[KnowledgePointStatRow] = []
    for kp_id, data in kp_accumulator.items():
        rate_n = int(data["rate_n"])
        avg_rate = (float(data["rate_sum"]) / rate_n) if rate_n else None
        knowledge_points.append(
            KnowledgePointStatRow(
                knowledge_point_id=kp_id,
                name=str(data["name"]),
                question_count=int(data["count"]),
                average_correct_rate=avg_rate,
            )
        )
    knowledge_points.sort(key=lambda r: r.name)

    answer_records = [
        AnswerRecord(
            student_id=ans.student_id,
            question_id=ans.question_id,
            score_awarded=ans.score_awarded,
            is_correct=ans.is_correct,
        )
        for ans in answers
    ]

    return ExamAnalysisResponse(
        exam_id=exam.id,
        title=exam.title,
        start_time=exam.start_time,
        category=exam.category,
        overall=overall,
        score_distribution=buckets,
        students=student_rows,
        questions=question_rows,
        knowledge_points=knowledge_points,
        answer_records=answer_records,
    )


@router.get("/{exam_id}/analysis", response_model=ExamAnalysisResponse)
async def get_exam_analysis(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ExamAnalysisResponse:
    if await _is_student_user(db, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Students cannot view analysis")
    exam = await _get_writable_exam_or_404(db, exam_id, user)

    answer_rows = (
        (await db.execute(select(StudentExamAnswer).where(StudentExamAnswer.exam_id == exam_id))).scalars().all()
    )

    return _build_analysis_response(exam, list(answer_rows))

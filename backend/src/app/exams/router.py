"""Exam API router."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, user_has_role
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
from app.exams.models import Exam, ExamQuestion, ExamStudent
from app.exams.schemas import (
    ExamCreate,
    ExamDetailResponse,
    ExamQuestionItem,
    ExamQuestionResponse,
    ExamResponse,
    ExamStudentResponse,
    ExamUpdate,
)

router = APIRouter()


async def _is_exam_admin(db: AsyncSession, user_id: uuid.UUID) -> bool:
    return await user_has_role(db, user_id, "platform_admin", "school_admin", "admin")


async def _is_student_user(db: AsyncSession, user_id: uuid.UUID) -> bool:
    return await user_has_role(db, user_id, "student")


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
    exam_student = (
        next((s for s in exam.exam_students if s.student_id == student_id), None)
        if student_id is not None
        else None
    )
    return ExamResponse(
        id=exam.id,
        title=exam.title,
        description=exam.description,
        start_time=exam.start_time,
        end_time=exam.end_time,
        duration_minutes=exam.duration_minutes,
        total_score=exam.total_score,
        status=exam.status if isinstance(exam.status, str) else exam.status.value,
        position_id=exam.position_id,
        position_name=exam.position.name if exam.position else None,
        max_switch_count=exam.max_switch_count,
        show_result=exam.show_result,
        notes_template=exam.notes_template,
        question_mode=exam.question_mode,
        total_questions=len(exam.exam_questions),
        total_students=len(exam.exam_students),
        submitted_count=submitted,
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


async def _sync_questions(
    db: AsyncSession, exam_id: uuid.UUID, question_items: list[ExamQuestionItem]
) -> None:
    await db.execute(delete(ExamQuestion).where(ExamQuestion.exam_id == exam_id))
    for i, item in enumerate(question_items):
        db.add(
            ExamQuestion(
                exam_id=exam_id,
                question_id=item.question_id,
                order=item.order if item.order is not None else i,
                score_override=item.score_override,
            )
        )


async def _sync_students(
    db: AsyncSession, exam_id: uuid.UUID, student_ids: list[uuid.UUID]
) -> None:
    existing_rows = (
        await db.execute(select(ExamStudent).where(ExamStudent.exam_id == exam_id))
    ).scalars().all()
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


@router.post("", response_model=ExamDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_exam(
    body: ExamCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ExamDetailResponse:
    exam = Exam(
        title=body.title,
        description=body.description,
        start_time=body.start_time,
        end_time=body.end_time,
        duration_minutes=body.duration_minutes,
        total_score=body.total_score,
        status=body.status,
        position_id=body.position_id,
        max_switch_count=body.max_switch_count,
        show_result=body.show_result,
        notes_template=body.notes_template,
        question_mode=body.question_mode,
        created_by=user.id,
        owner_id=user.id,
    )
    db.add(exam)
    await db.flush()

    question_items = body.question_items or [
        ExamQuestionItem(question_id=qid, order=i, score_override=None)
        for i, qid in enumerate(body.question_ids)
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
    question_ids = data.pop("question_ids", None)
    question_items = data.pop("question_items", None)
    student_ids = data.pop("student_ids", None)

    for field, value in data.items():
        setattr(exam, field, value)

    if question_items is not None:
        await _sync_questions(
            db,
            exam.id,
            [ExamQuestionItem(**item) if isinstance(item, dict) else item for item in question_items],
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
    from datetime import datetime, timezone

    exam = await _get_writable_exam_or_404(db, exam_id, user)

    exam.deleted_at = datetime.now(timezone.utc)
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
            question_title=eq.question.title if eq.question else None,
            question_type=eq.question.type.value if eq.question else None,
            question_score=eq.question.score if eq.question else None,
            question_difficulty=eq.question.difficulty if eq.question else None,
        )
        for eq in sorted(exam.exam_questions, key=lambda x: x.order)
    ]


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
            submitted_at=es.submitted_at,
        )
        for es in exam.exam_students
    ]


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

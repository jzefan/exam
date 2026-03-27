"""Exam API router."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
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


def _build_exam_response(exam: Exam) -> ExamResponse:
    submitted = sum(1 for s in exam.exam_students if s.submitted_at is not None)
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
        total_questions=len(exam.exam_questions),
        total_students=len(exam.exam_students),
        submitted_count=submitted,
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
            submitted_at=es.submitted_at,
        )
        for es in exam.exam_students
    ]
    return ExamDetailResponse(
        **base.model_dump(),
        questions=questions,
        students=students,
    )


async def _sync_questions(
    db: AsyncSession, exam_id: uuid.UUID, question_ids: list[uuid.UUID]
) -> None:
    await db.execute(delete(ExamQuestion).where(ExamQuestion.exam_id == exam_id))
    for i, qid in enumerate(question_ids):
        db.add(ExamQuestion(exam_id=exam_id, question_id=qid, order=i))


async def _sync_students(
    db: AsyncSession, exam_id: uuid.UUID, student_ids: list[uuid.UUID]
) -> None:
    await db.execute(delete(ExamStudent).where(ExamStudent.exam_id == exam_id))
    for sid in student_ids:
        db.add(ExamStudent(exam_id=exam_id, student_id=sid))


# ── CRUD ──


@router.get("", response_model=list[ExamResponse])
async def list_exams(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    pagination: Annotated[PaginationParams, Depends(parse_pagination)],
    _user: CurrentUser,
) -> list[ExamResponse]:
    base_query = select(Exam).where(Exam.deleted_at.is_(None))
    filters = parse_filters(request, Exam)
    filtered_query = apply_filters(base_query, filters, Exam)

    total = await get_total_count(db, filtered_query)
    response.headers["X-Total-Count"] = str(total)

    paginated_query = apply_pagination(filtered_query, pagination, Exam)
    result = await db.execute(paginated_query)
    exams = result.scalars().unique().all()

    return [_build_exam_response(e) for e in exams]


@router.get("/{exam_id}", response_model=ExamDetailResponse)
async def get_exam(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> ExamDetailResponse:
    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

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
        created_by=user.id,
    )
    db.add(exam)
    await db.flush()

    if body.question_ids:
        for i, qid in enumerate(body.question_ids):
            db.add(ExamQuestion(exam_id=exam.id, question_id=qid, order=i))

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
    _user: CurrentUser,
) -> ExamDetailResponse:
    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    data = body.model_dump(exclude_unset=True)
    question_ids = data.pop("question_ids", None)
    student_ids = data.pop("student_ids", None)

    for field, value in data.items():
        setattr(exam, field, value)

    if question_ids is not None:
        await _sync_questions(db, exam.id, question_ids)

    if student_ids is not None:
        await _sync_students(db, exam.id, student_ids)

    await db.commit()
    await db.refresh(exam)

    return _build_detail_response(exam)


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exam(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> None:
    from datetime import datetime, timezone

    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalar_one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    exam.deleted_at = datetime.now(timezone.utc)
    await db.commit()


# ── Status change ──


@router.patch("/{exam_id}/status", response_model=ExamResponse)
async def change_exam_status(
    exam_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: CurrentUser,
) -> ExamResponse:
    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

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
    _user: CurrentUser,
) -> list[ExamQuestionResponse]:
    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

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
    _user: CurrentUser,
) -> dict:
    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalar_one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

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
    _user: CurrentUser,
) -> None:
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
    _user: CurrentUser,
) -> list[ExamStudentResponse]:
    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

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
    _user: CurrentUser,
) -> dict:
    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalar_one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

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
    _user: CurrentUser,
) -> None:
    student_ids = body.get("student_ids", [])
    if student_ids:
        await db.execute(
            delete(ExamStudent).where(
                ExamStudent.exam_id == exam_id,
                ExamStudent.student_id.in_([uuid.UUID(s) for s in student_ids]),
            )
        )
        await db.commit()

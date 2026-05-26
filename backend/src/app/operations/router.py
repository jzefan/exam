import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_roles
from app.auth.models import User
from app.database import get_db
from app.operations.schemas import (
    RegradingAssigneeResponse,
    RegradingExamResponse,
    RegradingQuestionResponse,
    RegradingRunResponse,
)
from app.operations.service import (
    list_regrading_assignees,
    list_regrading_exams_for_assignee,
    list_regrading_questions_for_exam,
    regrade_exam_question_submissions,
)

router = APIRouter()
PlatformAdmin = Annotated[User, require_roles("platform_admin")]


@router.get("/regrading/assignees", response_model=list[RegradingAssigneeResponse])
async def get_regrading_assignees(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: PlatformAdmin,
) -> list[RegradingAssigneeResponse]:
    return [RegradingAssigneeResponse.model_validate(item) for item in await list_regrading_assignees(db)]


@router.get("/regrading/assignees/{assignee_id}/exams", response_model=list[RegradingExamResponse])
async def get_regrading_exams(
    assignee_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: PlatformAdmin,
) -> list[RegradingExamResponse]:
    return [RegradingExamResponse.model_validate(item) for item in await list_regrading_exams_for_assignee(db, assignee_id)]


@router.get("/regrading/exams/{exam_id}/questions", response_model=list[RegradingQuestionResponse])
async def get_regrading_questions(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: PlatformAdmin,
) -> list[RegradingQuestionResponse]:
    return [RegradingQuestionResponse.model_validate(item) for item in await list_regrading_questions_for_exam(db, exam_id)]


@router.post("/regrading/exams/{exam_id}/questions/{question_id}", response_model=RegradingRunResponse)
async def run_regrading(
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: PlatformAdmin,
) -> RegradingRunResponse:
    try:
        result = await regrade_exam_question_submissions(db, exam_id=exam_id, question_id=question_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return RegradingRunResponse(
        exam_id=result.exam_id,
        question_id=result.question_id,
        question_type=result.question_type,  # type: ignore[arg-type]
        affected_submissions=result.affected_submissions,
        updated_latest_answers=result.updated_latest_answers,
        created_grading_tasks=result.created_grading_tasks,
    )

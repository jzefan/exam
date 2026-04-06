"""API router for grading tasks."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.grading.schemas import (
    FinalGradingReportRead,
    GradingInboxCandidateDetailRead,
    GradingInboxQuestionDetailRead,
    GradingInboxRead,
    GradingPromptFollowUpCreate,
    GradingPromptFollowUpRead,
    GradingSnapshotRead,
    GradingTaskCreate,
    GradingTaskListItemRead,
    GradingTaskRead,
    GradingTaskRunRead,
    ManualScoreOverride,
)
from app.grading.service import (
    create_grading_task,
    create_manual_score_override,
    get_final_report,
    get_grading_candidate_detail,
    get_grading_inbox,
    get_grading_question_candidates,
    run_grading_prompt_follow_up,
    list_grading_tasks,
    run_grading_task_with_role_binding,
)

router = APIRouter()


@router.get("/inbox", response_model=GradingInboxRead)
async def get_grading_inbox_endpoint(
    db: AsyncSession = Depends(get_db),
) -> GradingInboxRead:
    return GradingInboxRead(**(await get_grading_inbox(db)))


@router.get("/inbox/questions/{exam_id}/{question_id}", response_model=GradingInboxQuestionDetailRead)
async def get_grading_question_candidates_endpoint(
    exam_id: str,
    question_id: str,
    db: AsyncSession = Depends(get_db),
) -> GradingInboxQuestionDetailRead:
    return GradingInboxQuestionDetailRead(**(await get_grading_question_candidates(db, exam_id, question_id)))


@router.get("/inbox/tasks/{task_id}", response_model=GradingInboxCandidateDetailRead)
async def get_grading_candidate_detail_endpoint(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> GradingInboxCandidateDetailRead:
    return GradingInboxCandidateDetailRead(**(await get_grading_candidate_detail(db, task_id)))


@router.post("/tasks/{task_id}/follow-up", response_model=GradingPromptFollowUpRead)
async def run_grading_prompt_follow_up_endpoint(
    task_id: str,
    payload: GradingPromptFollowUpCreate,
    db: AsyncSession = Depends(get_db),
) -> GradingPromptFollowUpRead:
    return GradingPromptFollowUpRead(**(await run_grading_prompt_follow_up(db, task_id, payload.prompt)))


@router.get("/tasks", response_model=list[GradingTaskListItemRead])
async def list_grading_tasks_endpoint(
    db: AsyncSession = Depends(get_db),
) -> list[GradingTaskListItemRead]:
    return [GradingTaskListItemRead(**item) for item in await list_grading_tasks(db)]


@router.post("/tasks", response_model=GradingTaskRead, status_code=status.HTTP_201_CREATED)
async def create_grading_task_endpoint(
    payload: GradingTaskCreate,
    db: AsyncSession = Depends(get_db),
) -> GradingTaskRead:
    task = await create_grading_task(db, payload.model_dump())
    return GradingTaskRead(
        id=str(task.id),
        status=task.status,
        question_type=task.question_type,
    )


@router.post("/tasks/{task_id}/run", response_model=GradingTaskRunRead)
async def run_grading_task_endpoint(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> GradingTaskRunRead:
    return GradingTaskRunRead(**(await run_grading_task_with_role_binding(db, task_id)))


@router.get("/tasks/{task_id}/report", response_model=FinalGradingReportRead)
async def get_grading_report(
    task_id: str,
    db: AsyncSession = Depends(get_db),
) -> FinalGradingReportRead:
    return FinalGradingReportRead(**(await get_final_report(db, task_id)))


@router.post("/tasks/{task_id}/manual-score", response_model=GradingSnapshotRead)
async def manual_score_override(
    task_id: str,
    payload: ManualScoreOverride,
    db: AsyncSession = Depends(get_db),
) -> GradingSnapshotRead:
    snapshot = await create_manual_score_override(db, task_id, payload.score_total, payload.reason)
    return GradingSnapshotRead(
        id=str(snapshot.id),
        snapshot_type=snapshot.snapshot_type,
        score_total=snapshot.score_total,
        risk_flags=snapshot.risk_flags,
    )

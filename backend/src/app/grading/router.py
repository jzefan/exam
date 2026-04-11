"""API router for grading tasks."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, user_has_role
from app.database import get_db
from app.grading.schemas import (
    FinalGradingReportRead,
    GradingInboxCandidateDetailRead,
    GradingInboxQuestionDetailRead,
    GradingInboxRead,
    GradingTaskConfirmRead,
    GradingPromptFollowUpCreate,
    GradingPromptFollowUpRead,
    GradingSnapshotRead,
    GradingTaskCreate,
    GradingTaskListItemRead,
    GradingTaskRead,
    GradingTaskRunRequest,
    GradingTaskRunRead,
    ManualScoreOverride,
)
from app.grading.service import (
    confirm_grading_task_for_exam_submission,
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


async def _is_grading_admin(db: AsyncSession, user: CurrentUser) -> bool:
    return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin")


def _not_found(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/inbox", response_model=GradingInboxRead)
async def get_grading_inbox_endpoint(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> GradingInboxRead:
    return GradingInboxRead(
        **(
            await get_grading_inbox(
                db,
                current_user_id=user.id,
                is_platform_admin=await _is_grading_admin(db, user),
            )
        )
    )


@router.get("/inbox/questions/{exam_id}/{question_id}", response_model=GradingInboxQuestionDetailRead)
async def get_grading_question_candidates_endpoint(
    exam_id: str,
    question_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> GradingInboxQuestionDetailRead:
    try:
        return GradingInboxQuestionDetailRead(
            **(
                await get_grading_question_candidates(
                    db,
                    exam_id,
                    question_id,
                    current_user_id=user.id,
                    is_platform_admin=await _is_grading_admin(db, user),
                )
            )
        )
    except ValueError as exc:
        raise _not_found(exc) from exc


@router.get("/inbox/tasks/{task_id}", response_model=GradingInboxCandidateDetailRead)
async def get_grading_candidate_detail_endpoint(
    task_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> GradingInboxCandidateDetailRead:
    try:
        return GradingInboxCandidateDetailRead(
            **(
                await get_grading_candidate_detail(
                    db,
                    task_id,
                    current_user_id=user.id,
                    is_platform_admin=await _is_grading_admin(db, user),
                )
            )
        )
    except ValueError as exc:
        raise _not_found(exc) from exc


@router.post("/tasks/{task_id}/follow-up", response_model=GradingPromptFollowUpRead)
async def run_grading_prompt_follow_up_endpoint(
    task_id: str,
    payload: GradingPromptFollowUpCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> GradingPromptFollowUpRead:
    return GradingPromptFollowUpRead(
        **(
            await run_grading_prompt_follow_up(
                db,
                task_id,
                payload.prompt,
                payload.locale,
                current_user_id=user.id,
                is_platform_admin=await _is_grading_admin(db, user),
            )
        )
    )


@router.get("/tasks", response_model=list[GradingTaskListItemRead])
async def list_grading_tasks_endpoint(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[GradingTaskListItemRead]:
    return [
        GradingTaskListItemRead(**item)
        for item in await list_grading_tasks(
            db,
            current_user_id=user.id,
            is_platform_admin=await _is_grading_admin(db, user),
        )
    ]


@router.post("/tasks", response_model=GradingTaskRead, status_code=status.HTTP_201_CREATED)
async def create_grading_task_endpoint(
    payload: GradingTaskCreate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> GradingTaskRead:
    task = await create_grading_task(
        db,
        payload.model_dump(),
        current_user_id=user.id,
        is_platform_admin=await _is_grading_admin(db, user),
    )
    return GradingTaskRead(
        id=str(task.id),
        status=task.status,
        question_type=task.question_type,
    )


@router.post("/tasks/{task_id}/run", response_model=GradingTaskRunRead)
async def run_grading_task_endpoint(
    task_id: str,
    user: CurrentUser,
    payload: GradingTaskRunRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> GradingTaskRunRead:
    return GradingTaskRunRead(
        **(
            await run_grading_task_with_role_binding(
                db,
                task_id,
                payload.locale if payload else None,
                current_user_id=user.id,
                is_platform_admin=await _is_grading_admin(db, user),
            )
        )
    )


@router.post("/tasks/{task_id}/confirm", response_model=GradingTaskConfirmRead)
async def confirm_grading_task_endpoint(
    task_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> GradingTaskConfirmRead:
    return GradingTaskConfirmRead(
        **(
            await confirm_grading_task_for_exam_submission(
                db,
                task_id,
                current_user_id=user.id,
                is_platform_admin=await _is_grading_admin(db, user),
            )
        )
    )


@router.get("/tasks/{task_id}/report", response_model=FinalGradingReportRead)
async def get_grading_report(
    task_id: str,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> FinalGradingReportRead:
    return FinalGradingReportRead(
        **(
            await get_final_report(
                db,
                task_id,
                current_user_id=user.id,
                is_platform_admin=await _is_grading_admin(db, user),
            )
        )
    )


@router.post("/tasks/{task_id}/manual-score", response_model=GradingSnapshotRead)
async def manual_score_override(
    task_id: str,
    payload: ManualScoreOverride,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> GradingSnapshotRead:
    snapshot = await create_manual_score_override(
        db,
        task_id,
        payload.score_total,
        payload.reason,
        current_user_id=user.id,
        is_platform_admin=await _is_grading_admin(db, user),
    )
    return GradingSnapshotRead(
        id=str(snapshot.id),
        snapshot_type=snapshot.snapshot_type,
        score_total=snapshot.score_total,
        risk_flags=snapshot.risk_flags,
    )

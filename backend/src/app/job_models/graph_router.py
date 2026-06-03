"""API routes for the job-course graph workspace."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.job_models.graph_schemas import (
    GraphCourseFocusResponse,
    GraphJobFocusResponse,
    GraphLayoutPayload,
    GraphLayoutSaveRequest,
    GraphOverviewResponse,
    GraphSkillCourseMapping,
    SkillCourseMappingCreate,
)
from app.job_models.graph_service import (
    GraphConflictError,
    GraphNotFoundError,
    GraphValidationError,
    create_skill_course_mapping,
    delete_skill_course_mapping,
    get_course_focus,
    get_graph_overview,
    get_job_focus,
    save_graph_layout,
)
from app.rbac.dependencies import CurrentOrgId

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/overview", response_model=GraphOverviewResponse)
async def graph_overview(
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> GraphOverviewResponse:
    return await get_graph_overview(db, org_id=org_id)


@router.get("/jobs/{job_model_id}", response_model=GraphJobFocusResponse)
async def graph_job_focus(
    job_model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> GraphJobFocusResponse:
    try:
        return await get_job_focus(db, org_id=org_id, job_model_id=job_model_id)
    except GraphNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/courses/{course_root_id}", response_model=GraphCourseFocusResponse)
async def graph_course_focus(
    course_root_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> GraphCourseFocusResponse:
    try:
        return await get_course_focus(db, org_id=org_id, course_root_id=course_root_id)
    except GraphNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/skill-course-mappings",
    response_model=GraphSkillCourseMapping,
    status_code=status.HTTP_201_CREATED,
)
async def create_skill_course_mapping_endpoint(
    body: SkillCourseMappingCreate,
    db: DbSession,
    user: CurrentUser,
    org_id: CurrentOrgId,
) -> GraphSkillCourseMapping:
    try:
        mapping = await create_skill_course_mapping(
            db,
            org_id=org_id,
            user_id=user.id,
            data=body,
        )
    except GraphNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except GraphValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except GraphConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await db.commit()
    return mapping


@router.delete("/skill-course-mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill_course_mapping_endpoint(
    mapping_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> Response:
    try:
        await delete_skill_course_mapping(db, org_id=org_id, mapping_id=mapping_id)
    except GraphNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/layouts/{scope_type}/{scope_id}", response_model=GraphLayoutPayload)
async def save_graph_layout_endpoint(
    scope_type: str,
    scope_id: uuid.UUID,
    body: GraphLayoutSaveRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: CurrentOrgId,
) -> GraphLayoutPayload:
    try:
        layout = await save_graph_layout(
            db,
            org_id=org_id,
            user_id=user.id,
            scope_type=scope_type,
            scope_id=scope_id,
            layout_json=body.layout_json,
        )
    except GraphValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    await db.commit()
    return layout

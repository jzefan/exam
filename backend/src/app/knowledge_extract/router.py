"""Routes for material → knowledge-point extraction and confirmed bulk-create."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.common.resource_access import teacher_visible_resource_filter
from app.database import get_db
from app.knowledge_extract import service
from app.knowledge_extract.schemas import (
    BulkCreateKnowledgePointsRequest,
    BulkCreateKnowledgePointsResponse,
    ExtractKnowledgeFragmentsResponse,
    ExtractKnowledgePointsRequest,
    ExtractKnowledgePointsResponse,
)
from app.learning.models import KnowledgePoint

router = APIRouter(prefix="/api/teacher/courses", tags=["knowledge-extract"])


async def _visible_course(db: AsyncSession, course_id: uuid.UUID, user) -> KnowledgePoint:
    stmt = select(KnowledgePoint).where(
        KnowledgePoint.id == course_id,
        KnowledgePoint.deleted_at.is_(None),
        teacher_visible_resource_filter(KnowledgePoint, user.id),
    )
    course = (await db.execute(stmt)).scalars().first()
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="课程不存在或无权访问")
    return course


@router.post(
    "/{course_id}/materials/{resource_id}/extract-knowledge-points",
    response_model=ExtractKnowledgePointsResponse,
)
async def extract_knowledge_points(
    course_id: uuid.UUID,
    resource_id: uuid.UUID,  # noqa: ARG001 - kept for provenance / future caching
    body: ExtractKnowledgePointsRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ExtractKnowledgePointsResponse:
    course = await _visible_course(db, course_id, user)
    try:
        candidates = await service.extract_knowledge_points(db, user.id, course_name=course.name, request=body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ExtractKnowledgePointsResponse(candidates=candidates)


@router.post(
    "/{course_id}/materials/{resource_id}/extract-knowledge-fragments",
    response_model=ExtractKnowledgeFragmentsResponse,
)
async def extract_knowledge_fragments(
    course_id: uuid.UUID,
    resource_id: uuid.UUID,
    body: ExtractKnowledgePointsRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ExtractKnowledgeFragmentsResponse:
    """Extract typed knowledge fragments from a material's text and store them ON
    that material. Does NOT touch the course knowledge tree — the fragments are
    material-scoped (concepts, formulas, code, cases, workflows) for display and
    future RAG retrieval.
    """
    course = await _visible_course(db, course_id, user)
    try:
        fragments = await service.extract_and_save_knowledge_fragments(
            db, user.id, resource_id=resource_id, course_name=course.name, request=body
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ExtractKnowledgeFragmentsResponse(fragments=fragments)


@router.post(
    "/{course_id}/knowledge-points/bulk-create",
    response_model=BulkCreateKnowledgePointsResponse,
    status_code=status.HTTP_201_CREATED,
)
async def bulk_create_knowledge_points(
    course_id: uuid.UUID,
    body: BulkCreateKnowledgePointsRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BulkCreateKnowledgePointsResponse:
    await _visible_course(db, course_id, user)
    created, skipped = await service.bulk_create_knowledge_points(db, user.id, course_kp_id=course_id, items=body.items)
    return BulkCreateKnowledgePointsResponse(created=created, skipped=skipped)

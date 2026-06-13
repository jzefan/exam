"""Routes for course KB ingestion and retrieval debugging."""

from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.common.resource_access import teacher_visible_resource_filter
from app.course_kb import service
from app.database import get_db
from app.job_models.models import LearningResource
from app.learning.models import KnowledgePoint

router = APIRouter(prefix="/api/teacher/courses", tags=["course-kb"])


class KbIngestRequest(BaseModel):
    # Text extracted client-side (covers pdf/docx/pptx), same as the existing
    # material question-generation flow.
    material_text: str = Field(default="", max_length=400000)


class KbStatusResponse(BaseModel):
    kb_status: str | None
    kb_error: str | None
    kb_chunk_count: int


class KbSearchHit(BaseModel):
    score: float
    chunk_type: str
    heading_path: list[str]
    text: str


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


async def _get_resource(db: AsyncSession, resource_id: uuid.UUID) -> LearningResource:
    resource = await db.get(LearningResource, resource_id)
    if resource is None or resource.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="资料不存在")
    return resource


@router.post("/{course_id}/materials/{resource_id}/kb-ingest", response_model=KbStatusResponse)
async def kb_ingest(
    course_id: uuid.UUID,
    resource_id: uuid.UUID,
    body: KbIngestRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> KbStatusResponse:
    """Start the chunk→embed→store pipeline for one material (async, returns at once)."""
    await _visible_course(db, course_id, user)
    resource = await _get_resource(db, resource_id)
    if not body.material_text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="资料文本为空，无法入库")

    resource.kb_status = "processing"
    resource.kb_error = None
    await db.commit()

    # Background pipeline with its own sessions; never blocks the upload UX.
    asyncio.create_task(
        service.ingest_material_text(resource_id=resource_id, course_kp_id=course_id, material_text=body.material_text)
    )
    return KbStatusResponse(kb_status="processing", kb_error=None, kb_chunk_count=0)


@router.get("/{course_id}/materials/{resource_id}/kb-status", response_model=KbStatusResponse)
async def kb_status(
    course_id: uuid.UUID,
    resource_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> KbStatusResponse:
    await _visible_course(db, course_id, user)
    resource = await _get_resource(db, resource_id)
    return KbStatusResponse(
        kb_status=resource.kb_status,
        kb_error=resource.kb_error,
        kb_chunk_count=resource.kb_chunk_count or 0,
    )


class KbStatsResponse(BaseModel):
    chunk_count: int
    ready_materials: int
    total_chunked_materials: int


@router.get("/{course_id}/kb/stats", response_model=KbStatsResponse)
async def kb_stats(
    course_id: uuid.UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> KbStatsResponse:
    """Course KB overview: how much retrievable knowledge the course has."""
    from sqlalchemy import func

    from app.course_kb.models import CourseMaterialChunk

    await _visible_course(db, course_id, user)
    chunk_count = (
        await db.execute(
            select(func.count(CourseMaterialChunk.id)).where(
                CourseMaterialChunk.course_kp_id == course_id,
                CourseMaterialChunk.deleted_at.is_(None),
            )
        )
    ).scalar() or 0
    node_ids = await service.course_node_ids(db, course_id)
    ready = (
        await db.execute(
            select(func.count(LearningResource.id)).where(
                LearningResource.node_id.in_(node_ids),
                LearningResource.node_type == "kp",
                LearningResource.kb_status == "ready",
                LearningResource.deleted_at.is_(None),
            )
        )
    ).scalar() or 0
    total = (
        await db.execute(
            select(func.count(LearningResource.id)).where(
                LearningResource.node_id.in_(node_ids),
                LearningResource.node_type == "kp",
                LearningResource.kb_status.isnot(None),
                LearningResource.deleted_at.is_(None),
            )
        )
    ).scalar() or 0
    return KbStatsResponse(chunk_count=chunk_count, ready_materials=ready, total_chunked_materials=total)


@router.get("/{course_id}/kb/search", response_model=list[KbSearchHit])
async def kb_search(
    course_id: uuid.UUID,
    q: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    k: int = 8,
) -> list[KbSearchHit]:
    """Debug retrieval endpoint (mirrors ArkLoop's KB search API)."""
    await _visible_course(db, course_id, user)
    hits = await service.search_chunks(db, course_kp_id=course_id, query=q, k=min(k, 20))
    return [
        KbSearchHit(score=h.score, chunk_type=h.chunk_type, heading_path=list(h.heading_path), text=h.text)
        for h in hits
    ]

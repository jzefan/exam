import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from . import service
from .router import Teacher, no_cache
from .schemas import ConfirmScore

router = APIRouter(prefix="/grading", dependencies=[Depends(no_cache)])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("/exams")
async def exams(user: Teacher, db: DB):
    return await service.exam_rows(db, user.id)


@router.get("/exams/{exam_id}/export")
async def export(exam_id: uuid.UUID, user: Teacher, db: DB):
    return Response(
        await service.export_csv(db, exam_id, user.id),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="chaoxing-grades.csv"',
            "Cache-Control": "no-store, private",
        },
    )


@router.get("/candidates/{candidate_id}")
async def detail(candidate_id: uuid.UUID, user: Teacher, db: DB, revision: int | None = Query(default=None, ge=1)):
    return await service.detail(db, candidate_id, user.id, revision)


@router.post("/candidates/{candidate_id}/grade")
async def grade(candidate_id: uuid.UUID, user: Teacher, db: DB):
    if not settings.chaoxing_enabled:
        raise HTTPException(503, "管理员尚未启用学习通评分队列")
    return await service.enqueue(db, candidate_id, user.id)


@router.post("/candidates/{candidate_id}/items/{item_id}/confirm")
async def confirm(candidate_id: uuid.UUID, item_id: uuid.UUID, payload: ConfirmScore, user: Teacher, db: DB):
    await service.confirm(db, candidate_id, item_id, user.id, payload)
    return await service.detail(db, candidate_id, user.id)

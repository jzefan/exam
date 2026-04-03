"""FastAPI router for knowledge management."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles
from app.auth.models import User
from app.database import get_db
from app.learning import service
from app.learning.schemas import (
    DirectionCreate,
    DirectionResponse,
    FlowData,
    KnowledgePointCreate,
    KnowledgePointUpdate,
    MajorCreate,
    MajorResponse,
    PrerequisiteCreate,
    RecommendationGenerateRequest,
    RecommendationGenerateResponse,
)

router = APIRouter()
DB = Annotated[AsyncSession, Depends(get_db)]
WriteUser = Annotated[User, require_roles("admin", "teacher")]


@router.get("/majors", response_model=list[MajorResponse])
async def list_majors(db: DB, _user: CurrentUser) -> list[MajorResponse]:
    majors = await service.list_majors(db)
    return [MajorResponse.model_validate(major) for major in majors]


@router.get("/majors/{major_id}", response_model=MajorResponse)
async def get_major(major_id: uuid.UUID, db: DB, _user: CurrentUser) -> MajorResponse:
    major = await service.get_major(db, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    return MajorResponse.model_validate(major)


@router.post("/majors", response_model=MajorResponse, status_code=201)
async def create_major(data: MajorCreate, db: DB, _: WriteUser) -> MajorResponse:
    major = await service.create_major(db, data)
    return MajorResponse.model_validate(major)


@router.put("/majors/{major_id}", response_model=MajorResponse)
async def update_major(major_id: uuid.UUID, data: MajorCreate, db: DB, _: WriteUser) -> MajorResponse:
    major = await service.get_major(db, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    major = await service.update_major(db, major, data.model_dump(exclude_unset=True))
    return MajorResponse.model_validate(major)


@router.delete("/majors/{major_id}", status_code=204)
async def delete_major(major_id: uuid.UUID, db: DB, _: WriteUser) -> None:
    major = await service.get_major(db, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    await service.soft_delete_major(db, major)


@router.get("/majors/{major_id}/directions", response_model=list[DirectionResponse])
async def list_directions(major_id: uuid.UUID, db: DB, _user: CurrentUser) -> list[DirectionResponse]:
    directions = await service.list_directions(db, major_id)
    return [DirectionResponse.model_validate(direction) for direction in directions]


@router.get("/directions/{direction_id}", response_model=DirectionResponse)
async def get_direction(direction_id: uuid.UUID, db: DB, _user: CurrentUser) -> DirectionResponse:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    return DirectionResponse.model_validate(direction)


@router.post("/directions", response_model=DirectionResponse, status_code=201)
async def create_direction(data: DirectionCreate, db: DB, _: WriteUser) -> DirectionResponse:
    direction = await service.create_direction(db, data)
    return DirectionResponse.model_validate(direction)


@router.put("/directions/{direction_id}", response_model=DirectionResponse)
async def update_direction(direction_id: uuid.UUID, data: DirectionCreate, db: DB, _: WriteUser) -> DirectionResponse:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    direction = await service.update_direction(db, direction, data.model_dump(exclude_unset=True))
    return DirectionResponse.model_validate(direction)


@router.delete("/directions/{direction_id}", status_code=204)
async def delete_direction(direction_id: uuid.UUID, db: DB, _: WriteUser) -> None:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    await service.soft_delete_direction(db, direction)


@router.get("/directions/{direction_id}/tree", response_model=FlowData)
async def get_tree(direction_id: uuid.UUID, db: DB, _user: CurrentUser) -> FlowData:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    try:
        data = await service.get_direction_tree(db, direction_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FlowData(**data)


@router.post("/knowledge-points", response_model=dict, status_code=201)
async def create_kp(data: KnowledgePointCreate, db: DB, _: WriteUser) -> dict[str, str]:
    kp = await service.create_knowledge_point(db, data)
    return {"id": str(kp.id), "name": kp.name}


@router.put("/knowledge-points/{kp_id}", response_model=dict)
async def update_kp(kp_id: uuid.UUID, data: KnowledgePointUpdate, db: DB, _: WriteUser) -> dict[str, str]:
    kp = await service.get_knowledge_point(db, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp = await service.update_knowledge_point(db, kp, data)
    return {"id": str(kp.id), "name": kp.name}


@router.delete("/knowledge-points/{kp_id}", status_code=204)
async def delete_kp(kp_id: uuid.UUID, db: DB, _: WriteUser) -> None:
    kp = await service.get_knowledge_point(db, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    await service.soft_delete_knowledge_point(db, kp)


@router.post("/knowledge-points/{kp_id}/prerequisites", response_model=dict, status_code=201)
async def add_prereq(kp_id: uuid.UUID, data: PrerequisiteCreate, db: DB, _: WriteUser) -> dict[str, str]:
    kp = await service.get_knowledge_point(db, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    try:
        prereq = await service.add_prerequisite(db, kp_id, data.from_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": str(prereq.id)}


@router.delete("/knowledge-points/{kp_id}/prerequisites/{prereq_id}", status_code=204)
async def remove_prereq(kp_id: uuid.UUID, prereq_id: uuid.UUID, db: DB, _: WriteUser) -> None:
    await service.remove_prerequisite(db, kp_id, prereq_id)


@router.post(
    "/knowledge-points/{kp_id}/recommendations/generate",
    response_model=RecommendationGenerateResponse,
)
async def generate_recommendations(
    kp_id: uuid.UUID,
    data: RecommendationGenerateRequest,
    db: DB,
    _user: CurrentUser,
) -> RecommendationGenerateResponse:
    kp = await service.get_knowledge_point(db, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    try:
        items = await service.generate_bilibili_recommendations(db, kp_id, data.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return RecommendationGenerateResponse(model=data.model, items=items)

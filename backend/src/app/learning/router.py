"""FastAPI router for knowledge management."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles, user_has_role
from app.auth.models import User
from app.common.resource_access import can_write_owned_resource
from app.database import get_db
from app.learning import service
from app.learning.schemas import (
    CatalogPhotoRecognizeRequest,
    CatalogPhotoRecognizeResponse,
    CourseOptionResponse,
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
WriteUser = Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher")]


async def _is_knowledge_admin(db: AsyncSession, user: User) -> bool:
    return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin")


def _ensure_can_write_kp(kp, user: User, is_admin: bool) -> None:
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=kp.owner_id,
    ):
        raise HTTPException(status_code=403, detail="No permission to modify this knowledge point")


async def _get_visible_kp_or_404(
    db: AsyncSession,
    kp_id: uuid.UUID,
    user: User,
    is_admin: bool,
):
    kp = await service.get_knowledge_point(db, kp_id, user=user, is_platform_admin=is_admin)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    return kp


@router.get("/majors", response_model=list[MajorResponse])
async def list_majors(db: DB, user: CurrentUser) -> list[MajorResponse]:
    majors = await service.list_majors(db, user=user, is_platform_admin=False)
    return [MajorResponse.model_validate(major) for major in majors]


@router.get("/majors/{major_id}", response_model=MajorResponse)
async def get_major(major_id: uuid.UUID, db: DB, user: CurrentUser) -> MajorResponse:
    major = await service.get_major(db, major_id, user=user, is_platform_admin=False)
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
async def list_directions(major_id: uuid.UUID, db: DB, user: CurrentUser) -> list[DirectionResponse]:
    directions = await service.list_directions(db, major_id, user=user, is_platform_admin=False)
    return [DirectionResponse.model_validate(direction) for direction in directions]


@router.get("/courses", response_model=list[CourseOptionResponse])
async def list_courses(db: DB, user: CurrentUser) -> list[CourseOptionResponse]:
    courses = await service.list_course_options(db, user=user, is_platform_admin=False)
    return [CourseOptionResponse.model_validate(course) for course in courses]


@router.get("/directions/{direction_id}", response_model=DirectionResponse)
async def get_direction(direction_id: uuid.UUID, db: DB, user: CurrentUser) -> DirectionResponse:
    direction = await service.get_direction(db, direction_id, user=user, is_platform_admin=False)
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
async def get_tree(direction_id: uuid.UUID, db: DB, user: CurrentUser) -> FlowData:
    direction = await service.get_direction(db, direction_id, user=user, is_platform_admin=False)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    try:
        data = await service.get_direction_tree(db, direction_id, user=user, is_platform_admin=False)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FlowData(**data)


@router.post("/knowledge-points", response_model=dict, status_code=201)
async def create_kp(data: KnowledgePointCreate, db: DB, user: WriteUser) -> dict[str, str]:
    if data.parent_id is not None:
        await _get_visible_kp_or_404(db, data.parent_id, user, False)
    kp = await service.create_knowledge_point(db, data, user.id)
    return {"id": str(kp.id), "name": kp.name, "owner_id": str(kp.owner_id), "visibility": kp.visibility.value}


@router.put("/knowledge-points/{kp_id}", response_model=dict)
async def update_kp(kp_id: uuid.UUID, data: KnowledgePointUpdate, db: DB, user: WriteUser) -> dict[str, str]:
    kp = await _get_visible_kp_or_404(db, kp_id, user, False)
    _ensure_can_write_kp(kp, user, False)
    kp = await service.update_knowledge_point(db, kp, data)
    return {"id": str(kp.id), "name": kp.name, "owner_id": str(kp.owner_id), "visibility": kp.visibility.value}


@router.delete("/knowledge-points/{kp_id}", status_code=204)
async def delete_kp(kp_id: uuid.UUID, db: DB, user: WriteUser) -> None:
    kp = await _get_visible_kp_or_404(db, kp_id, user, False)
    _ensure_can_write_kp(kp, user, False)
    await service.soft_delete_knowledge_point(db, kp)


@router.post("/knowledge-points/{kp_id}/prerequisites", response_model=dict, status_code=201)
async def add_prereq(kp_id: uuid.UUID, data: PrerequisiteCreate, db: DB, user: WriteUser) -> dict[str, str]:
    kp = await _get_visible_kp_or_404(db, kp_id, user, False)
    _ensure_can_write_kp(kp, user, False)
    await _get_visible_kp_or_404(db, data.from_id, user, False)
    try:
        prereq = await service.add_prerequisite(db, kp_id, data.from_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": str(prereq.id)}


@router.delete("/knowledge-points/{kp_id}/prerequisites/{prereq_id}", status_code=204)
async def remove_prereq(kp_id: uuid.UUID, prereq_id: uuid.UUID, db: DB, user: WriteUser) -> None:
    kp = await _get_visible_kp_or_404(db, kp_id, user, False)
    _ensure_can_write_kp(kp, user, False)
    await service.remove_prerequisite(db, kp_id, prereq_id)


@router.post(
    "/catalog-photo/recognize",
    response_model=CatalogPhotoRecognizeResponse,
)
async def recognize_catalog_photo(
    data: CatalogPhotoRecognizeRequest,
    user: WriteUser,
) -> CatalogPhotoRecognizeResponse:
    del user
    try:
        return await service.recognize_catalog_structure_from_images(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post(
    "/knowledge-points/{kp_id}/recommendations/generate",
    response_model=RecommendationGenerateResponse,
)
async def generate_recommendations(
    kp_id: uuid.UUID,
    data: RecommendationGenerateRequest,
    db: DB,
    user: CurrentUser,
) -> RecommendationGenerateResponse:
    await _get_visible_kp_or_404(db, kp_id, user, False)
    try:
        items = await service.generate_bilibili_recommendations(db, kp_id, data.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return RecommendationGenerateResponse(model=data.model, items=items)

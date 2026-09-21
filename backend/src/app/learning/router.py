"""FastAPI router for knowledge management."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles, user_has_role
from app.auth.models import User
from app.common.resource_access import can_write_owned_resource
from app.database import get_db
from app.learning import service
from app.learning.catalog_web import service as catalog_web_service
from app.learning.schemas import (
    CatalogPhotoRecognizeRequest,
    CatalogPhotoRecognizeResponse,
    CatalogWebFetchRequest,
    CatalogWebFetchResponse,
    CatalogWebRecognizeCoverRequest,
    CatalogWebRecognizeCoverResponse,
    CatalogWebSearchRequest,
    CatalogWebSearchResponse,
    CourseOptionResponse,
    DirectionCreate,
    DirectionResponse,
    FlowData,
    KnowledgePointCreate,
    KnowledgePointReorder,
    KnowledgePointUpdate,
    MajorCreate,
    MajorResponse,
    PrerequisiteCreate,
    RootKnowledgePointOptionResponse,
    RecommendationGenerateRequest,
    RecommendationGenerateResponse,
)

router = APIRouter()
DB = Annotated[AsyncSession, Depends(get_db)]
WriteUser = Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")]


async def _is_knowledge_admin(db: AsyncSession, user: User) -> bool:
    return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin", "enterprise_admin")


def _ensure_can_write_kp(kp, user: User, is_admin: bool) -> None:
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=kp.owner_id,
    ):
        raise HTTPException(status_code=403, detail="No permission to modify this knowledge point")


def _normalize_structure_name(name: str) -> str:
    return name.strip()


def _ensure_can_write_major(major, user: User, is_admin: bool) -> None:
    if is_admin:
        return
    if major.owner_id is not None and major.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No permission to modify this major")


def _ensure_can_write_direction(direction, user: User, is_admin: bool) -> None:
    if is_admin:
        return
    if direction.owner_id is not None and direction.owner_id != user.id:
        raise HTTPException(status_code=403, detail="No permission to modify this direction")


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
    is_admin = await _is_knowledge_admin(db, user)
    majors = await service.list_majors(db, user=user, is_platform_admin=is_admin)
    return [MajorResponse.model_validate(major) for major in majors]


@router.get("/majors/{major_id}", response_model=MajorResponse)
async def get_major(major_id: uuid.UUID, db: DB, user: CurrentUser) -> MajorResponse:
    is_admin = await _is_knowledge_admin(db, user)
    major = await service.get_major(db, major_id, user=user, is_platform_admin=is_admin)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    return MajorResponse.model_validate(major)


@router.post("/majors", response_model=MajorResponse, status_code=201)
async def create_major(data: MajorCreate, db: DB, user: WriteUser) -> MajorResponse:
    normalized_name = _normalize_structure_name(data.name)
    if await service.find_major_by_name_for_owner(db, owner_id=user.id, name=normalized_name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该专业名称已存在")
    major = await service.create_major(db, data.model_copy(update={"name": normalized_name}), user.id)
    return MajorResponse.model_validate(major)


@router.put("/majors/{major_id}", response_model=MajorResponse)
async def update_major(major_id: uuid.UUID, data: MajorCreate, db: DB, user: WriteUser) -> MajorResponse:
    major = await service.get_major(db, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    is_admin = await _is_knowledge_admin(db, user)
    _ensure_can_write_major(major, user, is_admin)
    normalized_name = _normalize_structure_name(data.name)
    if (
        major.owner_id is not None
        and await service.find_major_by_name_for_owner(
            db,
            owner_id=major.owner_id,
            name=normalized_name,
            exclude_id=major_id,
        )
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该专业名称已存在")
    if not is_admin and await service.major_has_foreign_knowledge_points(db, major_id, current_user_id=user.id):
        raise HTTPException(status_code=403, detail="No permission to modify this major")
    major = await service.update_major(db, major, data.model_copy(update={"name": normalized_name}).model_dump(exclude_unset=True))
    return MajorResponse.model_validate(major)


@router.delete("/majors/{major_id}", status_code=204)
async def delete_major(major_id: uuid.UUID, db: DB, user: WriteUser) -> None:
    major = await service.get_major(db, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    is_admin = await _is_knowledge_admin(db, user)
    _ensure_can_write_major(major, user, is_admin)
    if not is_admin and await service.major_has_foreign_knowledge_points(db, major_id, current_user_id=user.id):
        raise HTTPException(status_code=403, detail="No permission to modify this major")
    await service.soft_delete_major(db, major)


@router.get("/majors/{major_id}/directions", response_model=list[DirectionResponse])
async def list_directions(major_id: uuid.UUID, db: DB, user: CurrentUser) -> list[DirectionResponse]:
    is_admin = await _is_knowledge_admin(db, user)
    directions = await service.list_directions(db, major_id, user=user, is_platform_admin=is_admin)
    return [DirectionResponse.model_validate(direction) for direction in directions]


@router.get("/courses", response_model=list[CourseOptionResponse])
async def list_courses(db: DB, user: CurrentUser) -> list[CourseOptionResponse]:
    is_admin = await _is_knowledge_admin(db, user)
    courses = await service.list_course_options(db, user=user, is_platform_admin=is_admin)
    return [CourseOptionResponse.model_validate(course) for course in courses]


@router.get("/root-knowledge-points", response_model=list[RootKnowledgePointOptionResponse])
async def list_root_knowledge_points(db: DB, user: CurrentUser) -> list[RootKnowledgePointOptionResponse]:
    is_admin = await _is_knowledge_admin(db, user)
    roots = await service.list_root_knowledge_point_options(db, user=user, is_platform_admin=is_admin)
    return [RootKnowledgePointOptionResponse.model_validate(root) for root in roots]


@router.get("/directions/{direction_id}", response_model=DirectionResponse)
async def get_direction(direction_id: uuid.UUID, db: DB, user: CurrentUser) -> DirectionResponse:
    is_admin = await _is_knowledge_admin(db, user)
    direction = await service.get_direction(db, direction_id, user=user, is_platform_admin=is_admin)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    return DirectionResponse.model_validate(direction)


@router.post("/directions", response_model=DirectionResponse, status_code=201)
async def create_direction(data: DirectionCreate, db: DB, user: WriteUser) -> DirectionResponse:
    normalized_name = _normalize_structure_name(data.name)
    if await service.find_direction_by_name_for_owner(
        db,
        owner_id=user.id,
        major_id=data.major_id,
        name=normalized_name,
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该方向名称已存在")
    direction = await service.create_direction(db, data.model_copy(update={"name": normalized_name}), user.id)
    return DirectionResponse.model_validate(direction)


@router.put("/directions/{direction_id}", response_model=DirectionResponse)
async def update_direction(direction_id: uuid.UUID, data: DirectionCreate, db: DB, user: WriteUser) -> DirectionResponse:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    is_admin = await _is_knowledge_admin(db, user)
    _ensure_can_write_direction(direction, user, is_admin)
    normalized_name = _normalize_structure_name(data.name)
    if (
        direction.owner_id is not None
        and await service.find_direction_by_name_for_owner(
            db,
            owner_id=direction.owner_id,
            major_id=data.major_id,
            name=normalized_name,
            exclude_id=direction_id,
        )
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该方向名称已存在")
    if not is_admin and await service.direction_has_foreign_knowledge_points(db, direction_id, current_user_id=user.id):
        raise HTTPException(status_code=403, detail="No permission to modify this direction")
    direction = await service.update_direction(
        db,
        direction,
        data.model_copy(update={"name": normalized_name}).model_dump(exclude_unset=True),
    )
    return DirectionResponse.model_validate(direction)


@router.delete("/directions/{direction_id}", status_code=204)
async def delete_direction(direction_id: uuid.UUID, db: DB, user: WriteUser) -> None:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    is_admin = await _is_knowledge_admin(db, user)
    _ensure_can_write_direction(direction, user, is_admin)
    if not is_admin and await service.direction_has_foreign_knowledge_points(db, direction_id, current_user_id=user.id):
        raise HTTPException(status_code=403, detail="No permission to modify this direction")
    await service.soft_delete_direction(db, direction)


@router.get("/directions/{direction_id}/tree", response_model=FlowData)
async def get_tree(direction_id: uuid.UUID, db: DB, user: CurrentUser) -> FlowData:
    is_admin = await _is_knowledge_admin(db, user)
    direction = await service.get_direction(db, direction_id, user=user, is_platform_admin=is_admin)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    try:
        data = await service.get_direction_tree(db, direction_id, user=user, is_platform_admin=is_admin)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FlowData(**data)


@router.post("/knowledge-points", response_model=dict, status_code=201)
async def create_kp(data: KnowledgePointCreate, db: DB, user: WriteUser) -> dict[str, str]:
    is_admin = await _is_knowledge_admin(db, user)
    normalized_name = data.name.strip()
    data = data.model_copy(update={"name": normalized_name})
    if data.parent_id is not None:
        await _get_visible_kp_or_404(db, data.parent_id, user, is_admin)
    else:
        direction = await service.get_direction(db, data.direction_id, user=user, is_platform_admin=is_admin)
        if not direction:
            raise HTTPException(status_code=404, detail="Direction not found")
        if await service.find_root_knowledge_by_name_for_owner_in_major(
            db,
            owner_id=user.id,
            major_id=direction.major_id,
            name=normalized_name,
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该专业下已存在同名主知识点")
    kp = await service.create_knowledge_point(db, data, user.id)
    return {"id": str(kp.id), "name": kp.name, "owner_id": str(kp.owner_id), "visibility": kp.visibility.value}


@router.put("/knowledge-points/{kp_id}", response_model=dict)
async def update_kp(kp_id: uuid.UUID, data: KnowledgePointUpdate, db: DB, user: WriteUser) -> dict[str, str]:
    is_admin = await _is_knowledge_admin(db, user)
    kp = await _get_visible_kp_or_404(db, kp_id, user, is_admin)
    _ensure_can_write_kp(kp, user, is_admin)
    if data.name is not None:
        data = data.model_copy(update={"name": data.name.strip()})
    next_parent_id = data.parent_id if "parent_id" in data.model_fields_set else kp.parent_id
    if (data.name is not None or "parent_id" in data.model_fields_set) and next_parent_id is None and kp.direction_id is not None:
        next_name = data.name.strip() if data.name is not None else kp.name
        direction = await service.get_direction(db, kp.direction_id, user=user, is_platform_admin=is_admin)
        if not direction:
            raise HTTPException(status_code=404, detail="Direction not found")
        if await service.find_root_knowledge_by_name_for_owner_in_major(
            db,
            owner_id=kp.owner_id,
            major_id=direction.major_id,
            name=next_name,
            exclude_id=kp_id,
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该专业下已存在同名主知识点")
    if "parent_id" in data.model_fields_set:
        parent = None
        if data.parent_id is not None:
            if data.parent_id == kp.id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能移动到自身下")
            parent = await _get_visible_kp_or_404(db, data.parent_id, user, is_admin)
            if await service.is_descendant_knowledge_point(db, ancestor_id=kp.id, node_id=parent.id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能移动到自己的下级知识点下")
        kp = await service.reparent_knowledge_point(db, kp, parent)
    kp = await service.update_knowledge_point(db, kp, data)
    return {"id": str(kp.id), "name": kp.name, "owner_id": str(kp.owner_id), "visibility": kp.visibility.value}


@router.post("/knowledge-points/{kp_id}/reorder", response_model=dict)
async def reorder_kp(
    kp_id: uuid.UUID,
    data: KnowledgePointReorder,
    db: DB,
    user: WriteUser,
) -> dict[str, str]:
    """把知识点移到目标父节点下，并按 `ordered_ids` 重排同级顺序。

    同时覆盖两种操作：「同级上移 / 下移」与「拖到别的目录下成为子目录」。
    """

    is_admin = await _is_knowledge_admin(db, user)
    kp = await _get_visible_kp_or_404(db, kp_id, user, is_admin)
    _ensure_can_write_kp(kp, user, is_admin)

    if kp_id not in set(data.ordered_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="排序列表中必须包含被移动的知识点",
        )

    parent = None
    if data.parent_id is not None:
        if data.parent_id == kp.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能移动到自身下")
        parent = await _get_visible_kp_or_404(db, data.parent_id, user, is_admin)
        if await service.is_descendant_knowledge_point(db, ancestor_id=kp.id, node_id=parent.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不能移动到自己的下级知识点下",
            )

    # 先校验再落库：避免排序列表有问题时已经改掉了 parent_id。
    target_parent_id = parent.id if parent else None
    siblings = await service.list_child_knowledge_points(db, target_parent_id)
    allowed = {sibling.id for sibling in siblings} | {kp.id}
    if any(node_id not in allowed for node_id in data.ordered_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="排序列表中存在不属于该父节点的知识点",
        )

    if kp.parent_id != target_parent_id:
        kp = await service.reparent_knowledge_point(db, kp, parent)
    await service.apply_sibling_order(db, target_parent_id, data.ordered_ids)

    return {
        "id": str(kp.id),
        "name": kp.name,
        "parent_id": str(kp.parent_id) if kp.parent_id is not None else "",
        "owner_id": str(kp.owner_id),
        "visibility": kp.visibility.value,
    }


@router.delete("/knowledge-points/{kp_id}", status_code=204)
async def delete_kp(kp_id: uuid.UUID, db: DB, user: WriteUser) -> None:
    is_admin = await _is_knowledge_admin(db, user)
    kp = await _get_visible_kp_or_404(db, kp_id, user, is_admin)
    _ensure_can_write_kp(kp, user, is_admin)
    await service.soft_delete_knowledge_point(db, kp)


@router.post("/knowledge-points/{kp_id}/prerequisites", response_model=dict, status_code=201)
async def add_prereq(kp_id: uuid.UUID, data: PrerequisiteCreate, db: DB, user: WriteUser) -> dict[str, str]:
    is_admin = await _is_knowledge_admin(db, user)
    kp = await _get_visible_kp_or_404(db, kp_id, user, is_admin)
    _ensure_can_write_kp(kp, user, is_admin)
    await _get_visible_kp_or_404(db, data.from_id, user, is_admin)
    try:
        prereq = await service.add_prerequisite(db, kp_id, data.from_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": str(prereq.id)}


@router.delete("/knowledge-points/{kp_id}/prerequisites/{prereq_id}", status_code=204)
async def remove_prereq(kp_id: uuid.UUID, prereq_id: uuid.UUID, db: DB, user: WriteUser) -> None:
    is_admin = await _is_knowledge_admin(db, user)
    kp = await _get_visible_kp_or_404(db, kp_id, user, is_admin)
    _ensure_can_write_kp(kp, user, is_admin)
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
    "/catalog-web/recognize-cover",
    response_model=CatalogWebRecognizeCoverResponse,
)
async def recognize_catalog_cover(
    data: CatalogWebRecognizeCoverRequest,
    user: WriteUser,
) -> CatalogWebRecognizeCoverResponse:
    """从书籍封面读出书名 / 版次 / 作者 / 出版社。"""

    del user
    try:
        parsed = await catalog_web_service.recognize_book_cover(data.image)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return CatalogWebRecognizeCoverResponse(**parsed)


@router.post(
    "/catalog-web/search",
    response_model=CatalogWebSearchResponse,
)
async def search_catalog_books(
    data: CatalogWebSearchRequest,
    user: WriteUser,
) -> CatalogWebSearchResponse:
    """按书名 / ISBN 检索候选图书，供用户确认是哪一本。"""

    del user
    try:
        candidates = await catalog_web_service.search_book_candidates(data.keyword, limit=data.limit)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return CatalogWebSearchResponse(candidates=candidates)


@router.post(
    "/catalog-web/fetch",
    response_model=CatalogWebFetchResponse,
)
async def fetch_catalog_from_web(
    data: CatalogWebFetchRequest,
    user: WriteUser,
) -> CatalogWebFetchResponse:
    """获取目录：有出版社优先走出版社官网，否则由大模型推断。"""

    del user
    try:
        result = await catalog_web_service.fetch_catalog(
            title=data.title,
            edition=data.edition or "",
            author=data.author or "",
            publisher=data.publisher or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return CatalogWebFetchResponse(
        paths=result.paths,
        source=result.source,
        source_url=result.source_url,
        publisher_site=result.publisher_site,
        notes=result.notes,
    )


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
    is_admin = await _is_knowledge_admin(db, user)
    await _get_visible_kp_or_404(db, kp_id, user, is_admin)
    try:
        items = await service.generate_bilibili_recommendations(db, kp_id, data.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return RecommendationGenerateResponse(model=data.model, items=items)

"""API routes for job competency model management."""

import asyncio
import html
import logging
import re
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.job_models.schemas import (
    DimensionCreate,
    DimensionResponse,
    DimensionUpdate,
    JobModelCreate,
    JobModelResponse,
    JobModelSummary,
    JobModelUpdate,
    JobModelVersionListItem,
    JobModelVersionResponse,
    LearningResourceCreate,
    LearningResourceResponse,
    LearningResourceUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    SkillKnowledgePointResponse,
    SkillKnowledgePointUpdate,
    SkillResponse,
    SkillUpdate,
    TemplateCreate,
    TemplateResponse,
    TemplateUpdate,
)
from app.job_models.editor_service import (
    bulk_set_kp_difficulty,
    bulk_set_skill_level,
    move_skill_to_dimension,
    reorder_dimensions,
    reorder_knowledge_points,
    reorder_skills,
)
from app.job_models.service import (
    build_skill_match,
    create_enterprise_model_from_standard,
    create_dimension,
    create_job_model,
    create_knowledge_point,
    create_skill,
    create_template,
    delete_dimension,
    delete_job_model,
    delete_knowledge_point,
    delete_skill,
    get_job_model_at_version,
    get_job_model_by_id,
    get_template_by_id,
    list_all_job_models,
    list_job_model_facets,
    list_job_model_versions,
    list_templates,
    publish_new_version,
    recommend_standard_model,
    save_model_as_template,
    update_dimension,
    update_job_model,
    update_knowledge_point,
    update_skill,
    update_template,
)
from app.rbac.dependencies import CurrentOrgId
from pydantic import BaseModel, Field
model_router = APIRouter()
template_router = APIRouter()
logger = logging.getLogger(__name__)

DbSession = Annotated[AsyncSession, Depends(get_db)]


class BilibiliSearchResult(BaseModel):
    bvid: str
    title: str
    author: str
    play: int
    duration: str
    pic: str
    description: str


class RecommendStandardRequest(BaseModel):
    job_text: str


class RecommendStandardResponse(BaseModel):
    model: JobModelSummary
    rationale: str
    confidence: float = 0.0
    matched_keywords: list[str] = []


class AddedSkillInput(BaseModel):
    name: str = Field(max_length=200)
    level: str | None = None
    dimension_id: uuid.UUID | None = None
    dimension_name: str | None = Field(default=None, max_length=200)


def _parse_bilibili_search_results(items: list[dict]) -> list[BilibiliSearchResult]:
    results: list[BilibiliSearchResult] = []
    for item in items:
        bvid = item.get("bvid", "")
        if not bvid:
            continue
        title = html.unescape(re.sub(r"<[^>]+>", "", item.get("title", "")))
        pic = item.get("pic", "")
        if pic.startswith("//"):
            pic = "https:" + pic
        results.append(
            BilibiliSearchResult(
                bvid=bvid,
                title=title,
                author=item.get("author", ""),
                play=item.get("play", 0),
                duration=item.get("duration", ""),
                pic=pic,
                description=item.get("description", "")[:200],
            )
        )
    return results


class AddedKnowledgePointInput(BaseModel):
    name: str = Field(max_length=200)
    parent_skill_id: uuid.UUID | None = None
    parent_skill_name: str | None = Field(default=None, max_length=200)


class EnterpriseCopyCreate(BaseModel):
    enterprise_name: str
    version_note: str | None = None
    selected_standard_skill_ids: list[uuid.UUID] | None = None
    selected_standard_kp_ids: list[uuid.UUID] | None = None
    added_skills: list[AddedSkillInput] = []
    added_knowledge_points: list[AddedKnowledgePointInput] = []


class EnterpriseCopyResponse(BaseModel):
    job_model_id: uuid.UUID
    version_id: uuid.UUID


class MatchSkillsRequest(BaseModel):
    job_text: str


class MatchedKpItem(BaseModel):
    id: uuid.UUID
    name: str
    difficulty: str | None = None
    status: str  # "matched" | "extra"
    jd_kp_name: str | None = None


class MatchedSkillItem(BaseModel):
    id: uuid.UUID
    name: str
    level: str | None = None
    status: str  # "matched" | "extra"
    jd_skill_name: str | None = None
    knowledge_points: list[MatchedKpItem] = []


class MatchDimensionItem(BaseModel):
    id: uuid.UUID
    name: str
    skills: list[MatchedSkillItem] = []


class MissingSkillItem(BaseModel):
    name: str
    suggested_level: str | None = None
    dimension_hint: str | None = None
    missing_kps: list[str] = []


class MissingKpItem(BaseModel):
    name: str
    parent_skill_hint_id: uuid.UUID | None = None
    parent_skill_hint_name: str | None = None


class MatchSkillsResponse(BaseModel):
    dimensions: list[MatchDimensionItem] = []
    missing_skills: list[MissingSkillItem] = []
    missing_knowledge_points: list[MissingKpItem] = []


@model_router.post("", response_model=JobModelResponse, status_code=status.HTTP_201_CREATED)
async def create_model(
    body: JobModelCreate,
    db: DbSession,
    user: CurrentUser,
    org_id: CurrentOrgId,
) -> JobModelResponse:
    model = await create_job_model(db, org_id, user.id, body)
    await db.commit()
    loaded = await get_job_model_by_id(db, model.id)
    return JobModelResponse.model_validate(loaded)


@model_router.get("/facets")
async def list_models_facets(
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> list[dict]:
    """Lightweight aggregate for the filter tree: industry/direction/type counts."""
    return await list_job_model_facets(db, org_id=org_id)


@model_router.get("")
async def list_all_models(
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
    _start: int = Query(0, ge=0),
    _end: int = Query(50, ge=1),
    model_type: str | None = Query(None),
    industry_name: str | None = Query(None),
    direction_name: str | None = Query(None),
    response: Response = None,
) -> list[JobModelSummary]:
    """List all job models in the organization."""
    skip = _start
    limit = _end - _start if _end > _start else 50
    models, total = await list_all_job_models(
        db,
        org_id=org_id,
        skip=skip,
        limit=limit,
        model_type=model_type,
        industry_name=industry_name,
        direction_name=direction_name,
    )

    # Set total count header for pagination
    response.headers["X-Total-Count"] = str(total)

    return [JobModelSummary.model_validate(m) for m in models]


@model_router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    await delete_job_model(db, model)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@model_router.post("/recommend-standard", response_model=RecommendStandardResponse)
async def recommend_standard(
    body: RecommendStandardRequest,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> RecommendStandardResponse:
    text = body.job_text.strip()
    if len(text) < 4:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="岗位描述太短，请至少输入 4 个字。",
        )
    result = await recommend_standard_model(db, text, org_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未匹配到合适的标准岗位，请补充更具体的岗位职责或技能关键词。",
        )
    model, rationale, confidence, keywords = result
    return RecommendStandardResponse(
        model=JobModelSummary.model_validate(model),
        rationale=rationale,
        confidence=confidence,
        matched_keywords=keywords,
    )


@model_router.get("/bilibili-cover")
async def proxy_bilibili_cover(
    url: str = Query(...),
) -> Response:
    """Proxy Bilibili cover images to avoid hotlink protection."""
    import httpx as _httpx

    if not url or not any(url.startswith(p) for p in ("https://i", "http://i")):
        raise HTTPException(status_code=400, detail="Invalid URL")

    async with _httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, headers={"Referer": "https://www.bilibili.com"})
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch image")
        return Response(
            content=resp.content,
            media_type=resp.headers.get("content-type", "image/jpeg"),
            headers={"Cache-Control": "public, max-age=86400"},
        )


_BILI_CACHE_TTL_SECONDS = 60.0
_bili_search_cache: dict[tuple[str, int], tuple[float, list["BilibiliSearchResult"]]] = {}
_bili_search_lock = asyncio.Lock()


async def _bilibili_search_via_library(keyword: str, page: int) -> list[dict]:
    """Call bilibili-api-python which handles WBI signing + buvid cookies."""
    from bilibili_api import search

    raw = await search.search_by_type(
        keyword=keyword,
        search_type=search.SearchObjectType.VIDEO,
        page=page,
    )
    return raw.get("result", []) or []


@model_router.get("/search-videos", response_model=list[BilibiliSearchResult])
async def search_bilibili_videos(
    _user: CurrentUser,
    keyword: str = Query(..., min_length=1, max_length=100),
    page: int = Query(1, ge=1, le=10),
) -> list["BilibiliSearchResult"]:
    """Search Bilibili for educational videos by keyword.

    Uses bilibili-api-python which handles WBI signing and buvid3 cookies to
    avoid the -412/-352 risk-control rejection that plain HTTP calls hit.
    Results are cached for 60s per (keyword, page) to reduce request rate.
    """
    cache_key = (keyword.strip(), page)
    now = time.monotonic()
    cached = _bili_search_cache.get(cache_key)
    if cached and now - cached[0] < _BILI_CACHE_TTL_SECONDS:
        return cached[1]

    async with _bili_search_lock:
        cached = _bili_search_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < _BILI_CACHE_TTL_SECONDS:
            return cached[1]

        try:
            items = await _bilibili_search_via_library(keyword, page)
        except Exception as exc:  # bilibili_api raises various subclasses; degrade gracefully
            logger.warning("Bilibili video search failed for keyword=%r page=%d: %s", keyword, page, exc)
            return []

        results = _parse_bilibili_search_results(items)
        _bili_search_cache[cache_key] = (time.monotonic(), results)

        if len(_bili_search_cache) > 256:
            cutoff = time.monotonic() - _BILI_CACHE_TTL_SECONDS
            for key, (ts, _) in list(_bili_search_cache.items()):
                if ts < cutoff:
                    _bili_search_cache.pop(key, None)

        return results


@model_router.post("/{model_id}/create-enterprise-copy", response_model=EnterpriseCopyResponse, status_code=status.HTTP_201_CREATED)
async def create_enterprise_copy(
    model_id: uuid.UUID,
    body: EnterpriseCopyCreate,
    db: DbSession,
    user: CurrentUser,
    org_id: CurrentOrgId,
) -> EnterpriseCopyResponse:
    standard = await get_job_model_by_id(db, model_id)
    if standard is None or standard.model_type != "standard":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到指定的标准岗位。")
    if standard.org_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权从其他组织复制标准岗位。")

    selected_ids: set[uuid.UUID] | None = (
        set(body.selected_standard_skill_ids)
        if body.selected_standard_skill_ids is not None
        else None
    )
    selected_kp_ids: set[uuid.UUID] | None = (
        set(body.selected_standard_kp_ids)
        if body.selected_standard_kp_ids is not None
        else None
    )
    added_skills_payload = [item.model_dump() for item in body.added_skills]
    added_kps_payload = [item.model_dump() for item in body.added_knowledge_points]

    created_model, created_version = await create_enterprise_model_from_standard(
        db,
        standard,
        enterprise_name=body.enterprise_name,
        org_id=org_id,
        user_id=user.id,
        version_note=body.version_note,
        selected_standard_skill_ids=selected_ids,
        selected_standard_kp_ids=selected_kp_ids,
        added_skills=added_skills_payload,
        added_knowledge_points=added_kps_payload,
    )
    await db.commit()
    return EnterpriseCopyResponse(
        job_model_id=created_model.id,
        version_id=created_version.id,
    )


@model_router.post("/{model_id}/match-skills", response_model=MatchSkillsResponse)
async def match_skills(
    model_id: uuid.UUID,
    body: MatchSkillsRequest,
    db: DbSession,
    _user: CurrentUser,
    org_id: CurrentOrgId,
) -> MatchSkillsResponse:
    text = body.job_text.strip()
    if len(text) < 4:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="岗位描述太短，请至少输入 4 个字。",
        )
    standard = await get_job_model_by_id(db, model_id)
    if standard is None or standard.model_type != "standard":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到指定的标准岗位。",
        )
    if standard.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权访问其他组织的标准岗位。",
        )
    try:
        result = await build_skill_match(db, standard, text)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc) or "标准岗位尚未发布版本，无法进行技能对照。",
        ) from exc
    return MatchSkillsResponse(**result)


@model_router.get("/{model_id}", response_model=JobModelResponse)
async def get_model_detail(
    model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return JobModelResponse.model_validate(model)


@model_router.patch("/{model_id}", response_model=JobModelResponse)
async def update_model(
    model_id: uuid.UUID,
    body: JobModelUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    updated = await update_job_model(db, model, body)
    await db.commit()
    loaded = await get_job_model_by_id(db, updated.id)
    return JobModelResponse.model_validate(loaded)


@model_router.post("/{model_id}/publish", response_model=JobModelResponse)
async def publish_model_version(
    model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
    version_note: str | None = Query(None),
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    new_model = await publish_new_version(db, model, version_note=version_note)
    await db.commit()
    loaded = await get_job_model_by_id(db, new_model.id)
    return JobModelResponse.model_validate(loaded)


@model_router.get("/{model_id}/versions", response_model=list[JobModelVersionListItem])
async def list_versions(
    model_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> list[JobModelVersionListItem]:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    pairs = await list_job_model_versions(db, model_id)
    return [
        JobModelVersionListItem(
            id=ver.id,
            job_model_id=ver.job_model_id,
            version=ver.version,
            version_note=ver.version_note,
            is_current=ver.is_current,
            source_type=ver.source_type,
            created_by=ver.created_by,
            published_at=ver.published_at,
            created_at=ver.created_at,
            updated_at=ver.updated_at,
            created_by_name=name,
        )
        for ver, name in pairs
    ]


@model_router.get("/{model_id}/versions/{version_id}", response_model=JobModelResponse)
async def get_version(
    model_id: uuid.UUID,
    version_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> JobModelResponse:
    result = await get_job_model_at_version(db, model_id, version_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    model, version = result
    payload = JobModelResponse.model_validate(model)
    return payload.model_copy(
        update={"current_version": JobModelVersionResponse.model_validate(version)}
    )


@model_router.post("/{model_id}/save-as-template", response_model=TemplateResponse)
async def save_as_template(
    model_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    name: str = Query(...),
) -> TemplateResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    template = await save_model_as_template(db, model, name=name, user_id=user.id)
    await db.commit()
    return TemplateResponse.model_validate(template)


@model_router.post("/{model_id}/dimensions", response_model=DimensionResponse, status_code=status.HTTP_201_CREATED)
async def add_dimension(
    model_id: uuid.UUID,
    body: DimensionCreate,
    db: DbSession,
    _user: CurrentUser,
) -> DimensionResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None or model.current_version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    dim = await create_dimension(db, model.current_version.id, body)
    await db.commit()
    # Reload with skills
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.job_models.models import CompetencyDimension, Skill

    result = await db.execute(
        select(CompetencyDimension)
        .where(CompetencyDimension.id == dim.id)
        .options(selectinload(CompetencyDimension.skills).selectinload(Skill.knowledge_points))
    )
    loaded_dim = result.scalar_one()
    return DimensionResponse.model_validate(loaded_dim)


@model_router.patch("/dimensions/{dimension_id}", response_model=DimensionResponse)
async def update_dim(
    dimension_id: uuid.UUID,
    body: DimensionUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> DimensionResponse:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.job_models.models import CompetencyDimension, Skill

    result = await db.execute(
        select(CompetencyDimension)
        .where(CompetencyDimension.id == dimension_id)
        .options(selectinload(CompetencyDimension.skills).selectinload(Skill.knowledge_points))
    )
    dim = result.scalar_one_or_none()
    if dim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dimension not found")
    updated = await update_dimension(db, dim, body)
    await db.commit()
    result2 = await db.execute(
        select(CompetencyDimension)
        .where(CompetencyDimension.id == updated.id)
        .options(selectinload(CompetencyDimension.skills).selectinload(Skill.knowledge_points))
    )
    loaded = result2.scalar_one()
    return DimensionResponse.model_validate(loaded)


@model_router.delete("/dimensions/{dimension_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_dimension(
    dimension_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    from sqlalchemy import select
    from app.job_models.models import CompetencyDimension

    result = await db.execute(select(CompetencyDimension).where(CompetencyDimension.id == dimension_id))
    dim = result.scalar_one_or_none()
    if dim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dimension not found")
    await delete_dimension(db, dim)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@model_router.post("/dimensions/{dimension_id}/skills", response_model=SkillResponse, status_code=status.HTTP_201_CREATED)
async def add_skill(
    dimension_id: uuid.UUID,
    body: SkillCreate,
    db: DbSession,
    _user: CurrentUser,
) -> SkillResponse:
    from sqlalchemy import select
    from app.job_models.models import CompetencyDimension

    result = await db.execute(select(CompetencyDimension).where(CompetencyDimension.id == dimension_id))
    dim = result.scalar_one_or_none()
    if dim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dimension not found")
    skill = await create_skill(db, dimension_id, body)
    await db.commit()
    from sqlalchemy.orm import selectinload
    from app.job_models.models import Skill

    result2 = await db.execute(
        select(Skill)
        .where(Skill.id == skill.id)
        .options(selectinload(Skill.knowledge_points))
    )
    loaded = result2.scalar_one()
    return SkillResponse.model_validate(loaded)


@model_router.patch("/skills/{skill_id}", response_model=SkillResponse)
async def update_skill_endpoint(
    skill_id: uuid.UUID,
    body: SkillUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> SkillResponse:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.job_models.models import Skill

    result = await db.execute(
        select(Skill).where(Skill.id == skill_id).options(selectinload(Skill.knowledge_points))
    )
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    updated = await update_skill(db, skill, body)
    await db.commit()
    result2 = await db.execute(
        select(Skill).where(Skill.id == updated.id).options(selectinload(Skill.knowledge_points))
    )
    loaded = result2.scalar_one()
    return SkillResponse.model_validate(loaded)


@model_router.delete("/skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_skill(
    skill_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    from sqlalchemy import select
    from app.job_models.models import Skill

    result = await db.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    await delete_skill(db, skill)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@model_router.post("/skills/{skill_id}/knowledge-points", response_model=SkillKnowledgePointResponse, status_code=status.HTTP_201_CREATED)
async def add_knowledge_point(
    skill_id: uuid.UUID,
    body: SkillKnowledgePointCreate,
    db: DbSession,
    _user: CurrentUser,
) -> SkillKnowledgePointResponse:
    from sqlalchemy import select
    from app.job_models.models import Skill

    result = await db.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found")
    kp = await create_knowledge_point(db, skill_id, body)
    await db.commit()
    return SkillKnowledgePointResponse.model_validate(kp)


@model_router.patch("/knowledge-points/{kp_id}", response_model=SkillKnowledgePointResponse)
async def update_kp(
    kp_id: uuid.UUID,
    body: SkillKnowledgePointUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> SkillKnowledgePointResponse:
    from sqlalchemy import select
    from app.job_models.models import SkillKnowledgePoint

    result = await db.execute(select(SkillKnowledgePoint).where(SkillKnowledgePoint.id == kp_id))
    kp = result.scalar_one_or_none()
    if kp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge point not found")
    updated = await update_knowledge_point(db, kp, body)
    await db.commit()
    return SkillKnowledgePointResponse.model_validate(updated)


@model_router.delete("/knowledge-points/{kp_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_knowledge_point(
    kp_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    from sqlalchemy import select
    from app.job_models.models import SkillKnowledgePoint

    result = await db.execute(select(SkillKnowledgePoint).where(SkillKnowledgePoint.id == kp_id))
    kp = result.scalar_one_or_none()
    if kp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge point not found")
    await delete_knowledge_point(db, kp)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Editor Request Models ---


class ReorderRequest(BaseModel):
    order_map: dict[str, int]  # {id: sort_order}


class MoveSkillRequest(BaseModel):
    skill_id: uuid.UUID
    target_dimension_id: uuid.UUID


class BulkSetLevelRequest(BaseModel):
    skill_ids: list[uuid.UUID]
    level: str


class BulkSetDifficultyRequest(BaseModel):
    kp_ids: list[uuid.UUID]
    difficulty: str


# --- Editor Routes ---


@model_router.post("/{model_id}/reorder-dimensions", response_model=list[DimensionResponse])
async def reorder_dimensions_ep(
    model_id: uuid.UUID,
    body: ReorderRequest,
    db: DbSession,
    _user: CurrentUser,
) -> list[DimensionResponse]:
    """Reorder dimensions within a model."""
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    order_map = {uuid.UUID(k): v for k, v in body.order_map.items()}
    dimensions = await reorder_dimensions(db, model_id, order_map)
    await db.commit()
    return [DimensionResponse.model_validate(d) for d in dimensions]


@model_router.post("/dimensions/{dimension_id}/reorder-skills", response_model=list[SkillResponse])
async def reorder_skills_ep(
    dimension_id: uuid.UUID,
    body: ReorderRequest,
    db: DbSession,
    _user: CurrentUser,
) -> list[SkillResponse]:
    """Reorder skills within a dimension."""
    order_map = {uuid.UUID(k): v for k, v in body.order_map.items()}
    skills = await reorder_skills(db, dimension_id, order_map)
    await db.commit()
    return [SkillResponse.model_validate(s) for s in skills]


@model_router.post("/skills/{skill_id}/reorder-kps", response_model=list[SkillKnowledgePointResponse])
async def reorder_kps_ep(
    skill_id: uuid.UUID,
    body: ReorderRequest,
    db: DbSession,
    _user: CurrentUser,
) -> list[SkillKnowledgePointResponse]:
    """Reorder knowledge points within a skill."""
    order_map = {uuid.UUID(k): v for k, v in body.order_map.items()}
    kps = await reorder_knowledge_points(db, skill_id, order_map)
    await db.commit()
    return [SkillKnowledgePointResponse.model_validate(kp) for kp in kps]


@model_router.post("/move-skill", response_model=SkillResponse)
async def move_skill_ep(
    body: MoveSkillRequest,
    db: DbSession,
    _user: CurrentUser,
) -> SkillResponse:
    """Move a skill to a different dimension."""
    from sqlalchemy.orm import selectinload
    from app.job_models.models import Skill

    skill = await move_skill_to_dimension(db, body.skill_id, body.target_dimension_id)
    await db.commit()
    from sqlalchemy import select as sa_select
    result = await db.execute(
        sa_select(Skill).where(Skill.id == skill.id).options(selectinload(Skill.knowledge_points))
    )
    loaded = result.scalar_one()
    return SkillResponse.model_validate(loaded)


@model_router.post("/bulk-set-skill-level", response_model=dict[str, int])
async def bulk_set_level_ep(
    body: BulkSetLevelRequest,
    db: DbSession,
    _user: CurrentUser,
) -> dict[str, int]:
    """Set skill level for multiple skills."""
    count = await bulk_set_skill_level(db, body.skill_ids, body.level)
    await db.commit()
    return {"updated": count}


@model_router.post("/bulk-set-kp-difficulty", response_model=dict[str, int])
async def bulk_set_difficulty_ep(
    body: BulkSetDifficultyRequest,
    db: DbSession,
    _user: CurrentUser,
) -> dict[str, int]:
    """Set knowledge point difficulty for multiple KPs."""
    count = await bulk_set_kp_difficulty(db, body.kp_ids, body.difficulty)
    await db.commit()
    return {"updated": count}


# --- Template Routes ---


@template_router.get("", response_model=list[TemplateResponse])
async def list_all_templates(
    db: DbSession,
    _user: CurrentUser,
    industry: str | None = Query(None),
) -> list[TemplateResponse]:
    templates = await list_templates(db, industry=industry)
    return [TemplateResponse.model_validate(t) for t in templates]


@template_router.post("", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_new_template(
    body: TemplateCreate,
    db: DbSession,
    user: CurrentUser,
) -> TemplateResponse:
    template = await create_template(db, body, user_id=user.id)
    await db.commit()
    return TemplateResponse.model_validate(template)


@template_router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> TemplateResponse:
    template = await get_template_by_id(db, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return TemplateResponse.model_validate(template)


@template_router.patch("/{template_id}", response_model=TemplateResponse)
async def update_existing_template(
    template_id: uuid.UUID,
    body: TemplateUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> TemplateResponse:
    template = await get_template_by_id(db, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    updated = await update_template(db, template, body)
    await db.commit()
    return TemplateResponse.model_validate(updated)


# ── Learning Resources ──────────────────────────────────────────────────────

from app.job_models.models import LearningResource
from sqlalchemy import select
from app.uploads.router import UPLOAD_DIR
from fastapi import UploadFile, File, Form
import pathlib


@model_router.get("/nodes/{node_id}/resources", response_model=list[LearningResourceResponse])
async def list_node_resources(
    node_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> list[LearningResourceResponse]:
    """List all learning resources for a given node."""
    result = await db.execute(
        select(LearningResource)
        .where(LearningResource.node_id == node_id)
        .order_by(LearningResource.sort_order, LearningResource.created_at)
    )
    resources = result.scalars().all()
    return [LearningResourceResponse.model_validate(r) for r in resources]


async def _ensure_unique_learning_resource_title(
    db: DbSession,
    *,
    node_id: uuid.UUID,
    node_type: str,
    title: str,
) -> None:
    normalized_title = title.strip()
    existing = await db.scalar(
        select(LearningResource.id).where(
            LearningResource.node_id == node_id,
            LearningResource.node_type == node_type,
            LearningResource.title == normalized_title,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=400, detail="当前知识点下已存在同名学习资料，请先删除或更换名称。")


@model_router.post(
    "/nodes/{node_id}/resources",
    response_model=LearningResourceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_node_resource(
    node_id: uuid.UUID,
    body: LearningResourceCreate,
    db: DbSession,
    user: CurrentUser,
    node_type: str = Query(..., pattern="^(dimension|skill|kp)$"),
) -> LearningResourceResponse:
    """Create a learning resource (link or video URL) for a node."""
    await _ensure_unique_learning_resource_title(
        db,
        node_id=node_id,
        node_type=node_type,
        title=body.title,
    )
    resource = LearningResource(
        node_id=node_id,
        node_type=node_type,
        resource_type=body.resource_type,
        title=body.title.strip(),
        url=body.url,
        file_path=body.file_path,
        description=body.description,
        source=body.source,
        sort_order=body.sort_order,
        uploaded_by=user.id,
    )
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    return LearningResourceResponse.model_validate(resource)


@model_router.post(
    "/nodes/{node_id}/resources/upload",
    response_model=LearningResourceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_node_resource(
    node_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    file: UploadFile = File(...),
    title: str = Form(...),
    node_type: str = Form(...),
    description: str = Form(""),
) -> LearningResourceResponse:
    """Upload a file as a learning resource for a node."""
    contents = await file.read()
    max_size = 50 * 1024 * 1024  # 50MB
    if len(contents) > max_size:
        raise HTTPException(status_code=400, detail="文件大小不能超过 50MB")

    normalized_title = title.strip()
    await _ensure_unique_learning_resource_title(
        db,
        node_id=node_id,
        node_type=node_type,
        title=normalized_title,
    )

    ext = pathlib.Path(file.filename or "file").suffix or ""
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(contents)

    # Determine resource_type from extension
    video_exts = {".mp4", ".webm", ".mov", ".avi", ".mkv"}
    resource_type = "video" if ext.lower() in video_exts else "document"

    resource = LearningResource(
        node_id=node_id,
        node_type=node_type,
        resource_type=resource_type,
        title=normalized_title,
        url=f"/api/uploads/files/{filename}",
        file_path=str(filepath),
        description=description or None,
        source="upload",
        uploaded_by=user.id,
    )
    db.add(resource)
    await db.commit()
    await db.refresh(resource)
    return LearningResourceResponse.model_validate(resource)


@model_router.patch(
    "/resources/{resource_id}",
    response_model=LearningResourceResponse,
)
async def update_resource(
    resource_id: uuid.UUID,
    body: LearningResourceUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> LearningResourceResponse:
    result = await db.execute(
        select(LearningResource).where(LearningResource.id == resource_id)
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=404, detail="资源不存在")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(resource, field, value)
    await db.commit()
    await db.refresh(resource)
    return LearningResourceResponse.model_validate(resource)


@model_router.delete("/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resource(
    resource_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    result = await db.execute(
        select(LearningResource).where(LearningResource.id == resource_id)
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=404, detail="资源不存在")
    await db.delete(resource)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@model_router.get("/resources/{resource_id}/preview-html")
async def preview_resource_html(
    resource_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Response:
    """Convert a .doc/.docx file to HTML for inline preview."""
    import subprocess
    import tempfile

    result = await db.execute(
        select(LearningResource).where(LearningResource.id == resource_id)
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=404, detail="资源不存在")

    file_path = resource.file_path
    if not file_path or not pathlib.Path(file_path).exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    ext = pathlib.Path(file_path).suffix.lower()
    supported = {".doc", ".docx", ".ppt", ".pptx", ".rtf", ".odt"}
    if ext not in supported:
        raise HTTPException(status_code=400, detail=f"不支持 {ext} 格式预览")

    try:
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as tmp:
            tmp_path = tmp.name
        proc = subprocess.run(
            ["textutil", "-convert", "html", "-output", tmp_path, file_path],
            capture_output=True,
            timeout=30,
        )
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail="文档转换失败")
        html_content = pathlib.Path(tmp_path).read_text(encoding="utf-8")
        pathlib.Path(tmp_path).unlink(missing_ok=True)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="textutil 不可用，无法转换 .doc 文件")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="文档转换超时")

    return Response(content=html_content, media_type="text/html; charset=utf-8")

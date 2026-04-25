"""Business logic for job competency model operations."""

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, with_loader_criteria

from app.config import settings
from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelTemplate,
    JobModelVersion,
    SourceDocument,
    Skill,
    SkillKnowledgePoint,
)
from app.job_models.schemas import (
    DimensionCreate,
    DimensionUpdate,
    JobModelCreate,
    JobModelUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    SkillKnowledgePointUpdate,
    SkillUpdate,
    TemplateCreate,
    TemplateUpdate,
)


def _job_model_with_current_version_query():
    return select(JobModel).options(
        with_loader_criteria(JobModel, JobModel.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(JobModelVersion, JobModelVersion.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(CompetencyDimension, CompetencyDimension.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(Skill, Skill.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(SkillKnowledgePoint, SkillKnowledgePoint.deleted_at.is_(None), include_aliases=True),
        selectinload(JobModel.current_version)
        .selectinload(JobModelVersion.dimensions)
        .selectinload(CompetencyDimension.skills)
        .selectinload(Skill.knowledge_points),
        selectinload(JobModel.versions)
        .selectinload(JobModelVersion.dimensions)
        .selectinload(CompetencyDimension.skills)
        .selectinload(Skill.knowledge_points),
    )


async def _load_job_model(db: AsyncSession, model_id: uuid.UUID) -> JobModel | None:
    result = await db.execute(
        _job_model_with_current_version_query().where(
            JobModel.id == model_id,
            JobModel.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def _copy_version_hierarchy(
    db: AsyncSession,
    source_version: JobModelVersion,
    target_version_id: uuid.UUID,
) -> None:
    for dim in source_version.dimensions:
        new_dim = CompetencyDimension(
            model_version_id=target_version_id,
            name=dim.name,
            description=dim.description,
            sort_order=dim.sort_order,
        )
        db.add(new_dim)
        await db.flush()

        for skill in dim.skills:
            new_skill = Skill(
                dimension_id=new_dim.id,
                name=skill.name,
                level=skill.level,
                description=skill.description,
                item_source=skill.item_source,
                change_type=skill.change_type,
                evidence_summary=skill.evidence_summary,
                source_excerpt=skill.source_excerpt,
                sort_order=skill.sort_order,
            )
            db.add(new_skill)
            await db.flush()

            for kp in skill.knowledge_points:
                new_kp = SkillKnowledgePoint(
                    skill_id=new_skill.id,
                    name=kp.name,
                    teaching_suggestion=kp.teaching_suggestion,
                    difficulty=kp.difficulty,
                    item_source=kp.item_source,
                    change_type=kp.change_type,
                    evidence_summary=kp.evidence_summary,
                    source_excerpt=kp.source_excerpt,
                    sort_order=kp.sort_order,
                )
                db.add(new_kp)

    await db.flush()


# --- JobModel CRUD + Version Control ---


async def create_job_model(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    data: JobModelCreate,
) -> JobModel:
    model = JobModel(
        job_role=data.job_role,
        model_type=data.model_type,
        status=data.status,
        job_family=data.job_family,
        industry_name=data.industry_name,
        direction_name=data.direction_name,
        origin_standard_model_id=data.origin_standard_model_id,
        org_id=org_id,
        created_by=user_id,
    )
    db.add(model)
    await db.flush()

    version = JobModelVersion(
        job_model_id=model.id,
        version=1,
        version_note=data.version_note,
        is_current=True,
        source_type=data.source_type,
        raw_content={
            "job_role": data.job_role,
            "dimensions": [dim.model_dump() for dim in data.dimensions],
        },
        created_by=user_id,
        published_at=datetime.now(timezone.utc),
    )
    db.add(version)
    await db.flush()

    model.current_version_id = version.id
    model.current_version = version
    version.job_model = model
    await db.flush()

    for dim_data in data.dimensions:
        await _create_dimension(db, version.id, dim_data)

    loaded = await _load_job_model(db, model.id)
    return loaded or model


async def create_enterprise_model_from_standard(
    db: AsyncSession,
    standard_model: JobModel,
    *,
    enterprise_name: str,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    version_note: str | None = None,
    selected_standard_skill_ids: set[uuid.UUID] | None = None,
    selected_standard_kp_ids: set[uuid.UUID] | None = None,
    added_skills: list[dict[str, Any]] | None = None,
    added_knowledge_points: list[dict[str, Any]] | None = None,
) -> tuple[JobModel, JobModelVersion]:
    loaded_standard = await _load_job_model(db, standard_model.id)
    if loaded_standard is None or loaded_standard.current_version is None:
        raise ValueError("Standard model not found")

    def _include(skill_id: uuid.UUID) -> bool:
        return selected_standard_skill_ids is None or skill_id in selected_standard_skill_ids

    def _include_kp(kp_id: uuid.UUID) -> bool:
        return selected_standard_kp_ids is None or kp_id in selected_standard_kp_ids

    copied_dimensions: list[DimensionCreate] = []
    dim_name_index: dict[str, int] = {}  # dim.name (lower) -> index in copied_dimensions
    original_id_to_name: dict[uuid.UUID, str] = {}
    # 记录原 skill_id → (dim_index, skill_index)，供后续按 id 追加 KP
    skill_id_to_location: dict[uuid.UUID, tuple[int, int]] = {}
    skill_name_to_location: dict[str, tuple[int, int]] = {}
    for idx, dim in enumerate(loaded_standard.current_version.dimensions):
        skills: list[SkillCreate] = []
        for skill in dim.skills:
            if not _include(skill.id):
                continue
            skills.append(
                SkillCreate(
                    name=skill.name,
                    level=skill.level,
                    description=skill.description,
                    item_source="standard",
                    sort_order=skill.sort_order,
                    knowledge_points=[
                        SkillKnowledgePointCreate(
                            name=kp.name,
                            teaching_suggestion=kp.teaching_suggestion,
                            difficulty=kp.difficulty,
                            item_source="standard",
                            sort_order=kp.sort_order,
                        )
                        for kp in skill.knowledge_points
                        if _include_kp(kp.id)
                    ],
                )
            )
            skill_id_to_location[skill.id] = (idx, len(skills) - 1)
            skill_name_to_location.setdefault(skill.name.lower(), (idx, len(skills) - 1))
        copied_dimensions.append(
            DimensionCreate(
                name=dim.name,
                description=dim.description,
                sort_order=dim.sort_order,
                skills=skills,
            )
        )
        dim_name_index[dim.name.lower()] = idx
        original_id_to_name[dim.id] = dim.name

    for added in added_skills or []:
        name = str(added.get("name") or "").strip()
        if not name:
            continue
        level = added.get("level")
        level_str = str(level).strip() if level else None
        if level_str not in {"L1", "L2", "L3", "L4", "L5"}:
            level_str = None

        target_dim_id = added.get("dimension_id")
        new_dim_name = (added.get("dimension_name") or "").strip() or None

        target_index: int | None = None
        if target_dim_id is not None:
            try:
                dim_uuid = target_dim_id if isinstance(target_dim_id, uuid.UUID) else uuid.UUID(str(target_dim_id))
            except ValueError:
                dim_uuid = None
            if dim_uuid is not None:
                dim_name = original_id_to_name.get(dim_uuid)
                if dim_name is not None:
                    target_index = dim_name_index.get(dim_name.lower())

        if target_index is None and new_dim_name:
            key = new_dim_name.lower()
            if key in dim_name_index:
                target_index = dim_name_index[key]
            else:
                copied_dimensions.append(
                    DimensionCreate(
                        name=new_dim_name,
                        description=None,
                        sort_order=len(copied_dimensions),
                        skills=[],
                    )
                )
                target_index = len(copied_dimensions) - 1
                dim_name_index[key] = target_index

        if target_index is None:
            # 无可归入维度，兜底到第一个维度（若无则跳过）
            if not copied_dimensions:
                continue
            target_index = 0

        dim = copied_dimensions[target_index]
        dim.skills.append(
            SkillCreate(
                name=name,
                level=level_str,
                description=None,
                item_source="enterprise_added",
                sort_order=len(dim.skills),
                knowledge_points=[],
            )
        )
        # 记录新增 skill 的位置，允许后续 KP 按名字追加
        skill_name_to_location.setdefault(name.lower(), (target_index, len(dim.skills) - 1))

    for added_kp in added_knowledge_points or []:
        kp_name = str(added_kp.get("name") or "").strip()
        if not kp_name:
            continue

        target_location: tuple[int, int] | None = None
        parent_id = added_kp.get("parent_skill_id")
        if parent_id is not None:
            try:
                parent_uuid = (
                    parent_id if isinstance(parent_id, uuid.UUID) else uuid.UUID(str(parent_id))
                )
            except ValueError:
                parent_uuid = None
            if parent_uuid is not None:
                target_location = skill_id_to_location.get(parent_uuid)

        if target_location is None:
            parent_name = (added_kp.get("parent_skill_name") or "").strip()
            if parent_name:
                target_location = skill_name_to_location.get(parent_name.lower())

        if target_location is None:
            # 无可归入 skill，跳过（UI 应保证必须指定父技能）
            continue

        dim_idx, skill_idx = target_location
        target_skill = copied_dimensions[dim_idx].skills[skill_idx]
        target_skill.knowledge_points.append(
            SkillKnowledgePointCreate(
                name=kp_name,
                teaching_suggestion=None,
                difficulty=None,
                item_source="enterprise_added",
                sort_order=len(target_skill.knowledge_points),
            )
        )

    enterprise = await create_job_model(
        db,
        org_id,
        user_id,
        JobModelCreate(
            job_role=enterprise_name or loaded_standard.job_role,
            version_note=version_note,
            source_type="standard_based",
            model_type="enterprise",
            status="draft",
            job_family=loaded_standard.job_family,
            industry_name=loaded_standard.industry_name,
            direction_name=loaded_standard.direction_name,
            origin_standard_model_id=loaded_standard.id,
            dimensions=copied_dimensions,
        ),
    )

    if enterprise.current_version is None:
        raise RuntimeError("Enterprise model missing current version")

    enterprise.current_version.version_note = version_note
    enterprise.current_version.raw_content = loaded_standard.current_version.raw_content
    await db.flush()
    loaded = await _load_job_model(db, enterprise.id)
    result_model = loaded or enterprise
    if result_model.current_version is None:
        raise RuntimeError("Enterprise model missing current version after reload")
    return result_model, result_model.current_version


async def get_job_model_by_id(db: AsyncSession, model_id: uuid.UUID) -> JobModel | None:
    return await _load_job_model(db, model_id)


async def list_job_model_versions(
    db: AsyncSession, model_id: uuid.UUID
) -> list[tuple[JobModelVersion, str | None]]:
    from app.auth.models import User

    result = await db.execute(
        select(JobModelVersion, User.full_name)
        .outerjoin(User, User.id == JobModelVersion.created_by)
        .where(
            JobModelVersion.job_model_id == model_id,
            JobModelVersion.deleted_at.is_(None),
        )
        .order_by(JobModelVersion.version.desc())
    )
    return [(ver, name) for ver, name in result.all()]


async def get_job_model_at_version(
    db: AsyncSession, model_id: uuid.UUID, version_id: uuid.UUID
) -> tuple[JobModel, JobModelVersion] | None:
    model = await _load_job_model(db, model_id)
    if model is None:
        return None
    target = next(
        (v for v in model.versions if v.id == version_id and v.deleted_at is None),
        None,
    )
    if target is None:
        return None
    return model, target


async def list_job_models(
    db: AsyncSession,
    org_id: uuid.UUID,
    model_type: str | None = None,
) -> list[JobModel]:
    query = _job_model_with_current_version_query().where(
        JobModel.org_id == org_id,
        JobModel.deleted_at.is_(None),
    )
    if model_type is not None:
        query = query.where(JobModel.model_type == model_type)
    result = await db.execute(query.order_by(JobModel.created_at.desc()))
    return list(result.scalars().all())


def _job_model_summary_query():
    """Lightweight query for list views: only loads current_version top-level fields.

    Avoids eager-loading versions/dimensions/skills/knowledge_points which
    explodes into thousands of rows and dominates response time for JobModelSummary.
    """
    return select(JobModel).options(
        with_loader_criteria(JobModel, JobModel.deleted_at.is_(None), include_aliases=True),
        with_loader_criteria(
            JobModelVersion, JobModelVersion.deleted_at.is_(None), include_aliases=True
        ),
        selectinload(JobModel.current_version),
    )


async def list_all_job_models(
    db: AsyncSession,
    org_id: uuid.UUID,
    skip: int = 0,
    limit: int = 50,
    model_type: str | None = None,
    industry_name: str | None = None,
    direction_name: str | None = None,
) -> tuple[list[JobModel], int]:
    """List all job models in an organization with pagination.

    Uses the lightweight summary query — do NOT use for endpoints that need
    the full dimension/skill/kp hierarchy.
    """
    filters = [JobModel.org_id == org_id, JobModel.deleted_at.is_(None)]
    if model_type:
        filters.append(JobModel.model_type == model_type)
    if industry_name:
        filters.append(JobModel.industry_name == industry_name)
    if direction_name:
        filters.append(JobModel.direction_name == direction_name)

    count_result = await db.execute(
        select(func.count(JobModel.id)).select_from(JobModel).where(*filters)
    )
    total = count_result.scalar_one()

    result = await db.execute(
        _job_model_summary_query()
        .where(*filters)
        .order_by(JobModel.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all()), total


async def list_job_model_facets(
    db: AsyncSession,
    org_id: uuid.UUID,
) -> list[dict]:
    """Aggregated industry/direction/model_type counts for the left filter tree.

    Returns one row per (industry_name, direction_name, model_type) group with count.
    Cheap alternative to pulling every model client-side just to build the tree.
    """
    rows = await db.execute(
        select(
            JobModel.industry_name,
            JobModel.direction_name,
            JobModel.model_type,
            func.count(JobModel.id).label("count"),
        )
        .where(JobModel.org_id == org_id, JobModel.deleted_at.is_(None))
        .group_by(JobModel.industry_name, JobModel.direction_name, JobModel.model_type)
    )
    return [
        {
            "industry_name": r.industry_name,
            "direction_name": r.direction_name,
            "model_type": r.model_type,
            "count": r.count,
        }
        for r in rows.all()
    ]


async def update_job_model(
    db: AsyncSession,
    model: JobModel,
    data: JobModelUpdate,
) -> JobModel:
    update_data = data.model_dump(exclude_unset=True)
    if "job_role" in update_data:
        model.job_role = update_data["job_role"]

    if model.current_version is not None and update_data.get("version_note") is not None:
        model.current_version.version_note = update_data["version_note"]

    await db.flush()
    loaded = await _load_job_model(db, model.id)
    return loaded or model


async def delete_job_model(db: AsyncSession, model: JobModel) -> None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SourceDocument).where(
            SourceDocument.job_model_id == model.id,
            SourceDocument.deleted_at.is_(None),
        )
    )
    source_documents = list(result.scalars().all())

    model.deleted_at = now
    for version in model.versions:
        version.deleted_at = now
        if model.current_version_id == version.id:
            version.is_current = False
        for dim in version.dimensions:
            dim.deleted_at = now
            for skill in dim.skills:
                skill.deleted_at = now
                for kp in skill.knowledge_points:
                    kp.deleted_at = now

    for source_document in source_documents:
        source_document.deleted_at = now
    await db.flush()


logger = logging.getLogger(__name__)


_RECOMMEND_PROMPT = """你是企业岗位匹配助手。用户会输入一段岗位描述或 JD 文本，你需要从候选标准岗位列表里选出最匹配的一个。

候选标准岗位（JSON 数组，每项含 id / job_role / industry_name / direction_name / job_family）：
{candidates}

用户输入：
{job_text}

要求：
1. 只输出合法 JSON，不要任何解释、不要 Markdown 代码块。
2. 格式：{{"id": "<候选中的 id>", "confidence": 0.0-1.0, "rationale": "用一到两句话说明为什么选这个", "matched_keywords": ["xx", "yy"]}}
3. 若候选与用户描述匹配度都很低（<0.3），返回 {{"id": null, "confidence": 0.0, "rationale": "说明为什么无匹配", "matched_keywords": []}}
4. 不要编造 id，必须从候选中选取。
"""


async def _rank_standard_with_llm(
    job_text: str,
    candidates: list[JobModel],
) -> tuple[uuid.UUID | None, str, float, list[str]]:
    api_key = settings.qwen_api_key
    if not api_key:
        return None, "", 0.0, []

    payload_candidates = [
        {
            "id": str(model.id),
            "job_role": model.job_role,
            "industry_name": model.industry_name or "",
            "direction_name": model.direction_name or "",
            "job_family": model.job_family or "",
        }
        for model in candidates
    ]
    prompt = _RECOMMEND_PROMPT.format(
        candidates=json.dumps(payload_candidates, ensure_ascii=False),
        job_text=job_text[:4000],
    )

    base_url = settings.qwen_base_url.rstrip("/")
    model_name = settings.qwen_model_name

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": "你只输出合法 JSON。"},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.1,
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("recommend LLM network error: %s", exc)
        return None, "", 0.0, []

    if response.status_code >= 400:
        logger.warning("recommend LLM returned %s: %s", response.status_code, response.text[:200])
        return None, "", 0.0, []

    raw = (
        response.json()
        .get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    if not isinstance(raw, str) or not raw.strip():
        return None, "", 0.0, []

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)

    try:
        parsed: Any = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("recommend LLM bad JSON: %s", text[:200])
        return None, "", 0.0, []
    if not isinstance(parsed, dict):
        return None, "", 0.0, []

    raw_id = parsed.get("id")
    confidence = float(parsed.get("confidence") or 0.0)
    rationale = str(parsed.get("rationale") or "").strip()
    keywords_raw = parsed.get("matched_keywords") or []
    keywords: list[str] = [str(k).strip() for k in keywords_raw if str(k).strip()] if isinstance(keywords_raw, list) else []

    if raw_id is None:
        return None, rationale, confidence, keywords

    try:
        chosen_id = uuid.UUID(str(raw_id))
    except ValueError:
        return None, rationale, confidence, keywords

    valid_ids = {model.id for model in candidates}
    if chosen_id not in valid_ids:
        return None, rationale, confidence, keywords

    return chosen_id, rationale, confidence, keywords


def _candidate_keyword_tokens(model: JobModel) -> set[str]:
    text = " ".join(
        part
        for part in [
            model.job_role,
            model.industry_name or "",
            model.direction_name or "",
            model.job_family or "",
        ]
        if part
    ).lower()
    tokens = {match.group(0) for match in re.finditer(r"[a-z0-9+#.]+", text)}

    for chunk in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        tokens.add(chunk)
        for size in (2, 3, 4):
            if len(chunk) >= size:
                tokens.update(chunk[i : i + size] for i in range(len(chunk) - size + 1))

    return {token for token in tokens if len(token.strip()) >= 2}


def _rank_standard_with_keywords(
    job_text: str,
    candidates: list[JobModel],
) -> tuple[JobModel, float, list[str]] | None:
    haystack = job_text.lower()
    scored: list[tuple[int, JobModel, list[str]]] = []
    for model in candidates:
        matched = sorted(token for token in _candidate_keyword_tokens(model) if token in haystack)
        if not matched:
            continue
        score = sum(3 if re.search(r"[a-z0-9]", token) else len(token) for token in matched)
        scored.append((score, model, matched))

    if not scored:
        return None

    scored.sort(key=lambda item: (item[0], item[1].updated_at), reverse=True)
    score, model, matched = scored[0]
    confidence = min(0.85, 0.25 + score / 20)
    return model, confidence, matched[:8]


async def recommend_standard_model(
    db: AsyncSession,
    job_text: str,
    org_id: uuid.UUID,
) -> tuple[JobModel, str, float, list[str]] | None:
    """Return best matching standard model via LLM ranking.

    Returns (model, rationale, confidence, matched_keywords) or None if no match.
    """
    query = _job_model_with_current_version_query().where(
        JobModel.org_id == org_id,
        JobModel.model_type == "standard",
        JobModel.deleted_at.is_(None),
    )
    result = await db.execute(query.order_by(JobModel.updated_at.desc()).limit(200))
    candidates = list(result.scalars().all())
    if not candidates:
        return None

    chosen_id, rationale, confidence, keywords = await _rank_standard_with_llm(job_text, candidates)

    if chosen_id is None:
        if not rationale:
            keyword_match = _rank_standard_with_keywords(job_text, candidates)
            if keyword_match is not None:
                fallback, fallback_confidence, fallback_keywords = keyword_match
                return (
                    fallback,
                    f"根据岗位描述中的关键词匹配到标准岗位「{fallback.job_role}」。",
                    fallback_confidence,
                    fallback_keywords,
                )
            fallback = candidates[0]
            return fallback, "未开启 AI 推荐且未识别到明显关键词，默认返回最近更新的标准岗位，请自行核对。", 0.0, []
        return None

    chosen = next((model for model in candidates if model.id == chosen_id), None)
    if chosen is None:
        return None

    final_rationale = rationale or f"根据描述匹配到标准岗位「{chosen.job_role}」。"
    return chosen, final_rationale, max(0.0, min(1.0, confidence)), keywords


_MATCH_SKILLS_PROMPT = """你是企业技能对照助手。用户上传了岗位描述（JD），并选定了一个标准岗位模型。请把 JD 中明确提到的技能及其细分知识点与标准岗位的技能/知识点做语义对照。

标准岗位的技能列表（JSON 数组，每项含 id / name / level / dimension_name / knowledge_points[{{id, name}}]）：
{skills}

用户 JD 文本：
{job_text}

要求：
1. 只输出合法 JSON，不要解释、不要 Markdown 代码块。
2. 格式：{{
     "matches": [
       {{"standard_skill_id": "<skills 中的 id>", "jd_skill_name": "JD 里的对应说法",
         "matched_kps": [{{"standard_kp_id": "<该 skill 的 knowledge_points 中的 id>", "jd_kp_name": "JD 中对应说法"}}]}}
     ],
     "missing": [
       {{"name": "JD 有但标准没有的技能", "suggested_level": "L1|L2|L3|L4|L5" 或 null,
         "dimension_hint": "建议归入哪个维度名或空",
         "missing_kps": ["该技能下 JD 提到的知识点1", "..."]}}
     ],
     "missing_kps": [
       {{"name": "JD 中提到的知识点但标准已有 skill 下没有对应项",
         "parent_skill_hint_id": "<建议归入的 skills 中的 id 或 null>",
         "parent_skill_hint_name": "若非标准技能而是 missing 中某技能的名字，可填名字"}}
     ]
   }}
3. 对照基于语义，同一概念的不同说法应视为 match（例如"Spring"≈"Spring Framework"，"MySQL 索引"≈"索引优化"）。
4. 不要编造 id，必须从对应列表中选取。matched_kps 中的 standard_kp_id 必须属于所在 standard_skill 的 knowledge_points。
5. 未被 match 的标准技能/知识点不需要返回——调用方会自行识别为"多余"。
6. missing / missing_kps 只列 JD 中明确出现的项，不要凭空想象。如果某个技能整体在标准中不存在，放入 missing 并把相关知识点放入该项的 missing_kps；如果技能存在但有新的知识点，放入顶层 missing_kps。
"""


async def match_skills_with_llm(
    job_text: str,
    standard_skills: list[dict[str, Any]],
) -> tuple[
    dict[uuid.UUID, str],
    dict[uuid.UUID, str],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """Return (matched_skills, matched_kps, missing_skills, missing_kps).

    matched_skills: {standard_skill_id -> jd_skill_name}
    matched_kps: {standard_kp_id -> jd_kp_name}
    missing_skills: [{"name", "suggested_level", "dimension_hint", "missing_kps":[str]}]
    missing_kps: [{"name", "parent_skill_hint_id", "parent_skill_hint_name"}]
    """
    api_key = settings.qwen_api_key
    if not api_key or not standard_skills:
        return {}, {}, [], []

    prompt = _MATCH_SKILLS_PROMPT.format(
        skills=json.dumps(standard_skills, ensure_ascii=False),
        job_text=job_text[:6000],
    )
    base_url = settings.qwen_base_url.rstrip("/")
    model_name = settings.qwen_model_name

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": "你只输出合法 JSON。"},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.1,
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("match-skills LLM network error: %s", exc)
        return {}, {}, [], []

    if response.status_code >= 400:
        logger.warning("match-skills LLM %s: %s", response.status_code, response.text[:200])
        return {}, {}, [], []

    raw = (
        response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    )
    if not isinstance(raw, str) or not raw.strip():
        return {}, {}, [], []
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)

    try:
        parsed: Any = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("match-skills LLM bad JSON: %s", text[:200])
        return {}, {}, [], []
    if not isinstance(parsed, dict):
        return {}, {}, [], []

    valid_skill_ids: dict[str, uuid.UUID] = {
        str(s["id"]): uuid.UUID(str(s["id"])) for s in standard_skills
    }
    valid_kp_ids_by_skill: dict[str, dict[str, uuid.UUID]] = {
        str(s["id"]): {
            str(kp["id"]): uuid.UUID(str(kp["id"])) for kp in (s.get("knowledge_points") or [])
        }
        for s in standard_skills
    }

    matched_skills: dict[uuid.UUID, str] = {}
    matched_kps: dict[uuid.UUID, str] = {}
    for item in parsed.get("matches") or []:
        if not isinstance(item, dict):
            continue
        raw_skill_id = str(item.get("standard_skill_id") or "").strip()
        jd_name = str(item.get("jd_skill_name") or "").strip()
        if raw_skill_id not in valid_skill_ids or not jd_name:
            continue
        matched_skills[valid_skill_ids[raw_skill_id]] = jd_name
        for kp_item in item.get("matched_kps") or []:
            if not isinstance(kp_item, dict):
                continue
            raw_kp_id = str(kp_item.get("standard_kp_id") or "").strip()
            jd_kp_name = str(kp_item.get("jd_kp_name") or "").strip()
            kp_pool = valid_kp_ids_by_skill.get(raw_skill_id, {})
            if raw_kp_id in kp_pool and jd_kp_name:
                matched_kps[kp_pool[raw_kp_id]] = jd_kp_name

    missing_skills: list[dict[str, Any]] = []
    for item in parsed.get("missing") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        level = item.get("suggested_level")
        level_str = str(level).strip() if level else None
        if level_str not in {"L1", "L2", "L3", "L4", "L5"}:
            level_str = None
        hint = str(item.get("dimension_hint") or "").strip() or None
        raw_missing_kps = item.get("missing_kps") or []
        missing_kp_names = [
            str(kp).strip() for kp in raw_missing_kps if isinstance(kp, str) and str(kp).strip()
        ]
        missing_skills.append(
            {
                "name": name,
                "suggested_level": level_str,
                "dimension_hint": hint,
                "missing_kps": missing_kp_names,
            }
        )

    missing_kps_top: list[dict[str, Any]] = []
    for item in parsed.get("missing_kps") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        hint_id_raw = item.get("parent_skill_hint_id")
        hint_id: uuid.UUID | None = None
        if isinstance(hint_id_raw, str) and hint_id_raw.strip() in valid_skill_ids:
            hint_id = valid_skill_ids[hint_id_raw.strip()]
        hint_name = str(item.get("parent_skill_hint_name") or "").strip() or None
        missing_kps_top.append(
            {
                "name": name,
                "parent_skill_hint_id": hint_id,
                "parent_skill_hint_name": hint_name,
            }
        )

    return matched_skills, matched_kps, missing_skills, missing_kps_top


async def build_skill_match(
    db: AsyncSession,
    standard_model: JobModel,
    job_text: str,
) -> dict[str, Any]:
    """Run LLM match against the standard model's current version and shape results."""
    loaded = await _load_job_model(db, standard_model.id)
    version = loaded.current_version if loaded else None
    if version is None:
        raise ValueError("Standard model has no current version")

    flat_skills: list[dict[str, Any]] = []
    for dim in version.dimensions:
        for skill in dim.skills:
            flat_skills.append(
                {
                    "id": str(skill.id),
                    "name": skill.name,
                    "level": skill.level or "",
                    "dimension_name": dim.name,
                    "knowledge_points": [
                        {"id": str(kp.id), "name": kp.name} for kp in skill.knowledge_points
                    ],
                }
            )

    matched_skills, matched_kps, missing_skills, missing_kps_top = (
        await match_skills_with_llm(job_text, flat_skills)
    )

    dimensions_out: list[dict[str, Any]] = []
    for dim in version.dimensions:
        skills_out: list[dict[str, Any]] = []
        for skill in dim.skills:
            jd_name = matched_skills.get(skill.id)
            kps_out: list[dict[str, Any]] = []
            for kp in skill.knowledge_points:
                jd_kp_name = matched_kps.get(kp.id)
                kps_out.append(
                    {
                        "id": str(kp.id),
                        "name": kp.name,
                        "difficulty": kp.difficulty,
                        "status": "matched" if jd_kp_name else "extra",
                        "jd_kp_name": jd_kp_name,
                    }
                )
            skills_out.append(
                {
                    "id": str(skill.id),
                    "name": skill.name,
                    "level": skill.level,
                    "status": "matched" if jd_name else "extra",
                    "jd_skill_name": jd_name,
                    "knowledge_points": kps_out,
                }
            )
        dimensions_out.append(
            {
                "id": str(dim.id),
                "name": dim.name,
                "skills": skills_out,
            }
        )

    missing_kps_serialized = [
        {
            "name": item["name"],
            "parent_skill_hint_id": str(item["parent_skill_hint_id"])
            if item.get("parent_skill_hint_id") is not None
            else None,
            "parent_skill_hint_name": item.get("parent_skill_hint_name"),
        }
        for item in missing_kps_top
    ]

    return {
        "dimensions": dimensions_out,
        "missing_skills": missing_skills,
        "missing_knowledge_points": missing_kps_serialized,
    }


async def publish_new_version(
    db: AsyncSession,
    model: JobModel,
    version_note: str | None = None,
) -> JobModel:
    loaded = await _load_job_model(db, model.id)
    current_version = loaded.current_version if loaded else model.current_version
    if current_version is None:
        raise ValueError("Model has no current version")

    current_version.is_current = False
    await db.flush()

    new_version = JobModelVersion(
        job_model_id=model.id,
        version=current_version.version + 1,
        version_note=version_note,
        is_current=True,
        source_type=current_version.source_type,
        raw_content=current_version.raw_content,
        created_by=current_version.created_by,
        published_at=datetime.now(timezone.utc),
    )
    db.add(new_version)
    await db.flush()

    await _copy_version_hierarchy(db, current_version, new_version.id)

    model.current_version_id = new_version.id
    model.current_version = new_version
    new_version.job_model = model
    await db.flush()

    loaded_new = await _load_job_model(db, model.id)
    return loaded_new or model


# --- Dimension CRUD ---


async def create_dimension(
    db: AsyncSession,
    model_version_id: uuid.UUID,
    data: DimensionCreate,
) -> CompetencyDimension:
    return await _create_dimension(db, model_version_id, data)


async def update_dimension(
    db: AsyncSession,
    dim: CompetencyDimension,
    data: DimensionUpdate,
) -> CompetencyDimension:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(dim, field, value)
    await db.flush()
    await db.refresh(dim)
    return dim


async def delete_dimension(db: AsyncSession, dim: CompetencyDimension) -> None:
    await db.delete(dim)
    await db.flush()


# --- Skill CRUD ---


async def create_skill(
    db: AsyncSession,
    dimension_id: uuid.UUID,
    data: SkillCreate,
) -> Skill:
    return await _create_skill(db, dimension_id, data)


async def update_skill(
    db: AsyncSession,
    skill: Skill,
    data: SkillUpdate,
) -> Skill:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(skill, field, value)
    await db.flush()
    await db.refresh(skill)
    return skill


async def delete_skill(db: AsyncSession, skill: Skill) -> None:
    await db.delete(skill)
    await db.flush()


# --- KnowledgePoint CRUD ---


async def create_knowledge_point(
    db: AsyncSession,
    skill_id: uuid.UUID,
    data: SkillKnowledgePointCreate,
) -> SkillKnowledgePoint:
    kp = SkillKnowledgePoint(
        skill_id=skill_id,
        name=data.name,
        teaching_suggestion=data.teaching_suggestion,
        difficulty=data.difficulty,
        sort_order=data.sort_order,
    )
    db.add(kp)
    await db.flush()
    await db.refresh(kp)
    return kp


async def update_knowledge_point(
    db: AsyncSession,
    kp: SkillKnowledgePoint,
    data: SkillKnowledgePointUpdate,
) -> SkillKnowledgePoint:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(kp, field, value)
    await db.flush()
    await db.refresh(kp)
    return kp


async def delete_knowledge_point(db: AsyncSession, kp: SkillKnowledgePoint) -> None:
    await db.delete(kp)
    await db.flush()


# --- Template CRUD ---


async def create_template(
    db: AsyncSession,
    data: TemplateCreate,
    user_id: uuid.UUID,
    is_system: bool = False,
) -> JobModelTemplate:
    template = JobModelTemplate(
        name=data.name,
        industry=data.industry,
        template_data=data.template_data,
        is_system=is_system,
        created_by=user_id,
    )
    db.add(template)
    await db.flush()
    await db.refresh(template)
    return template


async def list_templates(
    db: AsyncSession,
    industry: str | None = None,
) -> list[JobModelTemplate]:
    query = select(JobModelTemplate).where(JobModelTemplate.deleted_at.is_(None))
    if industry is not None:
        query = query.where(JobModelTemplate.industry == industry)
    result = await db.execute(query.order_by(JobModelTemplate.created_at.desc()))
    return list(result.scalars().all())


async def get_template_by_id(
    db: AsyncSession,
    template_id: uuid.UUID,
) -> JobModelTemplate | None:
    result = await db.execute(
        select(JobModelTemplate).where(
            JobModelTemplate.id == template_id,
            JobModelTemplate.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def update_template(
    db: AsyncSession,
    template: JobModelTemplate,
    data: TemplateUpdate,
) -> JobModelTemplate:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)
    await db.flush()
    await db.refresh(template)
    return template


async def save_model_as_template(
    db: AsyncSession,
    model: JobModel,
    name: str,
    user_id: uuid.UUID,
) -> JobModelTemplate:
    loaded = await _load_job_model(db, model.id)

    template_data: dict = {
        "job_role": model.job_role,
        "dimensions": [],
    }

    for dim in (loaded.current_version.dimensions if loaded and loaded.current_version else []):
        dim_dict: dict = {
            "name": dim.name,
            "description": dim.description,
            "sort_order": dim.sort_order,
            "skills": [],
        }
        for skill in dim.skills:
            skill_dict: dict = {
                "name": skill.name,
                "level": skill.level,
                "description": skill.description,
                "sort_order": skill.sort_order,
                "knowledge_points": [],
            }
            for kp in skill.knowledge_points:
                skill_dict["knowledge_points"].append(
                    {
                        "name": kp.name,
                        "teaching_suggestion": kp.teaching_suggestion,
                        "difficulty": kp.difficulty,
                        "sort_order": kp.sort_order,
                    }
                )
            dim_dict["skills"].append(skill_dict)
        template_data["dimensions"].append(dim_dict)

    template = JobModelTemplate(
        name=name,
        industry=None,
        template_data=template_data,
        is_system=False,
        created_by=user_id,
    )
    db.add(template)
    await db.flush()
    await db.refresh(template)
    return template


# --- Internal helpers ---


async def _create_dimension(
    db: AsyncSession,
    model_version_id: uuid.UUID,
    data: DimensionCreate,
) -> CompetencyDimension:
    dim = CompetencyDimension(
        model_version_id=model_version_id,
        name=data.name,
        description=data.description,
        sort_order=data.sort_order,
    )
    db.add(dim)
    await db.flush()

    for skill_data in data.skills:
        await _create_skill(db, dim.id, skill_data)

    await db.refresh(dim)
    return dim


async def _create_skill(
    db: AsyncSession,
    dimension_id: uuid.UUID,
    data: SkillCreate,
) -> Skill:
    skill = Skill(
        dimension_id=dimension_id,
        name=data.name,
        level=data.level,
        description=data.description,
        item_source=data.item_source,
        sort_order=data.sort_order,
    )
    db.add(skill)
    await db.flush()

    for kp_data in data.knowledge_points:
        kp = SkillKnowledgePoint(
            skill_id=skill.id,
            name=kp_data.name,
            teaching_suggestion=kp_data.teaching_suggestion,
            difficulty=kp_data.difficulty,
            item_source=kp_data.item_source,
            sort_order=kp_data.sort_order,
        )
        db.add(kp)

    await db.flush()
    await db.refresh(skill)
    return skill

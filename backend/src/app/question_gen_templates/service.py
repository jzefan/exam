"""Service layer: template CRUD + generation-context assembly.

Generation reuses ``generate_questions_stream``; here we only turn a template
(+ this-time overrides) into an ``AIGenerateRequest``.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.job_models.models import LearningResource
from app.questions.ai_generate import AIGenerateRequest, AIModelProvider
from app.questions.models import Question
from app.learning.models import KnowledgePoint
from app.question_gen_templates.models import (
    QuestionGenRun,
    QuestionGenTemplate,
    QuestionGenTemplateMaterial,
)
from app.question_gen_templates.schemas import TemplateCreate, TemplateGenerateRequest, TemplateUpdate

_MAX_SEED_SAMPLES = 5
_MAX_SEED_CHARS = 600
_MAX_MATERIAL_TEXT = 200000
_DIFFICULTY_BY_BUCKET = {"easy": 2, "medium": 3, "hard": 4}


# --------------------------------------------------------------------------- #
# CRUD
# --------------------------------------------------------------------------- #
def _base_query():
    return select(QuestionGenTemplate).where(QuestionGenTemplate.deleted_at.is_(None))


async def list_templates(db: AsyncSession, *, course_kp_id: uuid.UUID, user_id: uuid.UUID) -> list[QuestionGenTemplate]:
    stmt = (
        _base_query()
        .where(QuestionGenTemplate.course_kp_id == course_kp_id, QuestionGenTemplate.owner_id == user_id)
        .order_by(QuestionGenTemplate.is_default.desc(), QuestionGenTemplate.updated_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def get_owned_template(
    db: AsyncSession, template_id: uuid.UUID, user_id: uuid.UUID
) -> QuestionGenTemplate | None:
    stmt = _base_query().where(QuestionGenTemplate.id == template_id, QuestionGenTemplate.owner_id == user_id)
    return (await db.execute(stmt)).scalars().first()


def _material_rows(template_id: uuid.UUID, materials) -> list[QuestionGenTemplateMaterial]:
    rows: list[QuestionGenTemplateMaterial] = []
    for item in materials:
        rows.append(
            QuestionGenTemplateMaterial(
                template_id=template_id,
                resource_id=item.resource_id,
                resource_title=item.resource_title,
                content_hash=item.content_hash,
                text=(item.text or "")[:_MAX_MATERIAL_TEXT],
                truncated=item.truncated or len(item.text or "") > _MAX_MATERIAL_TEXT,
            )
        )
    return rows


async def _clear_other_defaults(
    db: AsyncSession, *, course_kp_id: uuid.UUID, user_id: uuid.UUID, keep_id: uuid.UUID
) -> None:
    stmt = _base_query().where(
        QuestionGenTemplate.course_kp_id == course_kp_id,
        QuestionGenTemplate.owner_id == user_id,
        QuestionGenTemplate.is_default.is_(True),
        QuestionGenTemplate.id != keep_id,
    )
    for other in (await db.execute(stmt)).scalars().all():
        other.is_default = False


async def create_template(db: AsyncSession, data: TemplateCreate, *, user_id: uuid.UUID) -> QuestionGenTemplate:
    template = QuestionGenTemplate(
        course_kp_id=data.course_kp_id,
        owner_id=user_id,
        name=data.name.strip(),
        description=data.description,
        is_default=data.is_default,
        student_profile=data.student_profile.model_dump() if data.student_profile else None,
        seed_question_ids=[str(qid) for qid in data.seed_question_ids],
        manual_seed_questions=[seed.model_dump() for seed in data.manual_seed_questions],
        gen_rules=data.gen_rules.model_dump(mode="json") if data.gen_rules else None,
    )
    db.add(template)
    await db.flush()
    db.add_all(_material_rows(template.id, data.materials))
    if data.is_default:
        await _clear_other_defaults(db, course_kp_id=data.course_kp_id, user_id=user_id, keep_id=template.id)
    await db.commit()
    await db.refresh(template)
    return template


async def update_template(db: AsyncSession, template: QuestionGenTemplate, data: TemplateUpdate) -> QuestionGenTemplate:
    if data.name is not None:
        template.name = data.name.strip()
    if data.description is not None:
        template.description = data.description
    if data.student_profile is not None:
        template.student_profile = data.student_profile.model_dump()
    if data.seed_question_ids is not None:
        template.seed_question_ids = [str(qid) for qid in data.seed_question_ids]
    if data.manual_seed_questions is not None:
        template.manual_seed_questions = [seed.model_dump() for seed in data.manual_seed_questions]
    if data.gen_rules is not None:
        template.gen_rules = data.gen_rules.model_dump(mode="json")
    if data.materials is not None:
        template.materials.clear()
        await db.flush()
        db.add_all(_material_rows(template.id, data.materials))
    await db.commit()
    await db.refresh(template)
    return template


async def set_default(db: AsyncSession, template: QuestionGenTemplate) -> QuestionGenTemplate:
    template.is_default = True
    await _clear_other_defaults(db, course_kp_id=template.course_kp_id, user_id=template.owner_id, keep_id=template.id)
    await db.commit()
    await db.refresh(template)
    return template


async def soft_delete_template(db: AsyncSession, template: QuestionGenTemplate) -> None:
    from datetime import datetime, timezone

    template.deleted_at = datetime.now(timezone.utc)
    template.is_default = False
    await db.commit()


async def duplicate_template(
    db: AsyncSession, template: QuestionGenTemplate, *, user_id: uuid.UUID
) -> QuestionGenTemplate:
    copy = QuestionGenTemplate(
        course_kp_id=template.course_kp_id,
        owner_id=user_id,
        name=f"{template.name} 副本",
        description=template.description,
        is_default=False,
        student_profile=template.student_profile,
        seed_question_ids=list(template.seed_question_ids or []),
        manual_seed_questions=list(template.manual_seed_questions or []),
        gen_rules=template.gen_rules,
    )
    db.add(copy)
    await db.flush()
    db.add_all(
        QuestionGenTemplateMaterial(
            template_id=copy.id,
            resource_id=m.resource_id,
            resource_title=m.resource_title,
            content_hash=m.content_hash,
            text=m.text,
            truncated=m.truncated,
        )
        for m in template.materials
    )
    await db.commit()
    await db.refresh(copy)
    return copy


# --------------------------------------------------------------------------- #
# Generation-context assembly
# --------------------------------------------------------------------------- #
def _question_to_seed_text(question: Question) -> str:
    content = question.content if isinstance(question.content, dict) else {}
    stem = str(content.get("text") or question.title or "").strip()
    answer = question.answer if isinstance(question.answer, dict) else {}
    answer_text = answer.get("text") or answer.get("correct") or answer.get("code") or ""
    parts = [f"题干：{stem}"]
    if answer_text:
        parts.append(f"答案：{answer_text}")
    return "\n".join(parts)[:_MAX_SEED_CHARS]


_QTYPE_LABEL = {
    "choice": "选择题",
    "true_false": "判断题",
    "fill_in": "填空题",
    "short_answer": "简答题",
    "essay": "论述题",
    "code": "编程题",
}


def _manual_seed_to_text(item: Any) -> str:
    """Render a stored manual/imported seed (dict, or legacy plain string) to a sample."""
    if isinstance(item, str):
        return item.strip()[:_MAX_SEED_CHARS]
    if not isinstance(item, dict):
        return str(item).strip()[:_MAX_SEED_CHARS]
    parts: list[str] = []
    qtype = item.get("type")
    if qtype:
        parts.append(f"题型：{_QTYPE_LABEL.get(qtype, qtype)}")
    text = str(item.get("text") or "").strip()
    if text:
        parts.append(f"题干：{text}")
    options = item.get("options")
    if isinstance(options, dict) and options:
        opt_lines = "\n".join(f"{key}. {value}" for key, value in options.items())
        parts.append(f"选项：\n{opt_lines}")
    answer = str(item.get("answer") or "").strip()
    if answer:
        parts.append(f"答案：{answer}")
    analysis = str(item.get("analysis") or "").strip()
    if analysis:
        parts.append(f"解析：{analysis}")
    return "\n".join(parts)[:_MAX_SEED_CHARS]


async def _collect_seed_samples(db: AsyncSession, template: QuestionGenTemplate) -> list[str]:
    samples: list[str] = []
    seed_ids = [uuid.UUID(qid) for qid in (template.seed_question_ids or []) if qid]
    if seed_ids:
        rows = (await db.execute(select(Question).where(Question.id.in_(seed_ids)))).scalars().all()
        samples.extend(_question_to_seed_text(q) for q in rows)
    for manual in template.manual_seed_questions or []:
        text = _manual_seed_to_text(manual)
        if text:
            samples.append(text)
    return samples[:_MAX_SEED_SAMPLES]


_STAGE_LABEL = {"college": "大专", "undergraduate": "本科", "postgraduate": "研究生", "any": "不限"}
_DIFFICULTY_LABEL = {"easy": "简单", "medium": "中等", "hard": "偏难"}


def _build_prompt(template: QuestionGenTemplate, overrides: TemplateGenerateRequest, seed_samples: list[str]) -> str:
    blocks: list[str] = []
    profile = template.student_profile or {}
    if profile:
        profile_bits = []
        stage = profile.get("teaching_stage")
        if stage and stage != "any":
            profile_bits.append(f"教学阶段：{_STAGE_LABEL.get(stage, stage)}学生")
        if profile.get("difficulty_preference"):
            level = profile["difficulty_preference"]
            profile_bits.append(f"难度偏好：{_DIFFICULTY_LABEL.get(level, level)}")
        if profile.get("note"):
            profile_bits.append(str(profile["note"]))
        if profile_bits:
            blocks.append("【教学对象】" + "；".join(profile_bits))
        if profile.get("teaching_goal"):
            blocks.append("【教学目标（题目应考查学生达到以下能力）】" + str(profile["teaching_goal"]))

    rules = template.gen_rules or {}
    if rules.get("style_rules"):
        blocks.append("【出题规则】" + "；".join(rules["style_rules"]))
    if rules.get("avoid_scenarios"):
        blocks.append("【避免场景】" + "；".join(rules["avoid_scenarios"]))
    if rules.get("difficulty_distribution"):
        dist = "、".join(f"{k} {v}%" for k, v in rules["difficulty_distribution"].items())
        blocks.append(f"【难度分布参考】{dist}")

    if seed_samples:
        joined = "\n---\n".join(seed_samples)
        blocks.append("【风格参考题（仅供模仿风格，切勿照抄题目或答案）】\n" + joined)

    if overrides.extra_prompt.strip():
        blocks.append("【本次额外要求】" + overrides.extra_prompt.strip())

    return "\n".join(blocks)


def _resolve_difficulty(template: QuestionGenTemplate, overrides: TemplateGenerateRequest) -> int:
    if overrides.difficulty is not None:
        return overrides.difficulty
    rules = template.gen_rules or {}
    dist = rules.get("difficulty_distribution") or {}
    if dist:
        dominant = max(dist, key=lambda key: dist.get(key, 0))
        return _DIFFICULTY_BY_BUCKET.get(dominant, 3)
    return 3


def _resolve_type_distribution(template: QuestionGenTemplate, overrides: TemplateGenerateRequest) -> dict[str, int]:
    if overrides.type_distribution is not None:
        source = overrides.type_distribution
    else:
        source = (template.gen_rules or {}).get("type_distribution") or {}
    return {qtype: int(count) for qtype, count in source.items() if int(count) > 0}


def _resolve_scope_kp_ids(template: QuestionGenTemplate, overrides: TemplateGenerateRequest) -> list[uuid.UUID]:
    if overrides.knowledge_point_ids is not None:
        return list(overrides.knowledge_point_ids)
    raw = (template.gen_rules or {}).get("default_scope_kp_ids") or []
    return [uuid.UUID(str(kp)) for kp in raw]


def _joined_material_text(template: QuestionGenTemplate) -> str:
    chunks: list[str] = []
    for material in template.materials:
        if not material.text:
            continue
        title = material.resource_title or "资料"
        chunks.append(f"【{title}】\n{material.text}")
    return "\n\n".join(chunks)[:_MAX_MATERIAL_TEXT]


_FRAGMENT_TYPE_LABEL = {
    "concept": "概念",
    "term": "术语",
    "formula": "公式",
    "code_example": "代码",
    "case": "案例",
    "workflow": "流程",
    "other": "其他",
}
_MAX_KB_CHARS = 60000
_MAX_TREE_DEPTH = 16


async def _course_node_ids(db: AsyncSession, course_kp_id: uuid.UUID) -> list[uuid.UUID]:
    """All knowledge-point node ids under the course (root + descendants)."""
    node_ids: list[uuid.UUID] = [course_kp_id]
    seen = {course_kp_id}
    frontier = [course_kp_id]
    for _ in range(_MAX_TREE_DEPTH):
        if not frontier:
            break
        rows = (
            (
                await db.execute(
                    select(KnowledgePoint.id).where(
                        KnowledgePoint.parent_id.in_(frontier), KnowledgePoint.deleted_at.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        frontier = [row for row in rows if row not in seen]
        seen.update(frontier)
        node_ids.extend(frontier)
    return node_ids


async def gather_course_knowledge_base(
    db: AsyncSession, course_kp_id: uuid.UUID, *, scope_kp_ids: list[uuid.UUID] | None = None
) -> str:
    """Aggregate the course's material knowledge fragments into a grounded text block.

    Scoped to the given knowledge points when provided, else the whole course.
    """
    node_ids = scope_kp_ids if scope_kp_ids else await _course_node_ids(db, course_kp_id)
    if not node_ids:
        return ""
    rows = (
        (
            await db.execute(
                select(LearningResource.knowledge_fragments).where(
                    LearningResource.node_id.in_(node_ids),
                    LearningResource.node_type == "kp",
                    LearningResource.knowledge_fragments.isnot(None),
                    LearningResource.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )

    lines: list[str] = []
    seen: set[tuple[str, str]] = set()
    for fragments in rows:
        for fragment in fragments or []:
            if not isinstance(fragment, dict):
                continue
            ftype = str(fragment.get("type") or "other")
            title = str(fragment.get("title") or "").strip()
            content = str(fragment.get("content") or "").strip()
            if not title and not content:
                continue
            key = (title, content)
            if key in seen:
                continue
            seen.add(key)
            label = _FRAGMENT_TYPE_LABEL.get(ftype, ftype)
            line = f"[{label}] {title}" + (f"：{content}" if content else "")
            lines.append(line)
    return "\n".join(lines)[:_MAX_KB_CHARS]


_VALID_GEN_TYPES = {"choice", "true_false", "fill_in", "short_answer", "essay", "code"}


async def parse_chat_intent(message: str) -> tuple[dict[str, int], int | None]:
    """Parse a free-form chat instruction into a (type_distribution, difficulty).

    Best-effort: a small JSON call infers题型数量与难度；任何失败都回退到默认
    ``{"choice": 5}``，保证对话出题不会因解析失败而中断。
    """
    from app.questions.service import _request_deepseek_json

    prompt = (
        "你是出题助手。请从老师的一句话需求中解析出本次要生成的题型数量分布和难度。\n"
        "题型只能是：choice(选择)/true_false(判断)/fill_in(填空)/short_answer(简答)/essay(论述)/code(编程)。\n"
        "难度为 1~5 的整数；未提及则为 null。未提及数量时默认 {\"choice\": 5}。\n"
        '只返回合法 JSON：{"type_distribution": {"choice": 3}, "difficulty": 3}。\n'
        f"老师需求：{message.strip()[:1000]}"
    )
    try:
        data = await _request_deepseek_json(prompt)
        raw = data.get("type_distribution")
        dist: dict[str, int] = {}
        if isinstance(raw, dict):
            for key, value in raw.items():
                if key in _VALID_GEN_TYPES:
                    try:
                        count = int(value)
                    except (TypeError, ValueError):
                        continue
                    if count > 0:
                        dist[key] = min(count, 50)
        difficulty_raw = data.get("difficulty")
        difficulty = None
        try:
            if difficulty_raw is not None:
                difficulty = max(1, min(5, int(difficulty_raw)))
        except (TypeError, ValueError):
            difficulty = None
        if not dist:
            dist = {"choice": 5}
        return dist, difficulty
    except Exception:  # noqa: BLE001 - parsing must never block generation
        return {"choice": 5}, None


async def assemble_chat_generate_request(
    db: AsyncSession,
    template: QuestionGenTemplate,
    *,
    message: str,
    model: AIModelProvider | None,
) -> AIGenerateRequest:
    """Chat-style: derive types/difficulty from the message, then reuse the form pipeline."""
    type_distribution, difficulty = await parse_chat_intent(message)
    overrides = TemplateGenerateRequest(
        type_distribution=type_distribution,
        difficulty=difficulty,
        extra_prompt=message.strip()[:2000],
        model=model,
    )
    return await assemble_generate_request(db, template, overrides)


async def assemble_generate_request(
    db: AsyncSession,
    template: QuestionGenTemplate,
    overrides: TemplateGenerateRequest,
) -> AIGenerateRequest:
    type_distribution = _resolve_type_distribution(template, overrides)
    total_count = sum(type_distribution.values())
    if total_count < 1:
        raise ValueError("请设置本次出题的题型数量（至少一种题型数量大于 0）。")

    seed_samples = await _collect_seed_samples(db, template)
    prompt = _build_prompt(template, overrides, seed_samples)
    course_kp = await db.get(KnowledgePoint, template.course_kp_id)
    scope = _resolve_scope_kp_ids(template, overrides)

    # Ground generation in the course KB via RAG retrieval (ArkLoop-style):
    # build a query from the scope + audience, retrieve top-k chunks with
    # provenance. Fallback chain: RAG chunks → typed fragments → raw snapshots.
    rag_block = await _retrieve_rag_block(db, template, overrides, scope, course_kp)
    knowledge_base = (
        rag_block
        if rag_block
        else await gather_course_knowledge_base(db, template.course_kp_id, scope_kp_ids=scope or None)
    )
    material_text = _compose_generation_content(knowledge_base, _joined_material_text(template))

    model: AIModelProvider = overrides.model or AIModelProvider.DEEPSEEK

    return AIGenerateRequest(
        total_count=min(total_count, 50),
        difficulty=_resolve_difficulty(template, overrides),
        type_distribution=type_distribution,
        knowledge_point_ids=scope,
        course_name=(course_kp.name if course_kp else ""),
        prompt=prompt,
        material_text=material_text,
        model=model,
    )


_RAG_TOP_K = 12


async def _retrieve_rag_block(
    db: AsyncSession,
    template: QuestionGenTemplate,
    overrides: TemplateGenerateRequest,
    scope: list[uuid.UUID],
    course_kp: KnowledgePoint | None,
) -> str:
    """Retrieve the most relevant KB chunks for this generation request."""
    from app.course_kb import service as kb_service

    query_parts: list[str] = []
    if scope:
        rows = (await db.execute(select(KnowledgePoint.name).where(KnowledgePoint.id.in_(scope)))).scalars().all()
        query_parts.extend(rows)
    elif course_kp is not None:
        query_parts.append(course_kp.name)
    profile = template.student_profile or {}
    if profile.get("teaching_goal"):
        query_parts.append(str(profile["teaching_goal"]))
    if overrides.extra_prompt.strip():
        query_parts.append(overrides.extra_prompt.strip())
    query = " ".join(part for part in query_parts if part).strip()
    if not query:
        return ""

    try:
        hits = await kb_service.search_chunks(
            db,
            course_kp_id=template.course_kp_id,
            query=query,
            k=_RAG_TOP_K,
            scope_node_ids=scope or None,
        )
    except Exception:  # noqa: BLE001 - retrieval must never break generation
        return ""
    if not hits:
        return ""
    return kb_service.format_rag_block(hits)


def _compose_generation_content(knowledge_base: str, raw_snapshots: str) -> str:
    blocks: list[str] = []
    if knowledge_base.strip():
        blocks.append("【课程知识库（出题须基于以下知识片段，并保持与出处一致）】\n" + knowledge_base)
    if raw_snapshots.strip():
        blocks.append("【资料原文（补充参考）】\n" + raw_snapshots)
    return "\n\n".join(blocks)[:_MAX_MATERIAL_TEXT]


async def seed_usage_map(
    db: AsyncSession, *, course_kp_id: uuid.UUID, user_id: uuid.UUID
) -> dict[str, list[dict[str, str]]]:
    """Map question_id -> the owner's skills that use it as a seed (for bank badges)."""
    templates = await list_templates(db, course_kp_id=course_kp_id, user_id=user_id)
    usage: dict[str, list[dict[str, str]]] = {}
    for template in templates:
        for qid in template.seed_question_ids or []:
            usage.setdefault(str(qid), []).append({"id": str(template.id), "name": template.name})
    return usage


def template_summary_fields(template: QuestionGenTemplate) -> dict[str, Any]:
    return {
        "material_count": len(template.materials),
        "seed_count": len(template.seed_question_ids or []) + len(template.manual_seed_questions or []),
    }


# --------------------------------------------------------------------------- #
# Generation run records (audit / 复盘)
# --------------------------------------------------------------------------- #
def build_run_snapshot(template: QuestionGenTemplate, request: AIGenerateRequest) -> dict[str, Any]:
    return {
        "template_id": str(template.id),
        "template_name": template.name,
        "type_distribution": request.type_distribution,
        "total_count": request.total_count,
        "difficulty": request.difficulty,
        "knowledge_point_ids": [str(kp) for kp in request.knowledge_point_ids],
        "prompt_chars": len(request.prompt or ""),
        "material_chars": len(request.material_text or ""),
        "model": request.model.value if hasattr(request.model, "value") else str(request.model),
    }


async def record_run_start(
    *, template_id: uuid.UUID, course_kp_id: uuid.UUID, owner_id: uuid.UUID, snapshot: dict[str, Any]
) -> uuid.UUID:
    """Persist a run row in its own session so streaming can't roll it back."""
    async with async_session() as session:
        run = QuestionGenRun(
            template_id=template_id,
            course_kp_id=course_kp_id,
            owner_id=owner_id,
            status="running",
            resolved_snapshot=snapshot,
        )
        session.add(run)
        await session.commit()
        return run.id


async def record_run_finish(run_id: uuid.UUID, *, status: str, generated_count: int, error_message: str | None) -> None:
    async with async_session() as session:
        run = await session.get(QuestionGenRun, run_id)
        if run is None:
            return
        run.status = status
        run.generated_count = generated_count
        run.error_message = error_message
        await session.commit()


async def list_runs(db: AsyncSession, *, template_id: uuid.UUID, owner_id: uuid.UUID) -> list[QuestionGenRun]:
    stmt = (
        select(QuestionGenRun)
        .where(QuestionGenRun.template_id == template_id, QuestionGenRun.owner_id == owner_id)
        .order_by(QuestionGenRun.created_at.desc())
        .limit(20)
    )
    return list((await db.execute(stmt)).scalars().all())

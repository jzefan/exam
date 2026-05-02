"""Service layer for knowledge management."""

import asyncio
import json
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, cast
from urllib.parse import quote

import httpx
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.common.data_visibility import VisibilityScope
from app.common.resource_access import teacher_visible_resource_filter
from app.config import settings
from app.learning.models import Direction, KnowledgePoint, KnowledgePointPrerequisite, Major
from app.learning.schemas import (
    CatalogPhotoRecognizeRequest,
    DirectionCreate,
    CatalogPhotoRecognizeResponse,
    KnowledgePointCreate,
    KnowledgePointUpdate,
    MajorCreate,
    RecommendationItem,
    RecommendationModel,
)
from app.questions.models import question_knowledge_points

HORIZONTAL_SPACING = 280
VERTICAL_SPACING = 40
logger = logging.getLogger(__name__)

MODEL_CONFIGS = {
    "deepseek": {
        "api_key": "deepseek_api_key",
        "base_url": "deepseek_base_url",
        "model_name": "deepseek_model_name",
    },
    "qwen": {
        "api_key": "qwen_api_key",
        "base_url": "qwen_base_url",
        "model_name": "qwen_model_name",
    },
    "kimi": {
        "api_key": "kimi_api_key",
        "base_url": "kimi_base_url",
        "model_name": "kimi_model_name",
    },
}


def has_cycle(existing_edges: list[tuple[str, str]], new_from: str, new_to: str) -> bool:
    """Return True if adding edge new_from -> new_to creates a cycle."""

    if new_from == new_to:
        return True

    adjacency: dict[str, list[str]] = defaultdict(list)
    for src, tgt in existing_edges:
        adjacency[src].append(tgt)

    queue = deque([new_to])
    visited = {new_to}
    while queue:
        node = queue.popleft()
        for neighbor in adjacency[node]:
            if neighbor == new_from:
                return True
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return False


def build_flow_data(nodes: list[dict[str, Any]], prereqs: list[dict[str, str]]) -> dict[str, Any]:
    """Convert a flat node list and prerequisite list to ReactFlow-compatible data."""

    children_map: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
    for node in nodes:
        children_map[node["parent_id"]].append(node)

    node_positions: dict[str, dict[str, int]] = {}
    node_ids = {n["id"] for n in nodes}
    roots = [n for n in nodes if n["parent_id"] is None or n["parent_id"] not in node_ids]
    next_y_by_depth: dict[int, int] = defaultdict(int)

    def assign_positions(node_id: str, depth: int, y_start: int) -> int:
        children = children_map.get(node_id, [])
        if not children:
            y = max(y_start, next_y_by_depth[depth])
            node_positions[node_id] = {"x": depth * HORIZONTAL_SPACING, "y": y}
            next_y_by_depth[depth] = y + VERTICAL_SPACING
            return next_y_by_depth[depth]

        child_y_start = y_start
        for child in children:
            child_y_start = assign_positions(child["id"], depth + 1, child_y_start)

        first_child_y = node_positions[children[0]["id"]]["y"]
        last_child_y = node_positions[children[-1]["id"]]["y"]
        centered_y = (first_child_y + last_child_y) // 2
        y = max(centered_y, next_y_by_depth[depth])
        node_positions[node_id] = {"x": depth * HORIZONTAL_SPACING, "y": y}
        next_y_by_depth[depth] = y + VERTICAL_SPACING
        return max(child_y_start, next_y_by_depth[depth])

    y_cursor = next_y_by_depth[0]
    for root in roots:
        y_cursor = assign_positions(root["id"], 0, y_cursor)

    flow_nodes = [
        {
            "id": node["id"],
            "type": "knowledgeNode",
            "position": node_positions.get(node["id"], {"x": 0, "y": 0}),
            "data": node,
        }
        for node in nodes
    ]

    flow_edges: list[dict[str, str]] = []
    for node in nodes:
        if node["parent_id"] and node["parent_id"] in node_ids:
            flow_edges.append(
                {
                    "id": f"pc-{node['parent_id']}-{node['id']}",
                    "source": node["parent_id"],
                    "target": node["id"],
                    "type": "smoothstep",
                }
            )

    for prereq in prereqs:
        flow_edges.append(
            {
                "id": f"prereq-{prereq['from_id']}-{prereq['to_id']}",
                "source": prereq["from_id"],
                "target": prereq["to_id"],
                "type": "prerequisite",
            }
        )

    return {"nodes": flow_nodes, "edges": flow_edges}


async def list_majors(
    db: AsyncSession,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> list[Major]:
    stmt = select(Major).where(Major.deleted_at.is_(None))
    result = await db.execute(stmt.order_by(Major.name))
    return list(result.scalars().all())


async def get_major(
    db: AsyncSession,
    major_id: uuid.UUID,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> Major | None:
    stmt = select(Major).where(Major.id == major_id, Major.deleted_at.is_(None))
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def find_major_by_name_for_owner(
    db: AsyncSession,
    *,
    owner_id: uuid.UUID,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> Major | None:
    stmt = select(Major).where(
        Major.owner_id == owner_id,
        Major.name == name,
        Major.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Major.id != exclude_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_major(db: AsyncSession, data: MajorCreate, owner_id: uuid.UUID) -> Major:
    major = Major(**data.model_dump(), owner_id=owner_id)
    db.add(major)
    await db.commit()
    await db.refresh(major)
    return major


async def update_major(db: AsyncSession, major: Major, data: dict[str, Any]) -> Major:
    for key, value in data.items():
        setattr(major, key, value)
    await db.commit()
    await db.refresh(major)
    return major


async def soft_delete_major(db: AsyncSession, major: Major) -> None:
    major.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def major_has_foreign_knowledge_points(
    db: AsyncSession,
    major_id: uuid.UUID,
    *,
    current_user_id: uuid.UUID,
) -> bool:
    stmt = (
        select(KnowledgePoint.id)
        .join(Direction, KnowledgePoint.direction_id == Direction.id)
        .where(
            Direction.major_id == major_id,
            Direction.deleted_at.is_(None),
            KnowledgePoint.deleted_at.is_(None),
            KnowledgePoint.owner_id != current_user_id,
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none() is not None


async def list_directions(
    db: AsyncSession,
    major_id: uuid.UUID,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> list[Direction]:
    stmt = select(Direction).where(Direction.major_id == major_id, Direction.deleted_at.is_(None))
    result = await db.execute(stmt.order_by(Direction.name))
    return list(result.scalars().all())


async def list_root_knowledge_point_options(
    db: AsyncSession,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> list[dict[str, Any]]:
    """Return visible top-level knowledge points as selectable roots."""

    stmt = (
        select(KnowledgePoint, Direction, Major)
        .join(Direction, KnowledgePoint.direction_id == Direction.id)
        .join(Major, Direction.major_id == Major.id)
        .where(
            KnowledgePoint.deleted_at.is_(None),
            KnowledgePoint.parent_id.is_(None),
            Direction.deleted_at.is_(None),
            Major.deleted_at.is_(None),
        )
        .order_by(Major.name, Direction.name, KnowledgePoint.name)
    )
    if not is_platform_admin and user is not None:
        stmt = stmt.where(teacher_visible_resource_filter(KnowledgePoint, user.id))

    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": kp.id,
            "name": kp.name,
            "direction_id": direction.id,
            "direction_name": direction.name,
            "major_id": major.id,
            "major_name": major.name,
        }
        for kp, direction, major in rows
    ]


async def list_course_options(
    db: AsyncSession,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> list[dict[str, Any]]:
    """Compatibility alias for top-level knowledge point options."""
    return await list_root_knowledge_point_options(
        db,
        user=user,
        is_platform_admin=is_platform_admin,
    )


async def find_direction_by_name_for_owner(
    db: AsyncSession,
    *,
    owner_id: uuid.UUID,
    major_id: uuid.UUID,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> Direction | None:
    stmt = select(Direction).where(
        Direction.owner_id == owner_id,
        Direction.major_id == major_id,
        Direction.name == name,
        Direction.deleted_at.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(Direction.id != exclude_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_direction(
    db: AsyncSession,
    direction_id: uuid.UUID,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> Direction | None:
    stmt = select(Direction).where(Direction.id == direction_id, Direction.deleted_at.is_(None))
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_direction(db: AsyncSession, data: DirectionCreate, owner_id: uuid.UUID) -> Direction:
    direction = Direction(**data.model_dump(), owner_id=owner_id)
    db.add(direction)
    await db.commit()
    await db.refresh(direction)
    return direction


async def update_direction(db: AsyncSession, direction: Direction, data: dict[str, Any]) -> Direction:
    for key, value in data.items():
        setattr(direction, key, value)
    await db.commit()
    await db.refresh(direction)
    return direction


async def soft_delete_direction(db: AsyncSession, direction: Direction) -> None:
    direction.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def direction_has_foreign_knowledge_points(
    db: AsyncSession,
    direction_id: uuid.UUID,
    *,
    current_user_id: uuid.UUID,
) -> bool:
    stmt = (
        select(KnowledgePoint.id)
        .where(
            KnowledgePoint.direction_id == direction_id,
            KnowledgePoint.deleted_at.is_(None),
            KnowledgePoint.owner_id != current_user_id,
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none() is not None


def _visible_knowledge_point_query(*, user: User | None, is_platform_admin: bool):
    query = select(KnowledgePoint).where(KnowledgePoint.deleted_at.is_(None))
    if not is_platform_admin and user is not None:
        query = query.where(teacher_visible_resource_filter(KnowledgePoint, user.id))
    return query


async def get_direction_tree(
    db: AsyncSession,
    direction_id: uuid.UUID,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> dict[str, Any]:
    """Return ReactFlow-compatible flow data for one direction."""

    count_subq = (
        select(question_knowledge_points.c.knowledge_point_id, func.count().label("cnt"))
        .group_by(question_knowledge_points.c.knowledge_point_id)
        .subquery()
    )
    stmt = (
        select(KnowledgePoint, func.coalesce(count_subq.c.cnt, 0).label("question_count"))
        .outerjoin(count_subq, KnowledgePoint.id == count_subq.c.knowledge_point_id)
        .where(KnowledgePoint.direction_id == direction_id, KnowledgePoint.deleted_at.is_(None))
    )
    if not is_platform_admin and user is not None:
        stmt = stmt.where(teacher_visible_resource_filter(KnowledgePoint, user.id))
    rows = (await db.execute(stmt)).all()

    flat_nodes = [
        {
            "id": str(kp.id),
            "name": kp.name,
            "description": kp.description,
            "tags": kp.tags or [],
            "difficulty": kp.difficulty,
            "parent_id": str(kp.parent_id) if kp.parent_id else None,
            "direction_id": str(kp.direction_id) if kp.direction_id else None,
            "owner_id": str(kp.owner_id),
            "visibility": kp.visibility.value,
            "question_count": question_count,
        }
        for kp, question_count in rows
    ]

    if not flat_nodes:
        return {"nodes": [], "edges": []}

    node_ids = {n["id"] for n in flat_nodes}
    prereq_stmt = select(KnowledgePointPrerequisite).where(
        KnowledgePointPrerequisite.to_id.in_([uuid.UUID(node_id) for node_id in node_ids])
    )
    prereq_rows = (await db.execute(prereq_stmt)).scalars().all()
    prereqs = [
        {"from_id": str(prereq.from_id), "to_id": str(prereq.to_id)}
        for prereq in prereq_rows
        if str(prereq.from_id) in node_ids
    ]

    return build_flow_data(flat_nodes, prereqs)


async def create_knowledge_point(db: AsyncSession, data: KnowledgePointCreate, user_id: uuid.UUID) -> KnowledgePoint:
    kp = KnowledgePoint(**data.model_dump(), owner_id=user_id, visibility=VisibilityScope.PRIVATE)
    db.add(kp)
    await db.commit()
    await db.refresh(kp)
    return kp


async def update_knowledge_point(
    db: AsyncSession, kp: KnowledgePoint, data: KnowledgePointUpdate
) -> KnowledgePoint:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(kp, key, value)
    await db.commit()
    await db.refresh(kp)
    return kp


async def soft_delete_knowledge_point(db: AsyncSession, kp: KnowledgePoint) -> None:
    """Soft-delete this node and all descendants recursively."""

    now = datetime.now(timezone.utc)

    async def _delete_subtree(node_id: uuid.UUID) -> None:
        children_result = await db.execute(
            select(KnowledgePoint).where(KnowledgePoint.parent_id == node_id, KnowledgePoint.deleted_at.is_(None))
        )
        for child in children_result.scalars().all():
            await _delete_subtree(child.id)
            child.deleted_at = now

    await _delete_subtree(kp.id)
    kp.deleted_at = now
    await db.commit()


async def get_knowledge_point(
    db: AsyncSession,
    kp_id: uuid.UUID,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> KnowledgePoint | None:
    result = await db.execute(
        _visible_knowledge_point_query(user=user, is_platform_admin=is_platform_admin).where(KnowledgePoint.id == kp_id)
    )
    return result.scalar_one_or_none()


async def add_prerequisite(db: AsyncSession, kp_id: uuid.UUID, from_id: uuid.UUID) -> KnowledgePointPrerequisite:
    """Add prerequisite: from_id must be learned before kp_id."""

    existing = (await db.execute(select(KnowledgePointPrerequisite))).scalars().all()
    edges = [(str(prereq.from_id), str(prereq.to_id)) for prereq in existing]
    if has_cycle(edges, new_from=str(from_id), new_to=str(kp_id)):
        raise ValueError("Adding this prerequisite would create a cycle")

    prereq = KnowledgePointPrerequisite(from_id=from_id, to_id=kp_id)
    db.add(prereq)
    await db.commit()
    await db.refresh(prereq)
    return prereq


async def remove_prerequisite(db: AsyncSession, kp_id: uuid.UUID, prereq_id: uuid.UUID) -> None:
    result = await db.execute(
        select(KnowledgePointPrerequisite).where(
            KnowledgePointPrerequisite.id == prereq_id,
            KnowledgePointPrerequisite.to_id == kp_id,
        )
    )
    prereq = result.scalar_one_or_none()
    if prereq:
        await db.delete(prereq)
        await db.commit()


async def get_knowledge_context(db: AsyncSession, kp_id: uuid.UUID) -> dict[str, str]:
    stmt = (
        select(KnowledgePoint, Direction, Major)
        .join(Direction, KnowledgePoint.direction_id == Direction.id)
        .join(Major, Direction.major_id == Major.id)
        .where(
            KnowledgePoint.id == kp_id,
            KnowledgePoint.deleted_at.is_(None),
            Direction.deleted_at.is_(None),
            Major.deleted_at.is_(None),
        )
    )
    row = (await db.execute(stmt)).one_or_none()
    if not row:
        raise ValueError("Knowledge point context not found")
    kp, direction, major = row
    return {
        "major_name": major.name,
        "major_description": major.description or "",
        "direction_name": direction.name,
        "direction_description": direction.description or "",
        "knowledge_point_name": kp.name,
        "knowledge_point_description": kp.description or "",
    }


def _extract_json_payload(content: str) -> list[dict[str, str]]:
    payload = content.strip()
    if "```" in payload:
        start = payload.find("```")
        end = payload.rfind("```")
        if start != -1 and end != -1 and end > start:
            fenced = payload[start + 3 : end].strip()
            if fenced.startswith("json"):
                fenced = fenced[4:].strip()
            payload = fenced

    data = json.loads(payload)
    if isinstance(data, dict):
        items = data.get("items", [])
    else:
        items = data
    if not isinstance(items, list):
        raise ValueError("AI 返回格式不正确")

    normalized: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        description = str(item.get("description", "")).strip()
        query = str(item.get("query", "")).strip()
        if not query:
            query = " ".join(part for part in [title, description] if part).strip()
        if not query:
            continue
        normalized.append(
            {
                "title": title or query,
                "description": description or query,
                "query": query,
            }
        )
    if not normalized:
        raise ValueError("AI 没有返回可用的推荐资料")
    return normalized[:6]


def _strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value).strip()


def _normalize_catalog_paths(payload: object) -> list[list[str]]:
    paths = payload.get("paths", []) if isinstance(payload, dict) else payload
    if not isinstance(paths, list):
        raise ValueError("AI 返回格式不正确")

    normalized: list[list[str]] = []
    seen: set[str] = set()
    for path in paths:
        if not isinstance(path, list):
            continue
        cleaned = [str(part).strip() for part in path if str(part).strip()]
        if not cleaned:
            continue
        key = " > ".join(cleaned)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(cleaned)

    if not normalized:
        raise ValueError("没有识别到可导入的目录结构")
    return normalized


_CATALOG_LINE_PREFIX = re.compile(
    r"^(?P<prefix>"
    r"第[一二三四五六七八九十百千万两\d]+(?:部分|单元|章节|章|节|篇|编|卷)"
    r"|(?:Chapter|Unit|Part|Module|Section)\s+(?:[IVXLCDM]+|\d+(?:\.\d+)*)\.?"
    r"|[一二三四五六七八九十]+[、.]"
    r"|[（(][一二三四五六七八九十\d]+[）)]"
    r"|\d+(?:\.\d+)*[、.]?"
    r")\s*(?P<title>.+)$",
    re.IGNORECASE,
)

_CATALOG_TOP_LEVEL_CN_SUFFIXES = ("部分", "单元", "章", "篇", "编", "卷")
_CATALOG_EN_TOP_LEVEL_PREFIXES = {"chapter", "unit", "part", "module"}
_CATALOG_EN_SECOND_LEVEL_PREFIXES = {"section"}


def _clean_catalog_line(line: str) -> str:
    cleaned = re.sub(r"\s+", " ", line.strip())
    cleaned = re.sub(r"[.·。．…]{2,}\s*\d+\s*$", "", cleaned).strip()
    cleaned = re.sub(r"[-—_]{2,}\s*\d+\s*$", "", cleaned).strip()
    cleaned = re.sub(r"\s*[.·。．…]\s*\d+\s*$", "", cleaned).strip()
    cleaned = re.sub(r"\s+\d+\s*$", "", cleaned).strip()
    return cleaned.strip(" \t-—")


def _catalog_line_level(line: str) -> tuple[int, str] | None:
    match = _CATALOG_LINE_PREFIX.match(line)
    if not match:
        return None

    prefix = match.group("prefix").rstrip("、.")
    title = _clean_catalog_line(match.group("title"))
    if not title:
        return None
    text = f"{prefix} {title}".strip()
    prefix_lower = prefix.lower()

    if prefix.startswith("第") and prefix.endswith(_CATALOG_TOP_LEVEL_CN_SUFFIXES):
        return 1, text
    if prefix.startswith("第") and prefix[-1] == "节":
        return 2, text
    if any(prefix_lower.startswith(f"{keyword} ") for keyword in _CATALOG_EN_TOP_LEVEL_PREFIXES):
        return 1, text
    if any(prefix_lower.startswith(f"{keyword} ") for keyword in _CATALOG_EN_SECOND_LEVEL_PREFIXES):
        return 2, text
    if re.match(r"^\d+(?:\.\d+)+$", prefix):
        return prefix.count(".") + 1, text
    if re.match(r"^\d+$", prefix):
        return 1, text
    if re.match(r"^[一二三四五六七八九十]+$", prefix):
        return 1, text
    if re.match(r"^[（(][一二三四五六七八九十\d]+[）)]$", prefix):
        return 2, text
    return None


def _parse_catalog_paths_from_text(text: str) -> list[list[str]]:
    stack: list[str] = []
    paths: list[list[str]] = []
    seen: set[str] = set()

    for raw_line in text.splitlines():
        line = _clean_catalog_line(raw_line)
        if not line or len(line) <= 1:
            continue
        if re.fullmatch(r"\d+", line):
            continue
        parsed = _catalog_line_level(line)
        if not parsed:
            continue

        level, title = parsed
        stack = stack[: max(level - 1, 0)]
        stack.append(title)
        key = " > ".join(stack)
        if key not in seen:
            seen.add(key)
            paths.append(stack.copy())

    if not paths:
        raise ValueError("已识别到文字，但未能整理出目录层级，请调整图片顺序后重试。")
    return paths


def _ensure_data_url(image: str) -> str:
    if image.strip().lower().startswith("data:"):
        return image
    return f"data:image/jpeg;base64,{image}"


_CATALOG_VL_PROMPT = """你是图书目录结构化助手。请仔细阅读用户提供的一张或多张书籍目录照片，按从上到下、从第一张到最后一张的顺序，完整提取所有目录条目并还原层级关系（章、节、小节等）。

要求：
1. 只输出合法 JSON，不要任何解释、不要 Markdown 代码块。
2. JSON 格式：{"paths": [["第一章 xxx", "1.1 xxx", "1.1.1 xxx"], ["第一章 xxx", "1.2 xxx"], ...]}。
3. 每个 path 是一条从最顶层到某个叶子节点的完整层级数组。
4. 去除页码、前后空白；保留书名号、顿号等正文符号。
5. 同一目录条目跨页出现时仅输出一次，不要重复。
6. 不要编造目录中不存在的内容。
7. 必须尽量完整提取当前图片中所有可见目录行，不要只输出每章前几个条目，也不要只输出示例或摘要。"""
_CATALOG_SINGLE_IMAGE_TIMEOUT_SECONDS = 30.0
_CATALOG_VISION_MAX_CONCURRENCY = 4


async def _recognize_catalog_with_qwen_vl(images: list[str]) -> list[list[str]]:
    api_key = settings.qwen_api_key
    if not api_key:
        raise RuntimeError("未配置 Qwen API Key，请联系管理员。")

    base_url = settings.qwen_base_url.rstrip("/")
    model_name = settings.qwen_vl_model_name

    content: list[dict[str, Any]] = [{"type": "text", "text": _CATALOG_VL_PROMPT}]
    for image in images:
        content.append({"type": "image_url", "image_url": {"url": _ensure_data_url(image)}})

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": "你只输出合法 JSON。"},
                    {"role": "user", "content": content},
                ],
                "temperature": 0.1,
                "max_tokens": 8192,
            },
        )

    if response.status_code >= 400:
        detail = response.text.strip() or "AI 服务请求失败"
        raise RuntimeError(f"目录识别失败：{detail[:200]}")

    raw = (
        response.json()
        .get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("未识别到目录内容，请换一张更清晰的照片。")

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("目录识别结果格式异常，请重试。") from exc

    raw_paths = payload.get("paths") if isinstance(payload, dict) else None
    if not isinstance(raw_paths, list):
        raise ValueError("未识别到目录层级，请换一张更清晰的照片。")

    cleaned: list[list[str]] = []
    for item in raw_paths:
        if not isinstance(item, list):
            continue
        segs = [str(seg).strip() for seg in item if str(seg).strip()]
        if segs:
            cleaned.append(segs)

    if not cleaned:
        raise ValueError("未识别到目录层级，请换一张更清晰的照片。")
    return cleaned


async def _recognize_catalog_with_deepseek_vl(images: list[str]) -> list[list[str]]:
    api_key = settings.deepseek_api_key
    if not api_key:
        raise RuntimeError("未配置 DeepSeek API Key，请联系管理员。")

    base_url = settings.deepseek_base_url.rstrip("/")
    model_name = settings.deepseek_model_name

    content: list[dict[str, Any]] = [{"type": "text", "text": _CATALOG_VL_PROMPT}]
    for image in images:
        content.append({"type": "image_url", "image_url": {"url": _ensure_data_url(image)}})

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": "你只输出合法 JSON。"},
                    {"role": "user", "content": content},
                ],
                "temperature": 0.1,
                "max_tokens": 8192,
            },
        )

    if response.status_code >= 400:
        detail = response.text.strip() or "AI 服务请求失败"
        raise RuntimeError(f"目录识别失败：{detail[:200]}")

    raw = (
        response.json()
        .get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("未识别到目录内容，请换一张更清晰的照片。")

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("目录识别结果格式异常，请重试。") from exc

    raw_paths = payload.get("paths") if isinstance(payload, dict) else None
    if not isinstance(raw_paths, list):
        raise ValueError("未识别到目录层级，请换一张更清晰的照片。")

    cleaned: list[list[str]] = []
    for item in raw_paths:
        if not isinstance(item, list):
            continue
        segs = [str(seg).strip() for seg in item if str(seg).strip()]
        if segs:
            cleaned.append(segs)

    if not cleaned:
        raise ValueError("未识别到目录层级，请换一张更清晰的照片。")
    return cleaned


def _is_provider_unavailable_error(exc: Exception) -> bool:
    message = str(exc)
    return "API Key" in message or "暂不可用" in message


def _is_catalog_excluded_segment(segment: str) -> bool:
    cleaned = _clean_catalog_line(segment)
    if not cleaned:
        return False
    cleaned_lower = cleaned.lower()
    excluded_keywords = (
        "附录",
        "习题",
        "练习题",
        "本章小结",
        "本章重要概念",
        "本章的重要概念",
        "复习题",
        "思考题",
        "思考与练习",
        "appendix",
        "exercises",
        "review questions",
    )
    return any(keyword in cleaned_lower or keyword in cleaned for keyword in excluded_keywords)


_CHINESE_DIGITS = {
    "零": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_CHINESE_UNITS = {
    "十": 10,
    "百": 100,
    "千": 1000,
    "万": 10000,
}
_ROMAN_NUMERAL_MAP = {
    "I": 1,
    "V": 5,
    "X": 10,
    "L": 50,
    "C": 100,
    "D": 500,
    "M": 1000,
}


def _parse_chinese_number_token(token: str) -> int | None:
    if not token:
        return None
    if token.isdigit():
        return int(token)

    total = 0
    current = 0
    for char in token:
        if char in _CHINESE_DIGITS:
            current = _CHINESE_DIGITS[char]
            continue
        if char in _CHINESE_UNITS:
            unit = _CHINESE_UNITS[char]
            if current == 0:
                current = 1
            total += current * unit
            current = 0
            continue
        return None
    return total + current


def _parse_roman_number_token(token: str) -> int | None:
    if not token:
        return None
    token = token.upper()
    total = 0
    previous = 0
    for char in reversed(token):
        value = _ROMAN_NUMERAL_MAP.get(char)
        if value is None:
            return None
        if value < previous:
            total -= value
        else:
            total += value
            previous = value
    return total


def _catalog_explicit_anchor_key(segment: str) -> str | None:
    cleaned = _clean_catalog_line(segment)

    cn_match = re.match(r"^第([一二三四五六七八九十百千万两\d]+)(部分|单元|章|篇|编|卷)\b", cleaned)
    if cn_match:
        value = _parse_chinese_number_token(cn_match.group(1))
        return str(value) if value is not None else None

    en_match = re.match(
        r"^(Chapter|Unit|Part|Module)\s+([IVXLCDM]+|\d+(?:\.\d+)*)\b",
        cleaned,
        re.IGNORECASE,
    )
    if en_match:
        number_token = en_match.group(2)
        if re.fullmatch(r"\d+(?:\.\d+)*", number_token):
            return number_token.split(".", 1)[0]
        value = _parse_roman_number_token(number_token)
        return str(value) if value is not None else None
    return None


def _catalog_chapter_key_for_segment(segment: str) -> str | None:
    explicit_key = _catalog_explicit_anchor_key(segment)
    if explicit_key is not None:
        return explicit_key

    cleaned = _clean_catalog_line(segment)
    section_match = re.match(r"^(\d+)(?:\.\d+)*\b", cleaned)
    if section_match:
        return section_match.group(1)
    return None


def _catalog_decimal_prefix(segment: str) -> str | None:
    cleaned = _clean_catalog_line(segment)
    match = re.match(r"^(\d+(?:\.\d+)+)\b", cleaned)
    return match.group(1) if match else None


def _catalog_prefix_candidate_rank(path: list[str], prefix: str) -> tuple[int, int]:
    chapter_key = prefix.split(".", 1)[0]
    explicit_anchor_key = None
    for segment in path:
        explicit_anchor_key = _catalog_explicit_anchor_key(segment)
        if explicit_anchor_key is not None:
            break
    if explicit_anchor_key == chapter_key:
        anchor_score = 2
    elif explicit_anchor_key is None:
        anchor_score = 1
    else:
        anchor_score = 0
    return (anchor_score, -len(path))


def _restore_missing_catalog_decimal_parents(
    path: list[str],
    prefix_paths: dict[str, list[str]],
) -> list[str]:
    for index, segment in enumerate(path):
        prefix = _catalog_decimal_prefix(segment)
        if not prefix or "." not in prefix:
            continue

        parent_prefix = prefix.rsplit(".", 1)[0]
        while "." in parent_prefix or parent_prefix:
            parent_path = prefix_paths.get(parent_prefix)
            if parent_path and parent_path[-1] not in path[:index]:
                return [*parent_path, *path[index:]]
            if "." not in parent_prefix:
                break
            parent_prefix = parent_prefix.rsplit(".", 1)[0]
    return path


def _remember_catalog_decimal_prefixes(path: list[str], prefix_paths: dict[str, list[str]]) -> None:
    for index, segment in enumerate(path):
        prefix = _catalog_decimal_prefix(segment)
        if prefix:
            candidate = path[: index + 1]
            existing = prefix_paths.get(prefix)
            if existing is None or _catalog_prefix_candidate_rank(candidate, prefix) > _catalog_prefix_candidate_rank(existing, prefix):
                prefix_paths[prefix] = candidate


def _page_chapter_anchors(paths: list[list[str]]) -> dict[str, str]:
    anchors: dict[str, str] = {}
    for path in paths:
        for segment in path:
            parsed = _catalog_line_level(segment)
            if not parsed:
                continue
            level, title = parsed
            if level != 1:
                continue
            chapter_key = _catalog_explicit_anchor_key(title)
            if chapter_key:
                anchors[chapter_key] = title
    return anchors


def _stitch_catalog_paths_across_pages(image_paths: list[list[list[str]]]) -> list[list[str]]:
    stitched: list[list[str]] = []
    last_stack: list[str] = []
    prefix_paths: dict[str, list[str]] = {}

    for paths in image_paths:
        page_chapter_anchors = _page_chapter_anchors(paths)
        for path in paths:
            resolved: list[str] = []
            for index, segment in enumerate(path):
                parsed = _catalog_line_level(segment)
                if parsed:
                    level, title = parsed
                    base_stack = last_stack if index == 0 else resolved
                    if index == 0 and level >= 2:
                        chapter_key = _catalog_chapter_key_for_segment(title)
                        chapter_anchor = page_chapter_anchors.get(chapter_key or "")
                        if chapter_anchor:
                            base_stack = [chapter_anchor]
                    resolved = base_stack[: max(level - 1, 0)] + [title]
                    continue

                title = _clean_catalog_line(segment)
                if not title:
                    continue
                if index == 0:
                    resolved = [title]
                else:
                    resolved.append(title)

            if resolved:
                resolved = _restore_missing_catalog_decimal_parents(resolved, prefix_paths)
                if any(_is_catalog_excluded_segment(segment) for segment in resolved):
                    continue
                stitched.append(resolved)
                _remember_catalog_decimal_prefixes(resolved, prefix_paths)
                last_stack = resolved.copy()

    return stitched


def _merge_catalog_paths(image_paths: list[list[list[str]]]) -> list[list[str]]:
    merged: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()
    reattached_paths = _reattach_paths_to_global_anchors(_stitch_catalog_paths_across_pages(image_paths))
    normalized_paths = _restore_catalog_decimal_parents_from_all_paths(reattached_paths)
    for path in normalized_paths:
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)
        merged.append(path)
    return _order_catalog_paths(merged)


def _restore_catalog_decimal_parents_from_all_paths(paths: list[list[str]]) -> list[list[str]]:
    prefix_paths: dict[str, list[str]] = {}
    for path in paths:
        _remember_catalog_decimal_prefixes(path, prefix_paths)
    return [_restore_missing_catalog_decimal_parents(path, prefix_paths) for path in paths]


def _reattach_paths_to_global_anchors(paths: list[list[str]]) -> list[list[str]]:
    explicit_anchor_by_key: dict[str, str] = {}
    for path in paths:
        if not path:
            continue
        anchor_key = _catalog_explicit_anchor_key(path[0])
        if anchor_key and anchor_key not in explicit_anchor_by_key:
            explicit_anchor_by_key[anchor_key] = path[0]

    corrected: list[list[str]] = []
    for path in paths:
        if not path:
            continue

        first_anchor_key = _catalog_explicit_anchor_key(path[0])
        if first_anchor_key is None:
            leading_key = _catalog_chapter_key_for_segment(path[0])
            replacement_anchor = explicit_anchor_by_key.get(leading_key or "")
            if replacement_anchor:
                corrected.append([replacement_anchor, *path])
                continue
            corrected.append(path)
            continue

        replacement_path: list[str] | None = None
        for index in range(1, len(path)):
            segment_key = _catalog_chapter_key_for_segment(path[index])
            replacement_anchor = explicit_anchor_by_key.get(segment_key or "")
            if segment_key and replacement_anchor and segment_key != first_anchor_key:
                replacement_path = [replacement_anchor, *path[index:]]
                break

        if replacement_path is not None:
            corrected.append(replacement_path)
            continue

        corrected.append(path)

    return corrected


def _order_catalog_paths(paths: list[list[str]]) -> list[list[str]]:
    class _TreeNode:
        __slots__ = ("label", "children", "child_order", "is_terminal")

        def __init__(self, label: str):
            self.label = label
            self.children: dict[str, "_TreeNode"] = {}
            self.child_order: list[str] = []
            self.is_terminal = False

    roots: dict[str, _TreeNode] = {}
    root_order: list[str] = []

    for path in paths:
        siblings = roots
        sibling_order = root_order
        for label in path:
            if label not in siblings:
                siblings[label] = _TreeNode(label)
                sibling_order.append(label)
            node = siblings[label]
            siblings = node.children
            sibling_order = node.child_order
        node.is_terminal = True

    ordered: list[list[str]] = []

    def walk(labels: list[str], siblings: dict[str, _TreeNode], sibling_order: list[str]) -> None:
        for label in sibling_order:
            node = siblings[label]
            next_labels = [*labels, label]
            if node.is_terminal:
                ordered.append(next_labels)
            walk(next_labels, node.children, node.child_order)

    walk([], roots, root_order)
    return ordered


async def _recognize_catalog_single_image(
    recognizer: Callable[[list[str]], Awaitable[list[list[str]]]],
    image: str,
    *,
    image_index: int,
    semaphore: asyncio.Semaphore,
) -> list[list[str]]:
    image_label = f"第 {image_index + 1} 张图片"
    async with semaphore:
        try:
            return await asyncio.wait_for(
                recognizer([image]),
                timeout=_CATALOG_SINGLE_IMAGE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            raise RuntimeError(
                f"{image_label}识别超时，请减少单次上传数量，或更换更清晰的图片后重试。"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"{image_label}网络请求失败，请稍后重试。") from exc
        except (RuntimeError, ValueError) as exc:
            if _is_provider_unavailable_error(exc):
                raise
            raise RuntimeError(f"{image_label}识别失败：{exc}") from exc


async def _recognize_catalog_images_with_engine(
    recognizer: Callable[[list[str]], Awaitable[list[list[str]]]],
    images: list[str],
) -> list[list[str]]:
    semaphore = asyncio.Semaphore(min(_CATALOG_VISION_MAX_CONCURRENCY, len(images)))
    results = await asyncio.gather(
        *[
            _recognize_catalog_single_image(
                recognizer,
                image,
                image_index=index,
                semaphore=semaphore,
            )
            for index, image in enumerate(images)
        ],
        return_exceptions=True,
    )

    unavailable_errors = [
        result
        for result in results
        if isinstance(result, Exception) and _is_provider_unavailable_error(result)
    ]
    if unavailable_errors and len(unavailable_errors) == len(results):
        raise unavailable_errors[0]

    for result in results:
        if isinstance(result, Exception):
            raise result

    raw_image_paths = cast(list[list[list[str]]], results)
    merged_paths = _merge_catalog_paths(raw_image_paths)
    logger.info(
        "Catalog photo recognition path counts: per_image=%s merged=%s",
        [len(paths) for paths in raw_image_paths],
        len(merged_paths),
    )
    logger.debug(
        "Catalog photo recognition raw_paths=%s merged_paths=%s",
        raw_image_paths,
        merged_paths,
    )
    return merged_paths


async def recognize_catalog_structure_from_images(
    request: CatalogPhotoRecognizeRequest,
) -> CatalogPhotoRecognizeResponse:
    recognizers = (
        _recognize_catalog_with_deepseek_vl,
        _recognize_catalog_with_qwen_vl,
    )
    last_error: Exception | None = None
    unavailable_errors: list[Exception] = []

    for recognizer in recognizers:
        try:
            paths = await _recognize_catalog_images_with_engine(recognizer, request.images)
            return CatalogPhotoRecognizeResponse(paths=paths)
        except (RuntimeError, ValueError) as exc:
            last_error = exc
            if _is_provider_unavailable_error(exc):
                unavailable_errors.append(exc)
                continue

    if unavailable_errors and len(unavailable_errors) == len(recognizers):
        raise RuntimeError("目录识别服务暂不可用，请联系管理员处理。") from unavailable_errors[-1]
    if last_error is not None:
        raise last_error
    raise RuntimeError("目录识别服务暂不可用，请联系管理员处理。")


async def _search_bilibili_videos(query: str) -> list[RecommendationItem]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            "https://api.bilibili.com/x/web-interface/search/type",
            params={"search_type": "video", "keyword": query},
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://www.bilibili.com/",
            },
        )

    if response.status_code >= 400:
        return []

    result = response.json().get("data", {}).get("result", [])
    if not isinstance(result, list):
        return []

    items: list[RecommendationItem] = []
    for row in result[:3]:
        if not isinstance(row, dict):
            continue
        arcurl = str(row.get("arcurl", "")).strip()
        bvid = str(row.get("bvid", "")).strip()
        url = arcurl or (f"https://www.bilibili.com/video/{bvid}" if bvid else "")
        if not url:
            continue
        title = _strip_html(str(row.get("title", "")).strip()) or query
        author = str(row.get("author", "")).strip()
        play = str(row.get("play", "")).strip()
        duration = str(row.get("duration", "")).strip()
        description_parts = [part for part in [query, author and f"UP主：{author}", play and f"播放：{play}", duration] if part]
        items.append(
            RecommendationItem(
                title=title,
                description=" | ".join(description_parts),
                url=url,
                source="bilibili",
            )
        )
    return items


async def generate_bilibili_recommendations(
    db: AsyncSession, kp_id: uuid.UUID, model: RecommendationModel
) -> list[RecommendationItem]:
    context = await get_knowledge_context(db, kp_id)
    config = MODEL_CONFIGS[model]
    api_key = cast(str | None, getattr(settings, config["api_key"]))
    if not api_key:
        raise RuntimeError(f"未配置 {model} 的 API Key")

    base_url = cast(str, getattr(settings, config["base_url"])).rstrip("/")
    model_name = cast(str, getattr(settings, config["model_name"]))
    prompt = f"""
你是中文学习资源策划助手。请基于以下知识点上下文，推荐 4 到 6 个适合在 B 站搜索的学习资料。

专业：{context["major_name"]}
专业说明：{context["major_description"] or "无"}
方向：{context["direction_name"]}
方向说明：{context["direction_description"] or "无"}
知识点：{context["knowledge_point_name"]}
知识点描述：{context["knowledge_point_description"] or "无"}

要求：
1. 返回 JSON，不要返回 Markdown，不要返回额外解释。
2. JSON 格式为对象，形如 {{"items":[...]}}，每项包含 title、description、query 三个字段。
3. query 必须是适合直接去 B 站搜索的中文关键词。
4. 推荐内容尽量覆盖入门讲解、系统课程、实战案例、避坑/进阶。
"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model_name,
                "messages": [
                    {"role": "system", "content": "你只输出合法 JSON。"},
                    {"role": "user", "content": prompt.strip()},
                ],
                "temperature": 0.6,
            },
        )
    if response.status_code >= 400:
        detail = response.text.strip() or "AI 服务请求失败"
        raise RuntimeError(detail)

    content = (
        response.json()
        .get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("AI 服务没有返回内容")

    try:
        parsed = _extract_json_payload(content)
    except (json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError(f"AI 返回格式不可用：{exc}") from exc

    recommendations: list[RecommendationItem] = []
    seen_urls: set[str] = set()

    for item in parsed:
        bilibili_items = await _search_bilibili_videos(item["query"])
        for bilibili_item in bilibili_items:
            if bilibili_item.url in seen_urls:
                continue
            recommendations.append(bilibili_item)
            seen_urls.add(bilibili_item.url)
            if len(recommendations) >= 6:
                return recommendations

    if recommendations:
        return recommendations

    return [
        RecommendationItem(
            title=item["title"],
            description=item["description"],
            url=f"https://search.bilibili.com/all?keyword={quote(item['query'])}",
            source="bilibili",
        )
        for item in parsed
    ]

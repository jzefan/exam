"""Service layer for knowledge management."""

import json
import re
import uuid
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
    DirectionCreate,
    KnowledgePointCreate,
    KnowledgePointUpdate,
    MajorCreate,
    RecommendationItem,
    RecommendationModel,
)
from app.questions.models import question_knowledge_points

HORIZONTAL_SPACING = 280
VERTICAL_SPACING = 40
MAX_NODES_PER_DIRECTION = 300

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
    if not is_platform_admin and user is not None:
        stmt = (
            stmt
            .join(Direction, Direction.major_id == Major.id)
            .join(KnowledgePoint, KnowledgePoint.direction_id == Direction.id)
            .where(
                Direction.deleted_at.is_(None),
                teacher_visible_resource_filter(KnowledgePoint, user.id),
            )
            .distinct()
        )
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
    if not is_platform_admin and user is not None:
        stmt = (
            stmt
            .join(Direction, Direction.major_id == Major.id)
            .join(KnowledgePoint, KnowledgePoint.direction_id == Direction.id)
            .where(
                Direction.deleted_at.is_(None),
                teacher_visible_resource_filter(KnowledgePoint, user.id),
            )
            .distinct()
        )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_major(db: AsyncSession, data: MajorCreate) -> Major:
    major = Major(**data.model_dump())
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


async def list_directions(
    db: AsyncSession,
    major_id: uuid.UUID,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> list[Direction]:
    stmt = select(Direction).where(Direction.major_id == major_id, Direction.deleted_at.is_(None))
    if not is_platform_admin and user is not None:
        stmt = (
            stmt
            .join(KnowledgePoint, KnowledgePoint.direction_id == Direction.id)
            .where(teacher_visible_resource_filter(KnowledgePoint, user.id))
            .distinct()
        )
    result = await db.execute(stmt.order_by(Direction.name))
    return list(result.scalars().all())


async def get_direction(
    db: AsyncSession,
    direction_id: uuid.UUID,
    *,
    user: User | None = None,
    is_platform_admin: bool = True,
) -> Direction | None:
    stmt = select(Direction).where(Direction.id == direction_id, Direction.deleted_at.is_(None))
    if not is_platform_admin and user is not None:
        stmt = (
            stmt
            .join(KnowledgePoint, KnowledgePoint.direction_id == Direction.id)
            .where(teacher_visible_resource_filter(KnowledgePoint, user.id))
            .distinct()
        )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_direction(db: AsyncSession, data: DirectionCreate) -> Direction:
    direction = Direction(**data.model_dump())
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

    if len(rows) > MAX_NODES_PER_DIRECTION:
        raise ValueError(f"节点数超过上限（{MAX_NODES_PER_DIRECTION}），请拆分方向后再操作")

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

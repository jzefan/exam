"""Tests for material → knowledge-point extraction (Step 2): parsing + bulk-create."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.job_models.models import LearningResource
from app.knowledge_extract import service
from app.knowledge_extract.schemas import (
    BulkCreateKnowledgePointItem,
    ExtractKnowledgePointsRequest,
    KnowledgeFragmentItem,
)
from app.learning.models import KnowledgePoint


def test_parse_candidates_handles_fenced_object_and_plain_array() -> None:
    fenced = (
        '```json\n{"knowledge_points": [{"name": "循环结构", "description": "重复执行"}, {"name": "条件判断"}]}\n```'
    )
    candidates = service._parse_candidates(fenced)
    assert [c.name for c in candidates] == ["循环结构", "条件判断"]
    assert candidates[0].description == "重复执行"

    plain_array = '[{"name": "数据仓库"}, {"name": "数据仓库"}]'  # duplicate dropped
    assert [c.name for c in service._parse_candidates(plain_array)] == ["数据仓库"]

    assert service._parse_candidates("not json at all") == []


@pytest.mark.asyncio
async def test_bulk_create_attaches_to_course_root_and_dedupes(db_session: AsyncSession) -> None:
    owner = uuid.uuid4()
    course = KnowledgePoint(name="数据仓库技术", owner_id=owner)
    db_session.add(course)
    await db_session.commit()
    await db_session.refresh(course)

    created, skipped = await service.bulk_create_knowledge_points(
        db_session,
        owner,
        course_kp_id=course.id,
        items=[
            BulkCreateKnowledgePointItem(name="Hive 基础"),
            BulkCreateKnowledgePointItem(name="分区表", description="按列分区"),
        ],
    )
    assert {c.name for c in created} == {"Hive 基础", "分区表"}
    assert all(c.parent_id == course.id for c in created)  # attached under the course root
    assert skipped == []

    # Re-running with an existing name under the same parent is skipped.
    created2, skipped2 = await service.bulk_create_knowledge_points(
        db_session,
        owner,
        course_kp_id=course.id,
        items=[BulkCreateKnowledgePointItem(name="Hive 基础"), BulkCreateKnowledgePointItem(name="外部表")],
    )
    assert [c.name for c in created2] == ["外部表"]
    assert skipped2 == ["Hive 基础"]

    children = (
        (await db_session.execute(select(KnowledgePoint).where(KnowledgePoint.parent_id == course.id))).scalars().all()
    )
    assert {c.name for c in children} == {"Hive 基础", "分区表", "外部表"}


def test_parse_fragments_typed_and_deduped() -> None:
    raw = (
        '{"fragments": ['
        '{"type": "formula", "title": "线性模型", "content": "y = wx + b"},'
        '{"type": "concept", "title": "监督学习", "content": "使用带标签数据训练"},'
        '{"type": "concept", "title": "监督学习", "content": "重复，应被去重"},'
        '{"type": "weird", "title": "无效类型归为 other", "content": "x"}'
        "]}"
    )
    fragments = service._parse_fragments(raw)
    assert [(f.type, f.title) for f in fragments] == [
        ("formula", "线性模型"),
        ("concept", "监督学习"),
        ("other", "无效类型归为 other"),
    ]


@pytest.mark.asyncio
async def test_extract_and_save_fragments_stores_on_material(db_session: AsyncSession, monkeypatch) -> None:
    resource = LearningResource(node_id=uuid.uuid4(), node_type="kp", resource_type="document", title="第三章.pdf")
    db_session.add(resource)
    await db_session.commit()
    await db_session.refresh(resource)

    async def fake_extract(db, user_id, *, course_name, request):
        return [
            KnowledgeFragmentItem(type="formula", title="二次方程求根", content="x=(-b±√(b²-4ac))/2a"),
            KnowledgeFragmentItem(type="code_example", title="求和", content="sum(nums)"),
        ]

    monkeypatch.setattr(service, "extract_knowledge_fragments", fake_extract)

    fragments = await service.extract_and_save_knowledge_fragments(
        db_session,
        uuid.uuid4(),
        resource_id=resource.id,
        course_name="Python程序设计",
        request=ExtractKnowledgePointsRequest(material_text="...", resource_title="第三章.pdf"),
    )
    assert [f.type for f in fragments] == ["formula", "code_example"]
    await db_session.refresh(resource)
    # Saved on the material as structured dicts, not added to the course tree.
    assert resource.knowledge_fragments == [
        {"type": "formula", "title": "二次方程求根", "content": "x=(-b±√(b²-4ac))/2a"},
        {"type": "code_example", "title": "求和", "content": "sum(nums)"},
    ]

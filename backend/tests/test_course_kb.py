"""Tests for the course knowledge base: chunker, ingest pipeline, RAG retrieval."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.course_kb import service
from app.course_kb.chunker import MAX_TOKENS, chunk_material, estimate_tokens
from app.course_kb.models import CourseMaterialChunk
from app.job_models.models import LearningResource
from app.learning.models import KnowledgePoint

SAMPLE = """第一章 程序流程控制

1.1 顺序结构
程序按语句出现的先后次序依次执行，是最基本的流程结构。任何复杂的程序逻辑都可以由顺序、选择、循环三种基本结构组合而成。

1.2 循环结构
循环结构用于重复执行一段代码，直到条件不再满足。Python 提供 for 与 while 两种循环语句，并支持 break 与 continue 控制循环流程。

```
total = 0
for x in range(1, 101):
    total += x
print(total)
```

第二章 函数

2.1 函数定义
函数是组织好的、可重复使用的代码段。使用 def 关键字定义函数，通过 return 返回结果。函数能提高代码的模块性和复用率。
"""


def test_chunker_heading_aware_and_typed() -> None:
    chunks = chunk_material(SAMPLE)
    assert chunks, "should produce chunks"
    # Heading boundaries respected: no chunk mixes chapter 1 and chapter 2 text.
    for chunk in chunks:
        assert not ("循环结构" in chunk.text and "函数定义" in chunk.text)
    # Heading path captured (chapter + section trail).
    loop_chunks = [c for c in chunks if "循环结构用于重复执行" in c.text]
    assert loop_chunks and loop_chunks[0].heading_path[0].startswith("第一章")
    # The fenced code block is a standalone code chunk.
    code_chunks = [c for c in chunks if c.chunk_type == "code"]
    assert code_chunks and "for x in range" in code_chunks[0].text
    # Token budget respected.
    assert all(c.token_count <= MAX_TOKENS * 1.2 for c in chunks)
    # Deterministic (pure function).
    assert chunk_material(SAMPLE) == chunks


def test_chunker_packs_long_text_within_budget() -> None:
    long_text = "第一章 测试\n\n" + "\n\n".join(
        f"这是第{i}段，讲解了一个知识要点，包含若干句子。" * 12 for i in range(30)
    )
    chunks = chunk_material(long_text)
    assert len(chunks) > 1
    assert all(c.token_count <= MAX_TOKENS * 1.2 for c in chunks)
    assert estimate_tokens("循环结构 for loop") > 0


async def _make_course_with_material(db: AsyncSession) -> tuple[KnowledgePoint, LearningResource]:
    owner = uuid.uuid4()
    course = KnowledgePoint(name="Python程序设计", owner_id=owner)
    db.add(course)
    await db.flush()
    resource = LearningResource(node_id=course.id, node_type="kp", resource_type="document", title="教材.pdf")
    db.add(resource)
    await db.commit()
    await db.refresh(course)
    await db.refresh(resource)
    return course, resource


@pytest.mark.asyncio
async def test_ingest_stores_chunks_and_status(db_session: AsyncSession, monkeypatch) -> None:
    from sqlalchemy.ext.asyncio import async_sessionmaker

    course, resource = await _make_course_with_material(db_session)
    # Bind the pipeline's self-managed sessions to the test database.
    factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        # Orthogonal-ish fake vectors keyed by content.
        return [[1.0, 0.0] if "循环" in t else [0.0, 1.0] for t in texts]

    monkeypatch.setattr(service, "embed_texts", fake_embed)
    await service.ingest_material_text(
        resource_id=resource.id, course_kp_id=course.id, material_text=SAMPLE, session_factory=factory
    )

    async with factory() as check:
        refreshed = await check.get(LearningResource, resource.id)
        assert refreshed.kb_status == "ready"
        assert refreshed.kb_chunk_count > 0
        rows = (
            (await check.execute(select(CourseMaterialChunk).where(CourseMaterialChunk.resource_id == resource.id)))
            .scalars()
            .all()
        )
        assert len(rows) == refreshed.kb_chunk_count
        assert all(row.embedding is not None for row in rows)

    # Re-ingest replaces (no duplicates).
    await service.ingest_material_text(
        resource_id=resource.id, course_kp_id=course.id, material_text=SAMPLE, session_factory=factory
    )
    async with factory() as check:
        refreshed = await check.get(LearningResource, resource.id)
        rows = (
            (await check.execute(select(CourseMaterialChunk).where(CourseMaterialChunk.resource_id == resource.id)))
            .scalars()
            .all()
        )
        assert len(rows) == refreshed.kb_chunk_count


@pytest.mark.asyncio
async def test_search_ranks_by_cosine_with_scope(db_session: AsyncSession, monkeypatch) -> None:
    course, resource = await _make_course_with_material(db_session)
    db_session.add_all(
        [
            CourseMaterialChunk(
                resource_id=resource.id,
                course_kp_id=course.id,
                node_id=course.id,
                ordinal=0,
                heading_path=["第一章", "1.2 循环结构"],
                chunk_type="text",
                text="循环结构用于重复执行……",
                token_count=20,
                embedding=[1.0, 0.0],
            ),
            CourseMaterialChunk(
                resource_id=resource.id,
                course_kp_id=course.id,
                node_id=course.id,
                ordinal=1,
                heading_path=["第二章", "2.1 函数定义"],
                chunk_type="text",
                text="函数是组织好的代码段……",
                token_count=20,
                embedding=[0.0, 1.0],
            ),
        ]
    )
    await db_session.commit()

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.05] for _ in texts]  # query points at "循环"

    monkeypatch.setattr(service, "embed_texts", fake_embed)
    hits = await service.search_chunks(db_session, course_kp_id=course.id, query="循环结构", k=2)
    assert hits and "循环" in hits[0].text
    assert hits[0].score >= hits[-1].score
    block = service.format_rag_block(hits)
    assert "出处：第一章 > 1.2 循环结构" in block


@pytest.mark.asyncio
async def test_generation_grounds_in_rag_chunks(db_session: AsyncSession, monkeypatch) -> None:
    from app.question_gen_templates import service as tpl_service
    from app.question_gen_templates.schemas import GenRules, TemplateCreate, TemplateGenerateRequest

    course, resource = await _make_course_with_material(db_session)
    db_session.add(
        CourseMaterialChunk(
            resource_id=resource.id,
            course_kp_id=course.id,
            node_id=course.id,
            ordinal=0,
            heading_path=["第一章 程序流程控制"],
            chunk_type="text",
            text="循环结构用于重复执行一段代码。",
            token_count=18,
            embedding=[1.0, 0.0],
        )
    )
    await db_session.commit()

    template = await tpl_service.create_template(
        db_session,
        TemplateCreate(
            course_kp_id=course.id,
            name="默认模板",
            gen_rules=GenRules(type_distribution={"choice": 2}),
        ),
        user_id=course.owner_id,
    )

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(service, "embed_texts", fake_embed)
    request = await tpl_service.assemble_generate_request(db_session, template, TemplateGenerateRequest())
    assert "课程知识库" in request.material_text
    assert "循环结构用于重复执行" in request.material_text
    assert "出处：第一章 程序流程控制" in request.material_text

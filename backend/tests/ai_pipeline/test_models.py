"""Unit tests for ai_pipeline SQLAlchemy models."""

import asyncio
import json

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.ai_pipeline.models import PromptTemplate, VectorKnowledgeBase
from app.models import Base

TEST_DATABASE_URL = "sqlite+aiosqlite:///test_ai_pipeline.db"

SAMPLE_EMBEDDING: list[float] = [0.1] * 1536


def _embed(values: list[float]) -> str:
    """Serialize a float list to JSON string for the TEXT embedding column."""
    return json.dumps(values)


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def db_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine) -> AsyncSession:
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.mark.asyncio
@pytest.mark.unit
async def test_create_vector_kb_entry(db_session: AsyncSession) -> None:
    """Create a minimal VectorKnowledgeBase entry and verify id and embedding."""
    entry = VectorKnowledgeBase(
        content="BLDC无刷直流电机驱动控制",
        category="skill",
        standard_name="BLDC Motor Drive Control",
        source="人社部职业标准-电气工程师",
        embedding=_embed(SAMPLE_EMBEDDING),
    )
    db_session.add(entry)
    await db_session.commit()
    await db_session.refresh(entry)

    assert entry.id is not None
    # embedding is stored as a JSON string in the TEXT column
    parsed = json.loads(entry.embedding)
    assert isinstance(parsed, list)
    assert len(parsed) == 1536


@pytest.mark.asyncio
@pytest.mark.unit
async def test_vector_kb_with_all_fields(db_session: AsyncSession) -> None:
    """Create a VectorKnowledgeBase entry with all fields and verify retrieval."""
    entry = VectorKnowledgeBase(
        content="Python高级编程",
        category="knowledge_point",
        industry="IT",
        standard_name="Advanced Python Programming",
        source="工业和信息化部-软件工程师标准",
        embedding=_embed([0.2] * 1536),
    )
    db_session.add(entry)
    await db_session.commit()

    result = await db_session.execute(
        select(VectorKnowledgeBase).where(VectorKnowledgeBase.content == "Python高级编程")
    )
    fetched = result.scalar_one()

    assert fetched.id is not None
    assert fetched.category == "knowledge_point"
    assert fetched.industry == "IT"
    assert fetched.standard_name == "Advanced Python Programming"
    assert fetched.source == "工业和信息化部-软件工程师标准"


@pytest.mark.asyncio
@pytest.mark.unit
async def test_create_prompt_template_generic(db_session: AsyncSession) -> None:
    """Create a generic PromptTemplate (industry=None) and verify defaults."""
    tmpl = PromptTemplate(
        name="extract_skills_v2",
        step="extract",
        industry=None,
        template="请从以下职位描述中提取技能要求：{{job_description}}",
    )
    db_session.add(tmpl)
    await db_session.commit()
    await db_session.refresh(tmpl)

    assert tmpl.id is not None
    assert tmpl.is_active is True
    assert tmpl.version == 1
    assert tmpl.industry is None


@pytest.mark.asyncio
@pytest.mark.unit
async def test_create_prompt_template_industry_specific(db_session: AsyncSession) -> None:
    """Create an industry-specific PromptTemplate and verify industry field."""
    tmpl = PromptTemplate(
        name="grade_code_it_v1",
        step="grade",
        industry="IT",
        template="请针对IT行业评估以下代码技能：{{answer}}",
        is_active=True,
        version=2,
    )
    db_session.add(tmpl)
    await db_session.commit()

    result = await db_session.execute(
        select(PromptTemplate).where(PromptTemplate.name == "grade_code_it_v1")
    )
    fetched = result.scalar_one()

    assert fetched.industry == "IT"
    assert fetched.step == "grade"
    assert fetched.version == 2

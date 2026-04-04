"""Tests for VectorSearchService."""

import asyncio
import json

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.ai_pipeline.models import VectorKnowledgeBase
from app.ai_pipeline.vector_search import VectorSearchService
from app.models import Base

TEST_DATABASE_URL = "sqlite+aiosqlite:///test_vector_search.db"

SAMPLE_EMBEDDING: list[float] = [0.1] * 1536


def _embed(values: list[float]) -> str:
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


def _make_kb(
    content: str,
    standard_name: str,
    category: str = "skill",
    industry: str | None = None,
) -> VectorKnowledgeBase:
    return VectorKnowledgeBase(
        content=content,
        category=category,
        standard_name=standard_name,
        industry=industry,
        source="test-source",
        embedding=_embed(SAMPLE_EMBEDDING),
    )


@pytest.mark.asyncio
@pytest.mark.unit
async def test_semantic_search_with_matches(db_session: AsyncSession) -> None:
    """Create KB entries in DB, call semantic_search, assert matches returned with confidence scores."""
    entry = _make_kb(content="Python programming fundamentals", standard_name="Python Programming")
    db_session.add(entry)
    await db_session.commit()

    service = VectorSearchService(db_session)
    results = await service.semantic_search("Python")

    assert len(results) >= 1
    entities, scores = zip(*results)
    standard_names = [e.standard_name for e in entities]
    assert "Python Programming" in standard_names
    for score in scores:
        assert 0.0 <= score <= 1.0


@pytest.mark.asyncio
@pytest.mark.unit
async def test_semantic_search_no_matches(db_session: AsyncSession) -> None:
    """Search for non-existent query, assert empty list."""
    service = VectorSearchService(db_session)
    results = await service.semantic_search("xyzzy_nonexistent_skill_999")

    assert results == []


@pytest.mark.asyncio
@pytest.mark.unit
async def test_match_skills_with_kbs_found(db_session: AsyncSession) -> None:
    """Create KB entries, call match_skills_with_kbs with matching skills, assert matches populated."""
    entry = _make_kb(
        content="Java object-oriented programming",
        standard_name="Java OOP",
        category="skill",
    )
    db_session.add(entry)
    await db_session.commit()

    service = VectorSearchService(db_session)
    result = await service.match_skills_with_kbs(["Java"])

    assert result["total_skills"] == 1
    assert len(result["matches"]) == 1
    assert result["unmatched"] == []

    match = result["matches"][0]
    assert match["skill"] == "Java"
    assert len(match["matched_kb"]) >= 1
    assert match["confidence"] > 0.0


@pytest.mark.asyncio
@pytest.mark.unit
async def test_match_skills_with_kbs_partial(db_session: AsyncSession) -> None:
    """Some skills match, some don't — assert both matches and unmatched have items."""
    entry = _make_kb(
        content="SQL database querying",
        standard_name="SQL Fundamentals",
        category="skill",
    )
    db_session.add(entry)
    await db_session.commit()

    service = VectorSearchService(db_session)
    result = await service.match_skills_with_kbs(["SQL", "zzz_no_match_skill_xyz"])

    assert result["total_skills"] == 2
    matched_skills = [m["skill"] for m in result["matches"]]
    assert "SQL" in matched_skills
    assert "zzz_no_match_skill_xyz" in result["unmatched"]


@pytest.mark.asyncio
@pytest.mark.unit
async def test_get_kb_entry_by_standard_name(db_session: AsyncSession) -> None:
    """Create entry, fetch by standard_name, assert correct entity returned."""
    entry = _make_kb(
        content="Machine learning concepts",
        standard_name="Machine Learning Basics",
        category="technology",
        industry="AI",
    )
    db_session.add(entry)
    await db_session.commit()

    service = VectorSearchService(db_session)
    fetched = await service.get_kb_entry_by_standard_name("Machine Learning Basics")

    assert fetched is not None
    assert fetched.standard_name == "Machine Learning Basics"
    assert fetched.category == "technology"
    assert fetched.industry == "AI"

    # Non-existent name returns None
    missing = await service.get_kb_entry_by_standard_name("Does Not Exist")
    assert missing is None

"""Unit tests for LLM pipeline service."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.ai_pipeline.llm_service import LLMClient, LLMPipeline
from app.ai_pipeline.models import PromptTemplate
from app.models import Base

TEST_DATABASE_URL = "sqlite+aiosqlite:///test_llm_service.db"


@pytest.fixture(scope="module")
def event_loop():
    import asyncio

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
    session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session


@pytest.fixture
def llm_client() -> LLMClient:
    return LLMClient(api_key="test-key", base_url="https://api.example.com/v1")


@pytest.mark.asyncio
async def test_llm_client_call_success(llm_client: LLMClient) -> None:
    """Mock httpx, call LLMClient.call_llm(), assert response text."""
    mock_response_data = {
        "choices": [{"message": {"content": "Hello, world!"}}]
    }

    mock_response = MagicMock()
    mock_response.json.return_value = mock_response_data
    mock_response.raise_for_status = MagicMock()

    mock_post = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client_instance = AsyncMock()
        mock_client_instance.post = mock_post
        mock_client_cls.return_value.__aenter__ = AsyncMock(
            return_value=mock_client_instance
        )
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await llm_client.call_llm("Test prompt")

    assert result == "Hello, world!"


@pytest.mark.asyncio
async def test_llm_client_api_error(llm_client: LLMClient) -> None:
    """Mock httpx to raise HTTPStatusError, assert error propagates."""
    mock_response = MagicMock()
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "500 Server Error", request=MagicMock(), response=MagicMock()
    )

    mock_post = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client_instance = AsyncMock()
        mock_client_instance.post = mock_post
        mock_client_cls.return_value.__aenter__ = AsyncMock(
            return_value=mock_client_instance
        )
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(httpx.HTTPStatusError):
            await llm_client.call_llm("Test prompt")


@pytest.mark.asyncio
async def test_step1_extract_success(db_session: AsyncSession) -> None:
    """Mock LLM response with valid JSON, assert step1 returns dict."""
    template = PromptTemplate(
        name="extract_v1_test",
        step="extract",
        industry=None,
        template="Extract from: {{text}}",
        is_active=True,
        version=1,
    )
    db_session.add(template)
    await db_session.commit()

    expected = {
        "job_role": "Software Engineer",
        "skills": ["Python"],
        "tools": ["Git"],
        "soft_skills": ["Communication"],
        "certificates": [],
        "responsibilities": ["Write code"],
    }

    mock_client = MagicMock(spec=LLMClient)
    mock_client.call_llm = AsyncMock(return_value=json.dumps(expected))

    pipeline = LLMPipeline(llm_client=mock_client, db=db_session)
    result = await pipeline.step1_extract("We need a Python developer.")

    assert result["job_role"] == "Software Engineer"
    assert "Python" in result["skills"]


@pytest.mark.asyncio
async def test_step1_extract_invalid_json(db_session: AsyncSession) -> None:
    """Mock LLM response with invalid JSON, assert returns error dict."""
    # Ensure template exists (may already exist from prior test)
    from sqlalchemy import select

    existing = await db_session.execute(
        select(PromptTemplate).where(
            PromptTemplate.step == "extract",
            PromptTemplate.industry.is_(None),
            PromptTemplate.is_active.is_(True),
        )
    )
    if not existing.scalar_one_or_none():
        template = PromptTemplate(
            name="extract_v1_test_invalid",
            step="extract",
            industry=None,
            template="Extract from: {{text}}",
            is_active=True,
            version=1,
        )
        db_session.add(template)
        await db_session.commit()

    mock_client = MagicMock(spec=LLMClient)
    mock_client.call_llm = AsyncMock(return_value="This is not valid JSON at all!!!")

    pipeline = LLMPipeline(llm_client=mock_client, db=db_session)
    result = await pipeline.step1_extract("some job description")

    assert "error" in result
    assert result["error"] == "LLM response not valid JSON"
    assert "raw" in result


@pytest.mark.asyncio
async def test_template_lookup_fallback(db_session: AsyncSession) -> None:
    """Create generic template in DB, call _get_template, assert fallback works."""
    # Add a generic (industry=None) template for 'decompose' step
    template = PromptTemplate(
        name="decompose_v1_fallback_test",
        step="decompose",
        industry=None,
        template="Decompose: {{data}}",
        is_active=True,
        version=1,
    )
    db_session.add(template)
    await db_session.commit()

    mock_client = MagicMock(spec=LLMClient)
    pipeline = LLMPipeline(llm_client=mock_client, db=db_session)

    # Request with a specific industry that has no template → should fall back to generic
    result = await pipeline._get_template("decompose", industry="finance")

    assert result is not None
    assert result.step == "decompose"
    assert result.industry is None


@pytest.mark.asyncio
async def test_full_chain_extract_to_grade(db_session: AsyncSession) -> None:
    """Mock all 4 steps with valid JSON responses, call each step sequentially."""
    # Seed templates for all 4 steps
    steps_templates = [
        ("clean", "Clean: {{data}}"),
        ("grade", "Grade: {{data}}"),
    ]
    for step, tmpl in steps_templates:
        from sqlalchemy import select

        existing = await db_session.execute(
            select(PromptTemplate).where(
                PromptTemplate.step == step,
                PromptTemplate.industry.is_(None),
                PromptTemplate.is_active.is_(True),
            )
        )
        if not existing.scalar_one_or_none():
            db_session.add(
                PromptTemplate(
                    name=f"{step}_v1_chain_test",
                    step=step,
                    industry=None,
                    template=tmpl,
                    is_active=True,
                    version=1,
                )
            )
    await db_session.commit()

    extract_result = {
        "job_role": "Data Scientist",
        "skills": ["Python", "Machine Learning"],
        "tools": ["Jupyter"],
        "soft_skills": ["Teamwork"],
        "certificates": [],
        "responsibilities": ["Build models"],
    }
    clean_result = {**extract_result, "skills": ["Python", "Machine Learning"]}
    decompose_result = {
        "job_role": "Data Scientist",
        "competency_dimensions": [
            {
                "name": "Technical",
                "skills": [
                    {
                        "name": "Python",
                        "knowledge_points": ["list comprehensions", "decorators"],
                    }
                ],
            }
        ],
    }
    grade_result = {
        "job_role": "Data Scientist",
        "competency_dimensions": [
            {
                "name": "Technical",
                "skills": [
                    {
                        "name": "Python",
                        "level": "L3",
                        "knowledge_points": [
                            {
                                "name": "list comprehensions",
                                "difficulty": "初级",
                                "teaching_suggestion": "Practice with examples",
                            }
                        ],
                    }
                ],
            }
        ],
    }

    call_sequence = [
        json.dumps(extract_result),
        json.dumps(clean_result),
        json.dumps(decompose_result),
        json.dumps(grade_result),
    ]
    mock_client = MagicMock(spec=LLMClient)
    mock_client.call_llm = AsyncMock(side_effect=call_sequence)

    pipeline = LLMPipeline(llm_client=mock_client, db=db_session)

    s1 = await pipeline.step1_extract("We need a data scientist.")
    assert s1["job_role"] == "Data Scientist"

    s2 = await pipeline.step2_clean(s1)
    assert "skills" in s2

    s3 = await pipeline.step3_decompose(s2)
    assert "competency_dimensions" in s3

    s4 = await pipeline.step4_grade(s3)
    assert s4["competency_dimensions"][0]["skills"][0]["level"] == "L3"

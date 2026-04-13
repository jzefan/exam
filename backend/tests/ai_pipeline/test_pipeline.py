"""Tests for pipeline orchestration and job status tracking."""

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.ai_pipeline.pipeline import DocumentProcessingPipeline, PipelineStatus
from app.job_models.models import CompetencyDimension, JobModel, JobModelVersion, Skill, SkillKnowledgePoint, SourceDocument
from app.models import Base
from app.rbac.models import Organization

TEST_DATABASE_URL = "sqlite+aiosqlite:///test_pipeline.db"


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


@pytest.fixture
async def org(db_session: AsyncSession) -> Organization:
    organization = Organization(name="Pipeline Test Org", type="enterprise", is_active=True)
    db_session.add(organization)
    await db_session.flush()
    return organization


@pytest.fixture
async def job_model(db_session: AsyncSession, org: Organization) -> JobModel:
    model = JobModel(
        org_id=org.id,
        job_role="Existing Job Model",
        created_by=None,
    )
    db_session.add(model)
    await db_session.flush()

    version = JobModelVersion(
        job_model_id=model.id,
        version=1,
        is_current=True,
        source_type="manual",
    )
    db_session.add(version)
    await db_session.flush()
    model.current_version_id = version.id
    model.current_version = version
    await db_session.flush()
    return model


@pytest.fixture
async def source_doc(db_session: AsyncSession, job_model: JobModel) -> SourceDocument:
    doc = SourceDocument(
        job_model_id=job_model.id,
        job_model_version_id=job_model.current_version_id,
        file_name="test.pdf",
        file_path="/tmp/test.pdf",
        file_type="pdf",
        uploaded_by=None,
    )
    db_session.add(doc)
    await db_session.flush()
    return doc


@pytest.mark.asyncio
async def test_pipeline_status_tracking() -> None:
    """Test in-memory job status tracking through lifecycle."""
    doc_id = uuid.uuid4()

    # Initially no job
    assert PipelineStatus.get_job(doc_id) is None

    # Create job
    PipelineStatus.create_job(doc_id)
    job = PipelineStatus.get_job(doc_id)
    assert job is not None
    assert job["step"] == "extraction"
    assert job["progress"] == 0
    assert job["status"] == "processing"
    assert job["result"] is None
    assert job["error_message"] is None
    assert job["started_at"] is not None

    # Update through pipeline steps
    PipelineStatus.update_job(doc_id, "llm_extract", 25)
    job = PipelineStatus.get_job(doc_id)
    assert job["step"] == "llm_extract"
    assert job["progress"] == 25
    assert job["status"] == "processing"

    # Mark as success
    result_data = {"model_id": str(uuid.uuid4()), "matched_count": 5, "unmatched_count": 2}
    PipelineStatus.update_job(doc_id, "done", 100, status="success", result=result_data)
    job = PipelineStatus.get_job(doc_id)
    assert job["step"] == "done"
    assert job["progress"] == 100
    assert job["status"] == "success"
    assert job["result"] == result_data

    # Clear job
    PipelineStatus.clear_job(doc_id)
    assert PipelineStatus.get_job(doc_id) is None


@pytest.mark.asyncio
async def test_process_document_success(db_session: AsyncSession, source_doc: SourceDocument, job_model: JobModel) -> None:
    """Test successful full pipeline execution with mocked services."""
    graded_output = {
        "job_role": "Software Engineer",
        "competency_dimensions": [
            {
                "name": "Technical Skills",
                "description": "Core technical competencies",
                "skills": [
                    {
                        "name": "Python",
                        "level": "L3",
                        "description": "Python programming",
                        "knowledge_points": [
                            {"name": "Asyncio", "difficulty": "中级", "teaching_suggestion": "Practice with examples"},
                        ],
                    }
                ],
            }
        ],
    }

    mock_extractor = MagicMock()
    mock_extractor.extract_text = AsyncMock(return_value="Job description text")

    mock_llm = MagicMock()
    mock_llm.step1_extract = AsyncMock(return_value={"job_role": "Software Engineer", "skills": ["Python"]})
    mock_llm.step2_clean = AsyncMock(return_value={"job_role": "Software Engineer", "skills": ["Python"]})
    mock_llm.step3_decompose = AsyncMock(return_value=graded_output)
    mock_llm.step4_grade = AsyncMock(return_value=graded_output)

    mock_vector = MagicMock()
    mock_vector.match_skills_with_kbs = AsyncMock(
        return_value={"matches": [{"skill": "Python", "kb_id": str(uuid.uuid4())}], "unmatched": []}
    )

    upload_file = MagicMock()
    upload_file.filename = "test.pdf"

    pipeline = DocumentProcessingPipeline(
        extractor=mock_extractor,
        llm_pipeline=mock_llm,
        vector_search=mock_vector,
        db=db_session,
    )

    result = await pipeline.process_document(
        document_id=source_doc.id,
        upload_file=upload_file,
        job_model_id=job_model.id,
        user_id=uuid.uuid4(),
    )

    assert isinstance(result, JobModel)
    assert result.job_role == "Software Engineer"
    assert result.current_version_id is not None

    status = PipelineStatus.get_job(source_doc.id)
    assert status is not None
    assert status["status"] == "success"
    assert status["progress"] == 100
    assert status["result"]["model_id"] == str(result.id)


@pytest.mark.asyncio
async def test_process_document_extraction_error() -> None:
    """Test that extraction failure sets status to error and re-raises."""
    doc_id = uuid.uuid4()

    mock_extractor = MagicMock()
    mock_extractor.extract_text = AsyncMock(side_effect=ValueError("Failed to extract PDF"))

    mock_llm = MagicMock()
    mock_vector = MagicMock()
    mock_db = MagicMock(spec=AsyncSession)

    upload_file = MagicMock()
    upload_file.filename = "bad.pdf"

    pipeline = DocumentProcessingPipeline(
        extractor=mock_extractor,
        llm_pipeline=mock_llm,
        vector_search=mock_vector,
        db=mock_db,
    )

    with pytest.raises(ValueError, match="Failed to extract PDF"):
        await pipeline.process_document(
            document_id=doc_id,
            upload_file=upload_file,
            job_model_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )

    status = PipelineStatus.get_job(doc_id)
    assert status is not None
    assert status["status"] == "error"
    assert "Failed to extract PDF" in status["error_message"]


@pytest.mark.asyncio
async def test_create_job_model_from_llm_output(db_session: AsyncSession, job_model: JobModel) -> None:
    """Test _create_job_model_from_llm_output builds correct hierarchy."""
    graded_data = {
        "job_role": "Data Analyst",
        "competency_dimensions": [
            {
                "name": "Data Skills",
                "description": "Data analysis competencies",
                "skills": [
                    {
                        "name": "SQL",
                        "level": "L3",
                        "description": "Structured query language",
                        "knowledge_points": [
                            {"name": "Joins", "difficulty": "初级", "teaching_suggestion": "Start with inner joins"},
                            {"name": "Aggregations", "difficulty": "中级", "teaching_suggestion": "Practice with GROUP BY"},
                        ],
                    },
                    {
                        "name": "Python",
                        "level": "L2",
                        "description": "Data processing with Python",
                        "knowledge_points": [
                            {"name": "Pandas", "difficulty": "中级", "teaching_suggestion": "Use DataFrames"},
                        ],
                    },
                ],
            }
        ],
    }
    matched_data: dict = {"matches": [], "unmatched": []}

    pipeline = DocumentProcessingPipeline(
        extractor=MagicMock(),
        llm_pipeline=MagicMock(),
        vector_search=MagicMock(),
        db=db_session,
    )

    model = await pipeline._create_job_model_from_llm_output(
        job_model.id,
        uuid.uuid4(),
        graded_data,
        matched_data,
    )

    assert isinstance(model, JobModel)
    assert model.job_role == "Data Analyst"
    assert model.id == job_model.id
    assert model.current_version is not None
    assert model.current_version.source_type == "ai_generated"
    assert model.current_version.version == 2

    from sqlalchemy import select

    result = await db_session.execute(
        select(CompetencyDimension).where(
            CompetencyDimension.model_version_id == model.current_version_id
        )
    )
    dims = result.scalars().all()
    assert len(dims) == 1
    assert dims[0].name == "Data Skills"

    result = await db_session.execute(
        select(Skill).where(Skill.dimension_id == dims[0].id)
    )
    skills = result.scalars().all()
    assert len(skills) == 2
    skill_names = {s.name for s in skills}
    assert "SQL" in skill_names
    assert "Python" in skill_names

    sql_skill = next(s for s in skills if s.name == "SQL")
    result = await db_session.execute(
        select(SkillKnowledgePoint).where(SkillKnowledgePoint.skill_id == sql_skill.id)
    )
    kps = result.scalars().all()
    assert len(kps) == 2
    kp_names = {k.name for k in kps}
    assert "Joins" in kp_names
    assert "Aggregations" in kp_names

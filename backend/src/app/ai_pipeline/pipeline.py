"""Pipeline orchestration for document processing and JobModel creation."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai_pipeline.extraction import DocumentExtractor
from app.ai_pipeline.llm_service import LLMPipeline
from app.ai_pipeline.vector_search import VectorSearchService
from app.job_models.models import CompetencyDimension, JobModel, JobModelVersion, Skill, SourceDocument
from app.job_models.schemas import (
    DimensionCreate,
    SkillCreate,
    SkillKnowledgePointCreate,
)
from app.job_models.service import create_dimension


class PipelineStatus:
    """In-memory job tracking (Phase 3 v1; Phase 4+: move to DB)."""

    _jobs: dict[uuid.UUID, dict] = {}

    @classmethod
    def create_job(cls, document_id: uuid.UUID) -> None:
        """Create a new job entry for tracking."""
        cls._jobs[document_id] = {
            "step": "extraction",
            "progress": 0,
            "status": "processing",
            "result": None,
            "error_message": None,
            "started_at": datetime.now(timezone.utc),
        }

    @classmethod
    def update_job(
        cls,
        document_id: uuid.UUID,
        step: str,
        progress: int,
        status: str = "processing",
        result: Optional[dict] = None,
        error_message: Optional[str] = None,
    ) -> None:
        """Update job progress and status."""
        if document_id in cls._jobs:
            cls._jobs[document_id].update(
                {
                    "step": step,
                    "progress": progress,
                    "status": status,
                    "result": result,
                    "error_message": error_message,
                }
            )

    @classmethod
    def get_job(cls, document_id: uuid.UUID) -> Optional[dict]:
        """Get job status."""
        return cls._jobs.get(document_id)

    @classmethod
    def clear_job(cls, document_id: uuid.UUID) -> None:
        """Clear job from memory (optional cleanup)."""
        cls._jobs.pop(document_id, None)


class DocumentProcessingPipeline:
    """Orchestrates the full document → JobModel pipeline."""

    def __init__(
        self,
        extractor: DocumentExtractor,
        llm_pipeline: LLMPipeline,
        vector_search: VectorSearchService,
        db: AsyncSession,
    ):
        self.extractor = extractor
        self.llm = llm_pipeline
        self.vector = vector_search
        self.db = db

    async def process_document(
        self,
        document_id: uuid.UUID,
        upload_file: UploadFile,
        job_model_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> JobModel:
        """
        Full pipeline: extract → llm chain → vector match → create JobModel.
        Updates PipelineStatus at each step.

        Args:
            document_id: UUID of SourceDocument
            upload_file: Uploaded file
            job_model_id: Target JobModel ID
            user_id: User who uploaded

        Returns: Created JobModel
        Raises: Exception if any step fails (caught by caller)
        """
        try:
            PipelineStatus.create_job(document_id)

            # Step 1: Extract text
            PipelineStatus.update_job(document_id, "extraction", 10)
            text = await self.extractor.extract_text(upload_file)

            # Save extracted text to SourceDocument
            result = await self.db.execute(
                select(SourceDocument).where(SourceDocument.id == document_id)
            )
            doc = result.scalar_one()
            doc.extracted_text = text
            await self.db.flush()

            # Step 2-5: LLM pipeline (extract, clean, decompose, grade)
            PipelineStatus.update_job(document_id, "llm_extract", 25)
            extracted = await self.llm.step1_extract(text)

            PipelineStatus.update_job(document_id, "llm_clean", 40)
            cleaned = await self.llm.step2_clean(extracted)

            PipelineStatus.update_job(document_id, "llm_decompose", 55)
            decomposed = await self.llm.step3_decompose(cleaned)

            PipelineStatus.update_job(document_id, "llm_grade", 70)
            graded = await self.llm.step4_grade(decomposed)

            # Step 3: Vector matching
            PipelineStatus.update_job(document_id, "vector_match", 85)
            all_skills = self._extract_all_skills_from_graded(graded)
            matched = await self.vector.match_skills_with_kbs(all_skills)

            # Step 4: Create JobModel
            PipelineStatus.update_job(document_id, "model_creation", 95)
            model = await self._create_job_model_from_llm_output(
                job_model_id,
                user_id,
                graded,
                matched,
            )

            PipelineStatus.update_job(
                document_id,
                "done",
                100,
                status="success",
                result={
                    "model_id": str(model.id),
                    "matched_count": len(matched.get("matches", [])),
                    "unmatched_count": len(matched.get("unmatched", [])),
                },
            )

            return model

        except Exception as e:
            PipelineStatus.update_job(
                document_id,
                "error",
                0,
                status="error",
                error_message=str(e),
            )
            raise

    def _extract_all_skills_from_graded(self, graded_data: dict) -> list[str]:
        """Extract skill names from graded data structure."""
        skills = []
        for dim in graded_data.get("competency_dimensions", []):
            for skill in dim.get("skills", []):
                skills.append(skill.get("name", ""))
        return [s for s in skills if s]

    async def _create_job_model_from_llm_output(
        self,
        job_model_id: uuid.UUID,
        user_id: uuid.UUID,
        graded_data: dict,
        matched_data: dict,
    ) -> JobModel:
        """
        Convert LLM output into a new JobModel version and save to DB.

        Maps graded_data.competency_dimensions -> JobModelVersion.dimensions -> skills -> knowledge_points
        """
        del matched_data

        result = await self.db.execute(
            select(JobModel)
            .options(selectinload(JobModel.current_version))
            .where(
                JobModel.id == job_model_id,
                JobModel.deleted_at.is_(None),
            )
        )
        model = result.scalar_one_or_none()
        if model is None:
            raise ValueError("Job model not found")

        dimensions_data = graded_data.get("competency_dimensions", [])

        dimensions = []
        for dim_data in dimensions_data:
            skills = []
            for skill_data in dim_data.get("skills", []):
                kps = []
                for kp_data in skill_data.get("knowledge_points", []):
                    kps.append(
                        SkillKnowledgePointCreate(
                            name=kp_data.get("name", ""),
                            difficulty=kp_data.get("difficulty"),
                            teaching_suggestion=kp_data.get("teaching_suggestion"),
                            sort_order=len(kps),
                        )
                    )
                skills.append(
                    SkillCreate(
                        name=skill_data.get("name", ""),
                        level=skill_data.get("level"),
                        description=skill_data.get("description"),
                        knowledge_points=kps,
                        sort_order=len(skills),
                    )
                )
            dimensions.append(
                DimensionCreate(
                    name=dim_data.get("name", ""),
                    description=dim_data.get("description"),
                    skills=skills,
                    sort_order=len(dimensions),
                )
            )

        current_version_number = model.current_version.version if model.current_version else 0
        if model.current_version is not None:
            model.current_version.is_current = False

        model.job_role = graded_data.get("job_role", model.job_role)

        new_version = JobModelVersion(
            job_model_id=model.id,
            version=current_version_number + 1,
            version_note="Auto-generated from document via AI pipeline",
            is_current=True,
            source_type="ai_generated",
            raw_content={
                "job_role": model.job_role,
                "dimensions": [dim.model_dump() for dim in dimensions],
            },
            created_by=user_id,
            published_at=datetime.now(timezone.utc),
        )
        self.db.add(new_version)
        await self.db.flush()

        for dim_data in dimensions:
            await create_dimension(self.db, new_version.id, dim_data)

        model.current_version_id = new_version.id
        model.current_version = new_version
        await self.db.flush()
        refreshed = await self.db.execute(
            select(JobModel)
            .options(
                selectinload(JobModel.current_version)
                .selectinload(JobModelVersion.dimensions)
                .selectinload(CompetencyDimension.skills)
                .selectinload(Skill.knowledge_points)
            )
            .where(JobModel.id == model.id)
        )
        loaded = refreshed.scalar_one_or_none()

        return loaded or model

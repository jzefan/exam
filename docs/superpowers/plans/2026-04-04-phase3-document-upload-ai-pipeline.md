# Phase 3: Document Upload + AI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement document upload, text extraction, LLM-powered 4-step prompt chain, and pgvector semantic matching to automatically generate job model structures from JD documents.

**Architecture:** New `backend/src/app/ai_pipeline/` package with models (VectorKnowledgeBase, PromptTemplate), services (document extraction, LLM pipeline, vector search), and routes for upload + progress tracking. Uses FastAPI BackgroundTasks for async processing, Pydantic for schemas, SQLAlchemy 2.0 with pgvector extension.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (async), pgvector, pydantic, LLM API (DeepSeek/Qwen), text extraction (pdfplumber, python-docx), pytest

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `backend/src/app/ai_pipeline/__init__.py` | Package init |
| Create | `backend/src/app/ai_pipeline/models.py` | VectorKnowledgeBase, PromptTemplate |
| Create | `backend/src/app/ai_pipeline/schemas.py` | Request/response schemas |
| Create | `backend/src/app/ai_pipeline/extraction.py` | Text extraction service (PDF, Word, OCR) |
| Create | `backend/src/app/ai_pipeline/llm_service.py` | LLM API client + 4-step chain |
| Create | `backend/src/app/ai_pipeline/vector_search.py` | pgvector semantic matching |
| Create | `backend/src/app/ai_pipeline/pipeline.py` | Orchestration: upload → extract → LLM → match → store |
| Create | `backend/src/app/ai_pipeline/router.py` | Upload + progress endpoints |
| Create | `backend/alembic/versions/add_vector_kb_tables.py` | Migration for VectorKnowledgeBase, PromptTemplate |
| Modify | `backend/src/app/main.py` | Register ai_pipeline router |
| Create | `backend/tests/ai_pipeline/` | Test package (fixtures, tests) |

---

### Task 1: VectorKnowledgeBase + PromptTemplate Models

**Files:**
- Create: `backend/src/app/ai_pipeline/__init__.py`
- Create: `backend/src/app/ai_pipeline/models.py`

- [ ] **Create VectorKnowledgeBase model**

```
VectorKnowledgeBase (BaseModel)
├── id (UUID)
├── content (String 500, original text like "BLDC无刷直流电机驱动控制")
├── category (String 50: skill / knowledge_point / certificate / tool)
├── industry (String 100, nullable: 通用, 汽车, 航空, etc.)
├── standard_name (String 300, normalized term)
├── embedding (vector(1536), pgvector type)
├── source (String 200: "人社部职业标准-电气工程师")
└── timestamps
```

Use `Vector` type from `pgvector.sqlalchemy`:
```python
from pgvector.sqlalchemy import Vector
embedding: Mapped[list[float]] = mapped_column(Vector(1536), nullable=False)
```

- [ ] **Create PromptTemplate model**

```
PromptTemplate (BaseModel)
├── id (UUID)
├── name (String 100: "extract_skills_v2")
├── step (String 50: extract / clean / decompose / grade)
├── industry (String 100, nullable: NULL = 通用, non-NULL = 行业专用)
├── template (Text: Prompt template with {{variable}} placeholders)
├── is_active (Boolean, default True)
├── version (Integer, default 1)
└── timestamps
```

- [ ] **Create migration** (placeholder for now, Task 5 will finalize)

- [ ] **Add unit tests** (test model creation with valid fields)

---

### Task 2: Pydantic Schemas + Seed Data

**Files:**
- Create: `backend/src/app/ai_pipeline/schemas.py`
- Modify: `backend/src/app/ai_pipeline/models.py` (add seed functions)

- [ ] **Create schemas**

```
DocumentUploadRequest:
  file (UploadFile)
  project_id (UUID)

DocumentUploadResponse:
  document_id (UUID)
  status (str: "extracting")
  message (str)

ProgressResponse:
  document_id (UUID)
  step (str: "extraction" / "llm_extract" / "llm_clean" / "llm_decompose" / "llm_grade" / "vector_match" / "done")
  progress (int: 0-100)
  status (str: "processing" / "success" / "error")
  result (dict | None)
  error_message (str | None)

GeneratedModelResponse:
  model_id (UUID)
  job_role (str)
  dimensions (list[{name, skills: [{name, level, knowledge_points: [{name}]}]}])
  confidence_score (float: avg confidence of vector matches)
```

- [ ] **Create seed function**

```python
async def seed_prompt_templates(db: AsyncSession):
    """Seed default prompt templates for extract/clean/decompose/grade steps."""
    templates = [
        {
            "name": "extract_skills_v1",
            "step": "extract",
            "industry": None,  # Generic
            "template": """Given the following job description text, extract:
1. Job title/role
2. Required skills
3. Tools and technologies
4. Soft skills
5. Certificates/Licenses
6. Responsibilities

Text:
{{text}}

Output JSON:
{
  "job_role": "...",
  "skills": ["...", "..."],
  "tools": ["...", "..."],
  "soft_skills": ["...", "..."],
  "certificates": ["...", "..."],
  "responsibilities": ["...", "..."]
}""",
        },
        # ... more templates for clean, decompose, grade steps
    ]
    for t in templates:
        existing = await db.execute(
            select(PromptTemplate).where(
                PromptTemplate.name == t["name"],
                PromptTemplate.step == t["step"],
            )
        )
        if not existing.scalars().first():
            db.add(PromptTemplate(**t))
    await db.commit()
```

---

### Task 3: Document Extraction Service

**Files:**
- Create: `backend/src/app/ai_pipeline/extraction.py`

- [ ] **Implement extraction service**

```python
import asyncio
import io
from pathlib import Path

import pdfplumber
from docx import Document
from fastapi import UploadFile

class DocumentExtractor:
    @staticmethod
    async def extract_text_from_pdf(file_bytes: bytes) -> str:
        """Extract text from PDF using pdfplumber."""
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            return text.strip()
        except Exception as e:
            raise ValueError(f"PDF extraction failed: {e}")

    @staticmethod
    async def extract_text_from_docx(file_bytes: bytes) -> str:
        """Extract text from Word document."""
        try:
            doc = Document(io.BytesIO(file_bytes))
            text = "\n".join(para.text for para in doc.paragraphs)
            return text.strip()
        except Exception as e:
            raise ValueError(f"DOCX extraction failed: {e}")

    @staticmethod
    async def extract_text_from_image(file_bytes: bytes) -> str:
        """Extract text from image using LLM vision (DeepSeek-VL/Qwen-VL)."""
        # Phase 3 v1: Return placeholder; Phase 3+ v2: implement multi-modal LLM call
        return "[Image OCR not yet implemented]"

    @staticmethod
    async def extract_text(upload_file: UploadFile) -> str:
        """Route extraction based on file type."""
        file_bytes = await upload_file.read()
        file_ext = Path(upload_file.filename).suffix.lower()

        if file_ext == ".pdf":
            return await DocumentExtractor.extract_text_from_pdf(file_bytes)
        elif file_ext in (".docx", ".doc"):
            return await DocumentExtractor.extract_text_from_docx(file_bytes)
        elif file_ext in (".png", ".jpg", ".jpeg"):
            return await DocumentExtractor.extract_text_from_image(file_bytes)
        else:
            raise ValueError(f"Unsupported file type: {file_ext}")
```

- [ ] **Unit tests**
  - Test PDF extraction (mock pdfplumber)
  - Test DOCX extraction (mock python-docx)
  - Test unsupported file type raises ValueError

---

### Task 4: LLM Pipeline Service

**Files:**
- Create: `backend/src/app/ai_pipeline/llm_service.py`

- [ ] **Implement LLM client**

```python
import json
from typing import Any

import httpx

class LLMClient:
    def __init__(self, api_key: str, base_url: str = "https://api.deepseek.com/v1"):
        self.api_key = api_key
        self.base_url = base_url

    async def call_llm(
        self, prompt: str, system: str = "You are a helpful assistant."
    ) -> str:
        """Call LLM API (DeepSeek or compatible) with timeout."""
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {
            "model": "deepseek-v4-flash",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.7,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
```

- [ ] **Implement 4-step prompt chain**

```python
class LLMPipeline:
    def __init__(self, llm_client: LLMClient, db: AsyncSession):
        self.llm = llm_client
        self.db = db

    async def step1_extract(self, text: str, extracted_job_role: str | None = None) -> dict:
        """Extract skills, tools, soft skills, certificates from JD text."""
        template = await self._get_template("extract")
        prompt = template.template.replace("{{text}}", text)
        response = await self.llm.call_llm(prompt, system="You are a job analysis expert.")
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return {"error": "LLM response not JSON", "raw": response}

    async def step2_clean(self, extracted_data: dict) -> dict:
        """Deduplicate, normalize terminology (e.g., JS → JavaScript)."""
        template = await self._get_template("clean")
        prompt = template.template.replace("{{data}}", json.dumps(extracted_data, ensure_ascii=False))
        response = await self.llm.call_llm(prompt)
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return extracted_data  # Fallback to uncleaned

    async def step3_decompose(self, cleaned_data: dict) -> dict:
        """Decompose macro skills into micro knowledge points."""
        template = await self._get_template("decompose")
        prompt = template.template.replace("{{data}}", json.dumps(cleaned_data, ensure_ascii=False))
        response = await self.llm.call_llm(prompt)
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return cleaned_data

    async def step4_grade(self, decomposed_data: dict) -> dict:
        """Assign L1-L5 levels to skills, difficulty/teaching suggestions to knowledge points."""
        template = await self._get_template("grade")
        prompt = template.template.replace("{{data}}", json.dumps(decomposed_data, ensure_ascii=False))
        response = await self.llm.call_llm(prompt)
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return decomposed_data

    async def _get_template(self, step: str, industry: str | None = None) -> PromptTemplate:
        """Fetch active template for step, prefer industry-specific."""
        query = select(PromptTemplate).where(
            PromptTemplate.step == step,
            PromptTemplate.is_active.is_(True),
        )
        if industry:
            result = await self.db.execute(
                query.where(PromptTemplate.industry == industry)
            )
            if result.scalar_one_or_none():
                return result.scalar_one()
        # Fallback to generic
        result = await self.db.execute(query.where(PromptTemplate.industry.is_(None)))
        return result.scalar_one()
```

- [ ] **Unit tests**
  - Mock LLM client, test 4-step chain in sequence
  - Test JSON parsing error handling
  - Test template lookup (industry-specific + fallback to generic)

---

### Task 5: Vector Search Service + Semantic Matching

**Files:**
- Create: `backend/src/app/ai_pipeline/vector_search.py`

- [ ] **Implement pgvector semantic search**

```python
from sqlalchemy import text

class VectorSearchService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def semantic_search(
        self, query: str, embedding: list[float], threshold: float = 0.75, limit: int = 5
    ) -> list[tuple[VectorKnowledgeBase, float]]:
        """
        Search VectorKnowledgeBase for similar vectors.
        Returns: list of (entity, similarity_score) tuples
        similarity_score = 1 - cosine_distance (0.0 to 1.0)
        """
        result = await self.db.execute(
            select(
                VectorKnowledgeBase,
                (1 - (VectorKnowledgeBase.embedding.op("<->"))).label("similarity"),
            )
            .where((1 - (VectorKnowledgeBase.embedding.op("<->"))).gte(threshold))
            .order_by((VectorKnowledgeBase.embedding.op("<->")).asc())
            .limit(limit)
        )
        return result.all()

    async def match_skills_with_kbs(self, skills: list[str]) -> dict:
        """
        For each skill from LLM output, find matching standard KnowledgeBase entries.
        Returns: {
          "matches": [{"skill": "...", "matched_kb": [...], "confidence": 0.85}],
          "unmatched": ["skill_without_match"]
        }
        """
        # Phase 3 v1: Use string similarity; Phase 4+: use real embeddings
        # For now, placeholder implementation using naive string matching
        matches = []
        unmatched = []

        for skill in skills:
            # Placeholder: find KBs with partial name match
            similar = await self.db.execute(
                select(VectorKnowledgeBase).where(
                    VectorKnowledgeBase.content.ilike(f"%{skill}%")
                )
            )
            matched_kbs = similar.scalars().all()

            if matched_kbs:
                matches.append({
                    "skill": skill,
                    "matched_kb": [kb.standard_name for kb in matched_kbs],
                    "confidence": 0.8,  # Placeholder
                })
            else:
                unmatched.append(skill)

        return {"matches": matches, "unmatched": unmatched}
```

- [ ] **Unit tests**
  - Mock pgvector DB, test semantic_search with similarity threshold
  - Test match_skills_with_kbs with known/unknown skills

---

### Task 6: Pipeline Orchestration + Job Status Tracking

**Files:**
- Create: `backend/src/app/ai_pipeline/pipeline.py`

- [ ] **Implement pipeline orchestration**

```python
import uuid
from datetime import datetime, timezone

class PipelineStatus:
    """In-memory job tracking (Phase 3 v1; Phase 4: move to DB for persistence)."""
    _jobs: dict[uuid.UUID, dict] = {}

    @classmethod
    def create_job(cls, document_id: uuid.UUID) -> None:
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
        result: dict | None = None,
        error_message: str | None = None,
    ) -> None:
        if document_id in cls._jobs:
            cls._jobs[document_id].update({
                "step": step,
                "progress": progress,
                "status": status,
                "result": result,
                "error_message": error_message,
            })

    @classmethod
    def get_job(cls, document_id: uuid.UUID) -> dict | None:
        return cls._jobs.get(document_id)


class DocumentProcessingPipeline:
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
        self, document_id: uuid.UUID, upload_file: UploadFile, project_id: uuid.UUID, user_id: uuid.UUID
    ) -> JobModel:
        """
        Full pipeline: extract → llm chain → vector match → create JobModel
        Updates PipelineStatus at each step.
        """
        try:
            PipelineStatus.create_job(document_id)

            # Step 1: Extract text
            PipelineStatus.update_job(document_id, "extraction", 10)
            text = await self.extractor.extract_text(upload_file)
            
            # Save extracted text to SourceDocument
            src_doc = await self.db.execute(
                select(SourceDocument).where(SourceDocument.id == document_id)
            )
            doc = src_doc.scalar_one()
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
            all_skills = graded.get("skills", [])
            matched = await self.vector.match_skills_with_kbs(all_skills)

            # Step 4: Create JobModel
            PipelineStatus.update_job(document_id, "model_creation", 95)
            model = await self._create_job_model_from_llm_output(
                project_id, graded, matched
            )

            PipelineStatus.update_job(
                document_id,
                "done",
                100,
                status="success",
                result={"model_id": str(model.id), "matched_count": len(matched["matches"])},
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

    async def _create_job_model_from_llm_output(
        self, project_id: uuid.UUID, graded_data: dict, matched_data: dict
    ) -> JobModel:
        """Convert LLM output into JobModel structure."""
        # Map graded_data → dimensions → skills → knowledge_points
        dimensions_data = graded_data.get("competency_dimensions", [])
        
        from app.job_models.service import create_job_model
        from app.job_models.schemas import (
            DimensionCreate, SkillCreate, SkillKnowledgePointCreate, JobModelCreate
        )

        dimensions = []
        for dim_data in dimensions_data:
            skills = []
            for skill_data in dim_data.get("skills", []):
                kps = []
                for kp_data in skill_data.get("knowledge_points", []):
                    kps.append(SkillKnowledgePointCreate(
                        name=kp_data.get("name"),
                        difficulty=kp_data.get("difficulty"),
                        teaching_suggestion=kp_data.get("teaching_suggestion"),
                    ))
                skills.append(SkillCreate(
                    name=skill_data.get("name"),
                    level=skill_data.get("level"),
                    knowledge_points=kps,
                ))
            dimensions.append(DimensionCreate(
                name=dim_data.get("name"),
                skills=skills,
            ))

        model_data = JobModelCreate(
            job_role=graded_data.get("job_role", "Unknown Role"),
            dimensions=dimensions,
            source_type="ai_generated",
            version_note="Auto-generated from document",
        )

        return await create_job_model(self.db, project_id, model_data)
```

- [ ] **Unit tests**
  - Mock all sub-services, test pipeline orchestration
  - Test status tracking updates
  - Test error handling and rollback

---

### Task 7: API Router + Document Upload Endpoint

**Files:**
- Create: `backend/src/app/ai_pipeline/router.py`
- Modify: `backend/src/app/main.py`

- [ ] **Implement upload + progress endpoints**

```python
from fastapi import APIRouter, Depends, File, UploadFile, BackgroundTasks
from typing import Annotated

router = APIRouter()

@router.post("/documents/upload")
async def upload_document(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = Depends(),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(),
) -> DocumentUploadResponse:
    """
    Upload JD document and start async processing.
    Returns: document_id + status "extracting"
    """
    # Create SourceDocument record
    doc_id = uuid.uuid4()
    src_doc = SourceDocument(
        id=doc_id,
        project_id=project_id,
        file_name=file.filename,
        file_path=f"/uploads/{doc_id}/{file.filename}",
        file_type=Path(file.filename).suffix.lower(),
        uploaded_by=user.id,
    )
    db.add(src_doc)
    await db.commit()

    # Start async processing in background
    background_tasks.add_task(
        process_document_task,
        doc_id,
        file,
        project_id,
        user.id,
        db,
    )

    return DocumentUploadResponse(
        document_id=doc_id,
        status="extracting",
        message="Document processing started",
    )


@router.get("/documents/{document_id}/progress")
async def get_progress(
    document_id: uuid.UUID,
    user: CurrentUser = Depends(),
) -> ProgressResponse:
    """Poll for processing progress."""
    job = PipelineStatus.get_job(document_id)
    if not job:
        raise HTTPException(status_code=404, detail="Document not found or not started")
    
    return ProgressResponse(
        document_id=document_id,
        step=job["step"],
        progress=job["progress"],
        status=job["status"],
        result=job["result"],
        error_message=job["error_message"],
    )


async def process_document_task(
    doc_id: uuid.UUID,
    file: UploadFile,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """Background task for document processing."""
    try:
        pipeline = DocumentProcessingPipeline(
            extractor=DocumentExtractor(),
            llm_pipeline=LLMPipeline(llm_client, db),
            vector_search=VectorSearchService(db),
            db=db,
        )
        await pipeline.process_document(doc_id, file, project_id, user_id)
    except Exception as e:
        PipelineStatus.update_job(
            doc_id, "error", 0, status="error", error_message=str(e)
        )
```

- [ ] **Register router in main.py**

```python
from app.ai_pipeline.router import router as ai_pipeline_router
app.include_router(ai_pipeline_router, prefix="/api/ai-pipeline", tags=["ai-pipeline"])
```

- [ ] **Integration tests**
  - Test upload endpoint (mock file, check SourceDocument created)
  - Test progress endpoint (mock PipelineStatus)
  - Test async processing (mock DocumentExtractor + LLMPipeline, verify JobModel created)

---

### Task 8: Alembic Migration

**Files:**
- Create: `backend/alembic/versions/add_vector_kb_tables.py`

- [ ] **Generate migration**

Tables:
- `vector_knowledge_base` (id, content, category, industry, standard_name, embedding vector(1536), source)
- `prompt_templates` (id, name, step, industry, template text, is_active, version)

- [ ] **Test migration** (upgrade, downgrade, re-upgrade)

---

### Task 9: Full Test Suite + Documentation

**Files:**
- Create: `backend/tests/ai_pipeline/` (models, schemas, extraction, llm, vector, pipeline, router tests)

- [ ] **Run all tests**
  - Job models tests: all passing
  - AI pipeline tests: model creation, extraction, LLM chain, vector search, pipeline orchestration, router
  - Full suite: >80% coverage

- [ ] **Verify API docs** (`/docs` includes `/api/ai-pipeline/documents/upload` and `/progress`)

---

## Key Features Implemented

✅ Document upload (PDF, Word, images with OCR placeholder)
✅ Text extraction with error handling
✅ 4-step LLM prompt chain (extract → clean → decompose → grade)
✅ pgvector semantic matching with VectorKnowledgeBase
✅ Prompt template management (industry-specific + generic fallback)
✅ Async background processing with progress tracking (in-memory)
✅ Auto-generates JobModel structure from LLM output
✅ Comprehensive error handling and logging

## Implementation Notes

1. **LLM API:** Uses DeepSeek Chat API (via `settings.llm_api_key`). Swap endpoint/model in `LLMClient` for Qwen/other providers.

2. **pgvector:** Phase 3 v1 uses naive string matching; Phase 4+ implements real embeddings via OpenAI/Jina APIs.

3. **Progress Tracking:** In-memory `PipelineStatus` dict. Phase 4+: persist to `DocumentProcessingJob` DB table for long-term tracking.

4. **Prompt Templates:** Seed 4 base templates on startup. Admins can create/edit via future `/api/prompt-templates` CRUD endpoints.

5. **File Storage:** Phase 3 v1 saves `file_path` but doesn't actually persist files. Phase 4+: integrate object storage (S3/MinIO).

6. **Rate Limiting:** Add to `/upload` endpoint in production (e.g., 5 docs/hour per user).

---

## Execution Options

**1. Subagent-Driven (recommended)**
- Dispatch 1 implementer subagent per task (1-9)
- Code review after each task
- Fast iteration, clean commits

**2. Inline Execution**
- Execute tasks sequentially in this session
- Batch similar work (models + schemas, extraction + LLM)
- Good for quick iteration if no context limits

Choose approach below, or I'll default to subagent-driven. 🚀

# Phase 2: Job Model Data + CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the core job competency model data layer — models, schemas, service, router, migration, and tests — so that projects, models, dimensions, skills, knowledge points, and templates can be managed via API.

**Architecture:** New `backend/src/app/job_models/` package following the same pattern as `rbac/` (models → schemas → service → router). Seven SQLAlchemy models + one association table + Alembic migration. Router registered under `/api/job-models/`. SourceDocument is included in this phase for the data model only (the upload/AI pipeline is Phase 3).

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (async), Pydantic v2, Alembic, pytest + httpx

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `backend/src/app/job_models/__init__.py` | Package init |
| Create | `backend/src/app/job_models/models.py` | 7 models + 1 association table |
| Create | `backend/src/app/job_models/schemas.py` | Pydantic request/response schemas |
| Create | `backend/src/app/job_models/service.py` | CRUD + version control logic |
| Create | `backend/src/app/job_models/router.py` | API routes: projects, models, templates |
| Create | `backend/alembic/versions/add_job_model_tables.py` | Alembic migration for all tables |
| Modify | `backend/src/app/main.py` | Register job_models router |
| Create | `backend/tests/job_models/__init__.py` | Test package init |
| Create | `backend/tests/job_models/conftest.py` | Test fixtures |
| Create | `backend/tests/job_models/test_models.py` | Model + schema unit tests |
| Create | `backend/tests/job_models/test_service.py` | Service layer tests |
| Create | `backend/tests/job_models/test_router.py` | API endpoint integration tests |

---

### Task 1: SQLAlchemy Models

**Files:**
- Create: `backend/src/app/job_models/__init__.py`
- Create: `backend/src/app/job_models/models.py`
- Test: `backend/tests/job_models/test_models.py`

- [ ] **Step 1: Create package init**

```python
# backend/src/app/job_models/__init__.py
```

Empty file.

- [ ] **Step 2: Write the models**

Create `backend/src/app/job_models/models.py`:

```python
"""Job competency model data models."""

import enum
import uuid

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, BaseModel, TimestampMixin


class ProjectStatus(str, enum.Enum):
    DRAFT = "draft"
    GENERATING = "generating"
    REVIEW = "review"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class SourceType(str, enum.Enum):
    AI_GENERATED = "ai_generated"
    MANUAL = "manual"
    TEMPLATE = "template"


class SkillLevel(str, enum.Enum):
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"
    L4 = "L4"
    L5 = "L5"


class Difficulty(str, enum.Enum):
    BEGINNER = "入门"
    ELEMENTARY = "初级"
    INTERMEDIATE = "中级"
    ADVANCED = "高级"
    HARD = "困难"


class MatchType(str, enum.Enum):
    AUTO = "auto"
    MANUAL = "manual"


class FileType(str, enum.Enum):
    PDF = "pdf"
    WORD = "word"
    TXT = "txt"
    EXCEL = "excel"


class JobModelProject(BaseModel):
    __tablename__ = "job_model_projects"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), default=ProjectStatus.DRAFT.value, nullable=False
    )

    models: Mapped[list["JobModel"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    documents: Mapped[list["SourceDocument"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class JobModel(BaseModel):
    __tablename__ = "job_models"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_model_projects.id", ondelete="CASCADE"), nullable=False
    )
    job_role: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    version_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_type: Mapped[str] = mapped_column(
        String(20), default=SourceType.MANUAL.value, nullable=False
    )
    raw_content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    project: Mapped["JobModelProject"] = relationship(back_populates="models")
    dimensions: Mapped[list["CompetencyDimension"]] = relationship(
        back_populates="model", cascade="all, delete-orphan", order_by="CompetencyDimension.sort_order"
    )


class CompetencyDimension(BaseModel):
    __tablename__ = "competency_dimensions"

    model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_models.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    model: Mapped["JobModel"] = relationship(back_populates="dimensions")
    skills: Mapped[list["Skill"]] = relationship(
        back_populates="dimension", cascade="all, delete-orphan", order_by="Skill.sort_order"
    )


class Skill(BaseModel):
    __tablename__ = "skills"

    dimension_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("competency_dimensions.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    dimension: Mapped["CompetencyDimension"] = relationship(back_populates="skills")
    knowledge_points: Mapped[list["SkillKnowledgePoint"]] = relationship(
        back_populates="skill", cascade="all, delete-orphan", order_by="SkillKnowledgePoint.sort_order"
    )


class SkillKnowledgePoint(BaseModel):
    __tablename__ = "skill_knowledge_points"

    skill_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    teaching_suggestion: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(10), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    skill: Mapped["Skill"] = relationship(back_populates="knowledge_points")
    kp_mappings: Mapped[list["SkillKpMapping"]] = relationship(
        back_populates="skill_kp", cascade="all, delete-orphan"
    )


class SkillKpMapping(Base, TimestampMixin):
    """Maps a SkillKnowledgePoint to an existing KnowledgePoint in the learning system."""
    __tablename__ = "skill_kp_mappings"

    skill_kp_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("skill_knowledge_points.id", ondelete="CASCADE"), primary_key=True
    )
    knowledge_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id", ondelete="CASCADE"), primary_key=True
    )
    match_type: Mapped[str] = mapped_column(
        String(10), default=MatchType.MANUAL.value, nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)

    skill_kp: Mapped["SkillKnowledgePoint"] = relationship(back_populates="kp_mappings")


class SourceDocument(BaseModel):
    __tablename__ = "source_documents"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_model_projects.id", ondelete="CASCADE"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=False
    )

    project: Mapped["JobModelProject"] = relationship(back_populates="documents")


class JobModelTemplate(BaseModel):
    __tablename__ = "job_model_templates"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    template_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=False
    )
```

- [ ] **Step 3: Write model tests**

Create `backend/tests/job_models/__init__.py` (empty) and `backend/tests/job_models/test_models.py`:

```python
"""Unit tests for job model SQLAlchemy models."""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelProject,
    JobModelTemplate,
    ProjectStatus,
    Skill,
    SkillKnowledgePoint,
    SourceDocument,
)
from app.rbac.models import Organization


@pytest.fixture
async def org(db_session: AsyncSession) -> Organization:
    org = Organization(name="Test Org", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
async def user_id() -> uuid.UUID:
    """Use a fake user_id — FK not enforced in SQLite test DB."""
    return uuid.uuid4()


@pytest.mark.asyncio
async def test_create_project(db_session: AsyncSession, org: Organization, user_id: uuid.UUID) -> None:
    project = JobModelProject(
        name="Test Project",
        industry="IT",
        org_id=org.id,
        created_by=user_id,
        status=ProjectStatus.DRAFT.value,
    )
    db_session.add(project)
    await db_session.flush()
    assert project.id is not None
    assert project.status == "draft"


@pytest.mark.asyncio
async def test_create_full_hierarchy(db_session: AsyncSession, org: Organization, user_id: uuid.UUID) -> None:
    project = JobModelProject(name="P", industry="IT", org_id=org.id, created_by=user_id)
    db_session.add(project)
    await db_session.flush()

    model = JobModel(project_id=project.id, job_role="Engineer", version=1, is_current=True)
    db_session.add(model)
    await db_session.flush()

    dim = CompetencyDimension(model_id=model.id, name="Tech Skills", sort_order=0)
    db_session.add(dim)
    await db_session.flush()

    skill = Skill(dimension_id=dim.id, name="Python", level="L3", sort_order=0)
    db_session.add(skill)
    await db_session.flush()

    kp = SkillKnowledgePoint(skill_id=skill.id, name="Decorators", sort_order=0)
    db_session.add(kp)
    await db_session.flush()

    assert kp.id is not None

    # Verify cascade via query
    result = await db_session.execute(
        select(SkillKnowledgePoint).where(SkillKnowledgePoint.skill_id == skill.id)
    )
    assert len(result.scalars().all()) == 1


@pytest.mark.asyncio
async def test_create_template(db_session: AsyncSession, user_id: uuid.UUID) -> None:
    template = JobModelTemplate(
        name="Generic Engineer",
        industry="IT",
        template_data={"dimensions": []},
        is_system=True,
        created_by=user_id,
    )
    db_session.add(template)
    await db_session.flush()
    assert template.id is not None
    assert template.usage_count == 0
```

- [ ] **Step 4: Run tests to verify**

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run pytest tests/job_models/test_models.py -v`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/job_models/ backend/tests/job_models/
git commit -m "feat: add job model SQLAlchemy models and unit tests"
```

---

### Task 2: Pydantic Schemas

**Files:**
- Create: `backend/src/app/job_models/schemas.py`
- Test: `backend/tests/job_models/test_models.py` (add schema tests)

- [ ] **Step 1: Write schemas**

Create `backend/src/app/job_models/schemas.py`:

```python
"""Pydantic schemas for job competency model entities."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProjectStatusEnum = Literal["draft", "generating", "review", "published", "archived"]
SourceTypeEnum = Literal["ai_generated", "manual", "template"]
SkillLevelEnum = Literal["L1", "L2", "L3", "L4", "L5"]
DifficultyEnum = Literal["入门", "初级", "中级", "高级", "困难"]
MatchTypeEnum = Literal["auto", "manual"]
FileTypeEnum = Literal["pdf", "word", "txt", "excel"]


# --- SkillKnowledgePoint ---

class SkillKnowledgePointCreate(BaseModel):
    name: str = Field(max_length=200)
    teaching_suggestion: str | None = None
    difficulty: DifficultyEnum | None = None
    sort_order: int = 0


class SkillKnowledgePointUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    teaching_suggestion: str | None = None
    difficulty: DifficultyEnum | None = None
    sort_order: int | None = None


class SkillKnowledgePointResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    skill_id: uuid.UUID
    name: str
    teaching_suggestion: str | None
    difficulty: str | None
    sort_order: int
    created_at: datetime
    updated_at: datetime


# --- Skill ---

class SkillCreate(BaseModel):
    name: str = Field(max_length=200)
    level: SkillLevelEnum | None = None
    description: str | None = None
    sort_order: int = 0
    knowledge_points: list[SkillKnowledgePointCreate] = Field(default_factory=list)


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    level: SkillLevelEnum | None = None
    description: str | None = None
    sort_order: int | None = None


class SkillResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    dimension_id: uuid.UUID
    name: str
    level: str | None
    description: str | None
    sort_order: int
    knowledge_points: list[SkillKnowledgePointResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


# --- CompetencyDimension ---

class DimensionCreate(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None
    sort_order: int = 0
    skills: list[SkillCreate] = Field(default_factory=list)


class DimensionUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    sort_order: int | None = None


class DimensionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    model_id: uuid.UUID
    name: str
    description: str | None
    sort_order: int
    skills: list[SkillResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


# --- JobModel ---

class JobModelCreate(BaseModel):
    job_role: str = Field(max_length=200)
    version_note: str | None = None
    source_type: SourceTypeEnum = "manual"
    dimensions: list[DimensionCreate] = Field(default_factory=list)


class JobModelUpdate(BaseModel):
    job_role: str | None = Field(default=None, max_length=200)
    version_note: str | None = None


class JobModelResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    project_id: uuid.UUID
    job_role: str
    version: int
    version_note: str | None
    is_current: bool
    source_type: str
    dimensions: list[DimensionResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class JobModelSummary(BaseModel):
    """Lightweight response without nested dimensions."""
    model_config = {"from_attributes": True}

    id: uuid.UUID
    project_id: uuid.UUID
    job_role: str
    version: int
    version_note: str | None
    is_current: bool
    source_type: str
    created_at: datetime
    updated_at: datetime


# --- JobModelProject ---

class ProjectCreate(BaseModel):
    name: str = Field(max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    description: str | None = None
    status: ProjectStatusEnum | None = None


class ProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    industry: str | None
    description: str | None
    org_id: uuid.UUID
    created_by: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime


# --- SourceDocument ---

class SourceDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    project_id: uuid.UUID
    file_name: str
    file_type: str
    uploaded_by: uuid.UUID
    created_at: datetime


# --- JobModelTemplate ---

class TemplateCreate(BaseModel):
    name: str = Field(max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    template_data: dict


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    template_data: dict | None = None


class TemplateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    industry: str | None
    template_data: dict
    is_system: bool
    usage_count: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 2: Add schema validation tests to test_models.py**

Append to `backend/tests/job_models/test_models.py`:

```python
from app.job_models.schemas import (
    DimensionCreate,
    JobModelCreate,
    ProjectCreate,
    SkillCreate,
    SkillKnowledgePointCreate,
    TemplateCreate,
)


def test_project_create_schema() -> None:
    data = ProjectCreate(name="Test", industry="IT")
    assert data.name == "Test"
    assert data.description is None


def test_job_model_create_nested() -> None:
    data = JobModelCreate(
        job_role="Engineer",
        dimensions=[
            DimensionCreate(
                name="Tech",
                skills=[
                    SkillCreate(
                        name="Python",
                        level="L3",
                        knowledge_points=[
                            SkillKnowledgePointCreate(name="Decorators"),
                        ],
                    ),
                ],
            ),
        ],
    )
    assert len(data.dimensions) == 1
    assert len(data.dimensions[0].skills) == 1
    assert len(data.dimensions[0].skills[0].knowledge_points) == 1


def test_template_create_schema() -> None:
    data = TemplateCreate(name="Template", template_data={"dimensions": []})
    assert data.template_data == {"dimensions": []}
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run pytest tests/job_models/test_models.py -v`
Expected: 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/app/job_models/schemas.py backend/tests/job_models/test_models.py
git commit -m "feat: add job model Pydantic schemas with nested create support"
```

---

### Task 3: Service Layer

**Files:**
- Create: `backend/src/app/job_models/service.py`
- Create: `backend/tests/job_models/conftest.py`
- Create: `backend/tests/job_models/test_service.py`

- [ ] **Step 1: Write service**

Create `backend/src/app/job_models/service.py`:

```python
"""Business logic for job model CRUD and version control."""

import uuid

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelProject,
    JobModelTemplate,
    Skill,
    SkillKnowledgePoint,
    SourceDocument,
)
from app.job_models.schemas import (
    DimensionCreate,
    DimensionUpdate,
    JobModelCreate,
    JobModelUpdate,
    ProjectCreate,
    ProjectUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    SkillUpdate,
    SkillKnowledgePointUpdate,
    TemplateCreate,
    TemplateUpdate,
)


# --- Project CRUD ---


async def create_project(
    db: AsyncSession, data: ProjectCreate, org_id: uuid.UUID, user_id: uuid.UUID
) -> JobModelProject:
    project = JobModelProject(
        name=data.name,
        industry=data.industry,
        description=data.description,
        org_id=org_id,
        created_by=user_id,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


async def get_project_by_id(db: AsyncSession, project_id: uuid.UUID) -> JobModelProject | None:
    result = await db.execute(
        select(JobModelProject).where(
            JobModelProject.id == project_id,
            JobModelProject.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def list_projects(
    db: AsyncSession, org_id: uuid.UUID, skip: int = 0, limit: int = 50
) -> tuple[list[JobModelProject], int]:
    base = select(JobModelProject).where(
        JobModelProject.org_id == org_id,
        JobModelProject.deleted_at.is_(None),
    )
    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar() or 0

    result = await db.execute(
        base.order_by(JobModelProject.created_at.desc()).offset(skip).limit(limit)
    )
    return list(result.scalars().all()), total


async def update_project(
    db: AsyncSession, project: JobModelProject, data: ProjectUpdate
) -> JobModelProject:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)
    await db.flush()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, project: JobModelProject) -> None:
    from datetime import datetime, timezone
    project.deleted_at = datetime.now(timezone.utc)
    await db.flush()


# --- JobModel CRUD + Version Control ---


async def create_job_model(
    db: AsyncSession, project_id: uuid.UUID, data: JobModelCreate
) -> JobModel:
    model = JobModel(
        project_id=project_id,
        job_role=data.job_role,
        version=1,
        version_note=data.version_note,
        is_current=True,
        source_type=data.source_type,
    )
    db.add(model)
    await db.flush()

    for dim_data in data.dimensions:
        await _create_dimension(db, model.id, dim_data)

    await db.refresh(model)
    return model


async def get_job_model_by_id(db: AsyncSession, model_id: uuid.UUID) -> JobModel | None:
    result = await db.execute(
        select(JobModel)
        .options(
            selectinload(JobModel.dimensions)
            .selectinload(CompetencyDimension.skills)
            .selectinload(Skill.knowledge_points)
        )
        .where(JobModel.id == model_id, JobModel.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def list_job_models(
    db: AsyncSession, project_id: uuid.UUID
) -> list[JobModel]:
    result = await db.execute(
        select(JobModel)
        .where(
            JobModel.project_id == project_id,
            JobModel.deleted_at.is_(None),
        )
        .order_by(JobModel.version.desc())
    )
    return list(result.scalars().all())


async def update_job_model(
    db: AsyncSession, model: JobModel, data: JobModelUpdate
) -> JobModel:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(model, field, value)
    await db.flush()
    await db.refresh(model)
    return model


async def publish_new_version(
    db: AsyncSession, model: JobModel, version_note: str | None = None
) -> JobModel:
    """Create a new version by duplicating the current model and its hierarchy."""
    # Mark all existing versions as not current
    existing = await db.execute(
        select(JobModel).where(
            JobModel.project_id == model.project_id,
            JobModel.is_current.is_(True),
        )
    )
    for m in existing.scalars().all():
        m.is_current = False
    await db.flush()

    # Get max version
    max_ver_result = await db.execute(
        select(func.max(JobModel.version)).where(
            JobModel.project_id == model.project_id
        )
    )
    max_version = max_ver_result.scalar() or 0

    # Create new version
    new_model = JobModel(
        project_id=model.project_id,
        job_role=model.job_role,
        version=max_version + 1,
        version_note=version_note,
        is_current=True,
        source_type=model.source_type,
        raw_content=model.raw_content,
    )
    db.add(new_model)
    await db.flush()

    # Duplicate dimensions → skills → knowledge points
    loaded = await get_job_model_by_id(db, model.id)
    if loaded:
        for dim in loaded.dimensions:
            new_dim = CompetencyDimension(
                model_id=new_model.id,
                name=dim.name,
                description=dim.description,
                sort_order=dim.sort_order,
            )
            db.add(new_dim)
            await db.flush()
            for skill in dim.skills:
                new_skill = Skill(
                    dimension_id=new_dim.id,
                    name=skill.name,
                    level=skill.level,
                    description=skill.description,
                    sort_order=skill.sort_order,
                )
                db.add(new_skill)
                await db.flush()
                for kp in skill.knowledge_points:
                    new_kp = SkillKnowledgePoint(
                        skill_id=new_skill.id,
                        name=kp.name,
                        teaching_suggestion=kp.teaching_suggestion,
                        difficulty=kp.difficulty,
                        sort_order=kp.sort_order,
                    )
                    db.add(new_kp)

    await db.flush()
    await db.refresh(new_model)
    return new_model


# --- Dimension/Skill/KP CRUD (for editor operations) ---


async def _create_dimension(
    db: AsyncSession, model_id: uuid.UUID, data: DimensionCreate
) -> CompetencyDimension:
    dim = CompetencyDimension(
        model_id=model_id,
        name=data.name,
        description=data.description,
        sort_order=data.sort_order,
    )
    db.add(dim)
    await db.flush()
    for skill_data in data.skills:
        await _create_skill(db, dim.id, skill_data)
    return dim


async def create_dimension(
    db: AsyncSession, model_id: uuid.UUID, data: DimensionCreate
) -> CompetencyDimension:
    dim = await _create_dimension(db, model_id, data)
    await db.refresh(dim)
    return dim


async def update_dimension(
    db: AsyncSession, dim: CompetencyDimension, data: DimensionUpdate
) -> CompetencyDimension:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(dim, field, value)
    await db.flush()
    await db.refresh(dim)
    return dim


async def delete_dimension(db: AsyncSession, dim: CompetencyDimension) -> None:
    await db.delete(dim)
    await db.flush()


async def _create_skill(
    db: AsyncSession, dimension_id: uuid.UUID, data: SkillCreate
) -> Skill:
    skill = Skill(
        dimension_id=dimension_id,
        name=data.name,
        level=data.level,
        description=data.description,
        sort_order=data.sort_order,
    )
    db.add(skill)
    await db.flush()
    for kp_data in data.knowledge_points:
        _create_knowledge_point(db, skill.id, kp_data)
    await db.flush()
    return skill


def _create_knowledge_point(
    db: AsyncSession, skill_id: uuid.UUID, data: SkillKnowledgePointCreate
) -> SkillKnowledgePoint:
    kp = SkillKnowledgePoint(
        skill_id=skill_id,
        name=data.name,
        teaching_suggestion=data.teaching_suggestion,
        difficulty=data.difficulty,
        sort_order=data.sort_order,
    )
    db.add(kp)
    return kp


async def create_skill(
    db: AsyncSession, dimension_id: uuid.UUID, data: SkillCreate
) -> Skill:
    skill = await _create_skill(db, dimension_id, data)
    await db.refresh(skill)
    return skill


async def update_skill(db: AsyncSession, skill: Skill, data: SkillUpdate) -> Skill:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(skill, field, value)
    await db.flush()
    await db.refresh(skill)
    return skill


async def delete_skill(db: AsyncSession, skill: Skill) -> None:
    await db.delete(skill)
    await db.flush()


async def create_knowledge_point(
    db: AsyncSession, skill_id: uuid.UUID, data: SkillKnowledgePointCreate
) -> SkillKnowledgePoint:
    kp = _create_knowledge_point(db, skill_id, data)
    await db.flush()
    await db.refresh(kp)
    return kp


async def update_knowledge_point(
    db: AsyncSession, kp: SkillKnowledgePoint, data: SkillKnowledgePointUpdate
) -> SkillKnowledgePoint:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(kp, field, value)
    await db.flush()
    await db.refresh(kp)
    return kp


async def delete_knowledge_point(db: AsyncSession, kp: SkillKnowledgePoint) -> None:
    await db.delete(kp)
    await db.flush()


# --- Template CRUD ---


async def create_template(
    db: AsyncSession, data: TemplateCreate, user_id: uuid.UUID, is_system: bool = False
) -> JobModelTemplate:
    template = JobModelTemplate(
        name=data.name,
        industry=data.industry,
        template_data=data.template_data,
        is_system=is_system,
        created_by=user_id,
    )
    db.add(template)
    await db.flush()
    await db.refresh(template)
    return template


async def list_templates(
    db: AsyncSession, industry: str | None = None
) -> list[JobModelTemplate]:
    query = select(JobModelTemplate).where(JobModelTemplate.deleted_at.is_(None))
    if industry:
        query = query.where(JobModelTemplate.industry == industry)
    result = await db.execute(query.order_by(JobModelTemplate.usage_count.desc()))
    return list(result.scalars().all())


async def get_template_by_id(db: AsyncSession, template_id: uuid.UUID) -> JobModelTemplate | None:
    result = await db.execute(
        select(JobModelTemplate).where(
            JobModelTemplate.id == template_id,
            JobModelTemplate.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def update_template(
    db: AsyncSession, template: JobModelTemplate, data: TemplateUpdate
) -> JobModelTemplate:
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)
    await db.flush()
    await db.refresh(template)
    return template


async def save_model_as_template(
    db: AsyncSession, model: JobModel, name: str, user_id: uuid.UUID
) -> JobModelTemplate:
    """Save a published job model as a reusable template."""
    loaded = await get_job_model_by_id(db, model.id)
    template_data: dict = {"dimensions": []}
    if loaded:
        for dim in loaded.dimensions:
            dim_dict: dict = {
                "name": dim.name,
                "description": dim.description,
                "skills": [],
            }
            for skill in dim.skills:
                skill_dict: dict = {
                    "name": skill.name,
                    "level": skill.level,
                    "description": skill.description,
                    "knowledge_points": [
                        {
                            "name": kp.name,
                            "teaching_suggestion": kp.teaching_suggestion,
                            "difficulty": kp.difficulty,
                        }
                        for kp in skill.knowledge_points
                    ],
                }
                dim_dict["skills"].append(skill_dict)
            template_data["dimensions"].append(dim_dict)

    template = JobModelTemplate(
        name=name,
        industry=loaded.project.industry if loaded and loaded.project else None,
        template_data=template_data,
        is_system=False,
        created_by=user_id,
    )
    db.add(template)
    await db.flush()
    await db.refresh(template)
    return template
```

- [ ] **Step 2: Write test fixtures**

Create `backend/tests/job_models/conftest.py`:

```python
"""Test fixtures for job model tests."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.job_models.models import JobModel, JobModelProject
from app.rbac.models import Organization


@pytest.fixture
async def org(db_session: AsyncSession) -> Organization:
    org = Organization(name="Test Org", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
def user_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
async def project(db_session: AsyncSession, org: Organization, user_id: uuid.UUID) -> JobModelProject:
    from app.job_models.schemas import ProjectCreate
    from app.job_models.service import create_project

    return await create_project(
        db_session,
        ProjectCreate(name="Test Project", industry="IT"),
        org_id=org.id,
        user_id=user_id,
    )
```

- [ ] **Step 3: Write service tests**

Create `backend/tests/job_models/test_service.py`:

```python
"""Tests for job model service layer."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.job_models.models import JobModelProject
from app.job_models.schemas import (
    DimensionCreate,
    JobModelCreate,
    ProjectCreate,
    ProjectUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    TemplateCreate,
)
from app.job_models.service import (
    create_job_model,
    create_project,
    create_template,
    delete_project,
    get_job_model_by_id,
    get_project_by_id,
    list_job_models,
    list_projects,
    list_templates,
    publish_new_version,
    save_model_as_template,
    update_project,
)
from app.rbac.models import Organization


@pytest.fixture
async def org(db_session: AsyncSession) -> Organization:
    org = Organization(name="Test Org", type="enterprise", is_active=True)
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
def user_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.mark.asyncio
async def test_create_and_get_project(
    db_session: AsyncSession, org: Organization, user_id: uuid.UUID
) -> None:
    project = await create_project(
        db_session,
        ProjectCreate(name="My Project", industry="Automotive"),
        org_id=org.id,
        user_id=user_id,
    )
    assert project.name == "My Project"

    fetched = await get_project_by_id(db_session, project.id)
    assert fetched is not None
    assert fetched.id == project.id


@pytest.mark.asyncio
async def test_list_projects(
    db_session: AsyncSession, org: Organization, user_id: uuid.UUID
) -> None:
    await create_project(db_session, ProjectCreate(name="P1"), org_id=org.id, user_id=user_id)
    await create_project(db_session, ProjectCreate(name="P2"), org_id=org.id, user_id=user_id)

    projects, total = await list_projects(db_session, org_id=org.id)
    assert total == 2
    assert len(projects) == 2


@pytest.mark.asyncio
async def test_update_project(
    db_session: AsyncSession, org: Organization, user_id: uuid.UUID
) -> None:
    project = await create_project(
        db_session, ProjectCreate(name="Old"), org_id=org.id, user_id=user_id
    )
    updated = await update_project(db_session, project, ProjectUpdate(name="New"))
    assert updated.name == "New"


@pytest.mark.asyncio
async def test_soft_delete_project(
    db_session: AsyncSession, org: Organization, user_id: uuid.UUID
) -> None:
    project = await create_project(
        db_session, ProjectCreate(name="Delete Me"), org_id=org.id, user_id=user_id
    )
    await delete_project(db_session, project)

    fetched = await get_project_by_id(db_session, project.id)
    assert fetched is None


@pytest.mark.asyncio
async def test_create_job_model_with_hierarchy(
    db_session: AsyncSession, org: Organization, user_id: uuid.UUID
) -> None:
    project = await create_project(
        db_session, ProjectCreate(name="P"), org_id=org.id, user_id=user_id
    )
    model = await create_job_model(
        db_session,
        project.id,
        JobModelCreate(
            job_role="Embedded Engineer",
            dimensions=[
                DimensionCreate(
                    name="Technical Skills",
                    skills=[
                        SkillCreate(
                            name="C Programming",
                            level="L3",
                            knowledge_points=[
                                SkillKnowledgePointCreate(name="Pointers"),
                                SkillKnowledgePointCreate(name="Memory Management"),
                            ],
                        ),
                    ],
                ),
            ],
        ),
    )
    loaded = await get_job_model_by_id(db_session, model.id)
    assert loaded is not None
    assert loaded.version == 1
    assert loaded.is_current is True
    assert len(loaded.dimensions) == 1
    assert len(loaded.dimensions[0].skills) == 1
    assert len(loaded.dimensions[0].skills[0].knowledge_points) == 2


@pytest.mark.asyncio
async def test_publish_new_version(
    db_session: AsyncSession, org: Organization, user_id: uuid.UUID
) -> None:
    project = await create_project(
        db_session, ProjectCreate(name="P"), org_id=org.id, user_id=user_id
    )
    v1 = await create_job_model(
        db_session,
        project.id,
        JobModelCreate(
            job_role="Engineer",
            dimensions=[DimensionCreate(name="Dim1", skills=[SkillCreate(name="S1")])],
        ),
    )
    v2 = await publish_new_version(db_session, v1, version_note="Added skills")

    assert v2.version == 2
    assert v2.is_current is True

    # v1 should no longer be current
    await db_session.refresh(v1)
    assert v1.is_current is False

    # v2 should have same hierarchy
    loaded = await get_job_model_by_id(db_session, v2.id)
    assert loaded is not None
    assert len(loaded.dimensions) == 1


@pytest.mark.asyncio
async def test_template_crud(db_session: AsyncSession, user_id: uuid.UUID) -> None:
    template = await create_template(
        db_session,
        TemplateCreate(name="Generic", industry="IT", template_data={"dimensions": []}),
        user_id=user_id,
    )
    assert template.id is not None

    templates = await list_templates(db_session)
    assert len(templates) == 1

    templates_it = await list_templates(db_session, industry="IT")
    assert len(templates_it) == 1

    templates_auto = await list_templates(db_session, industry="Auto")
    assert len(templates_auto) == 0


@pytest.mark.asyncio
async def test_save_model_as_template(
    db_session: AsyncSession, org: Organization, user_id: uuid.UUID
) -> None:
    project = await create_project(
        db_session, ProjectCreate(name="P"), org_id=org.id, user_id=user_id
    )
    model = await create_job_model(
        db_session,
        project.id,
        JobModelCreate(
            job_role="Engineer",
            dimensions=[
                DimensionCreate(
                    name="Tech",
                    skills=[SkillCreate(name="Python", level="L3")],
                ),
            ],
        ),
    )
    template = await save_model_as_template(db_session, model, "My Template", user_id)
    assert template.name == "My Template"
    assert len(template.template_data["dimensions"]) == 1
    assert template.template_data["dimensions"][0]["skills"][0]["name"] == "Python"
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run pytest tests/job_models/test_service.py -v`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/job_models/service.py backend/tests/job_models/conftest.py backend/tests/job_models/test_service.py
git commit -m "feat: add job model service layer with version control and template support"
```

---

### Task 4: API Router

**Files:**
- Create: `backend/src/app/job_models/router.py`
- Modify: `backend/src/app/main.py`
- Create: `backend/tests/job_models/test_router.py`

- [ ] **Step 1: Write router**

Create `backend/src/app/job_models/router.py`:

```python
"""API routes for job model projects, models, and templates."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.job_models.models import CompetencyDimension, JobModel, Skill, SkillKnowledgePoint
from app.job_models.schemas import (
    DimensionCreate,
    DimensionResponse,
    DimensionUpdate,
    JobModelCreate,
    JobModelResponse,
    JobModelSummary,
    JobModelUpdate,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    SkillKnowledgePointResponse,
    SkillKnowledgePointUpdate,
    SkillResponse,
    SkillUpdate,
    TemplateCreate,
    TemplateResponse,
    TemplateUpdate,
)
from app.job_models.service import (
    create_dimension,
    create_job_model,
    create_knowledge_point,
    create_project,
    create_skill,
    create_template,
    delete_dimension,
    delete_knowledge_point,
    delete_project,
    delete_skill,
    get_job_model_by_id,
    get_project_by_id,
    get_template_by_id,
    list_job_models,
    list_projects,
    list_templates,
    publish_new_version,
    save_model_as_template,
    update_dimension,
    update_job_model,
    update_knowledge_point,
    update_project,
    update_skill,
    update_template,
)
from app.rbac.dependencies import CurrentOrgId

project_router = APIRouter()
model_router = APIRouter()
template_router = APIRouter()


# --- Project Routes ---


@project_router.get("", response_model=list[ProjectResponse])
async def list_all_projects(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: CurrentOrgId,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> list[ProjectResponse]:
    projects, total = await list_projects(db, org_id=org_id, skip=skip, limit=limit)
    return [ProjectResponse.model_validate(p) for p in projects]


@project_router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_new_project(
    body: ProjectCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: CurrentOrgId,
) -> ProjectResponse:
    project = await create_project(db, body, org_id=org_id, user_id=user.id)
    return ProjectResponse.model_validate(project)


@project_router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ProjectResponse:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse.model_validate(project)


@project_router.patch("/{project_id}", response_model=ProjectResponse)
async def update_existing_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> ProjectResponse:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    updated = await update_project(db, project, body)
    return ProjectResponse.model_validate(updated)


@project_router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_project(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    await delete_project(db, project)


# --- Model Routes (nested under projects) ---


@project_router.get("/{project_id}/models", response_model=list[JobModelSummary])
async def list_project_models(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[JobModelSummary]:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    models = await list_job_models(db, project_id)
    return [JobModelSummary.model_validate(m) for m in models]


@project_router.post(
    "/{project_id}/models", response_model=JobModelResponse, status_code=status.HTTP_201_CREATED
)
async def create_project_model(
    project_id: uuid.UUID,
    body: JobModelCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> JobModelResponse:
    project = await get_project_by_id(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    model = await create_job_model(db, project_id, body)
    loaded = await get_job_model_by_id(db, model.id)
    return JobModelResponse.model_validate(loaded)


@model_router.get("/{model_id}", response_model=JobModelResponse)
async def get_model_detail(
    model_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    return JobModelResponse.model_validate(model)


@model_router.patch("/{model_id}", response_model=JobModelResponse)
async def update_model(
    model_id: uuid.UUID,
    body: JobModelUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    updated = await update_job_model(db, model, body)
    loaded = await get_job_model_by_id(db, updated.id)
    return JobModelResponse.model_validate(loaded)


@model_router.post("/{model_id}/publish", response_model=JobModelResponse)
async def publish_model_version(
    model_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    version_note: str | None = None,
) -> JobModelResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    new_version = await publish_new_version(db, model, version_note)
    loaded = await get_job_model_by_id(db, new_version.id)
    return JobModelResponse.model_validate(loaded)


@model_router.post("/{model_id}/save-as-template", response_model=TemplateResponse)
async def save_as_template(
    model_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    name: str = Query(..., max_length=200),
) -> TemplateResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    template = await save_model_as_template(db, model, name, user.id)
    return TemplateResponse.model_validate(template)


# --- Dimension CRUD under model ---


@model_router.post("/{model_id}/dimensions", response_model=DimensionResponse, status_code=201)
async def add_dimension(
    model_id: uuid.UUID,
    body: DimensionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> DimensionResponse:
    model = await get_job_model_by_id(db, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    dim = await create_dimension(db, model_id, body)
    return DimensionResponse.model_validate(dim)


@model_router.patch("/dimensions/{dimension_id}", response_model=DimensionResponse)
async def update_dim(
    dimension_id: uuid.UUID,
    body: DimensionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> DimensionResponse:
    result = await db.execute(
        select(CompetencyDimension).where(CompetencyDimension.id == dimension_id)
    )
    dim = result.scalar_one_or_none()
    if dim is None:
        raise HTTPException(status_code=404, detail="Dimension not found")
    updated = await update_dimension(db, dim, body)
    return DimensionResponse.model_validate(updated)


@model_router.delete("/dimensions/{dimension_id}", status_code=204)
async def remove_dimension(
    dimension_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    result = await db.execute(
        select(CompetencyDimension).where(CompetencyDimension.id == dimension_id)
    )
    dim = result.scalar_one_or_none()
    if dim is None:
        raise HTTPException(status_code=404, detail="Dimension not found")
    await delete_dimension(db, dim)


# --- Skill CRUD under dimension ---


@model_router.post("/dimensions/{dimension_id}/skills", response_model=SkillResponse, status_code=201)
async def add_skill(
    dimension_id: uuid.UUID,
    body: SkillCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> SkillResponse:
    skill = await create_skill(db, dimension_id, body)
    return SkillResponse.model_validate(skill)


@model_router.patch("/skills/{skill_id}", response_model=SkillResponse)
async def update_skill_endpoint(
    skill_id: uuid.UUID,
    body: SkillUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> SkillResponse:
    result = await db.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    updated = await update_skill(db, skill, body)
    return SkillResponse.model_validate(updated)


@model_router.delete("/skills/{skill_id}", status_code=204)
async def remove_skill(
    skill_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    result = await db.execute(select(Skill).where(Skill.id == skill_id))
    skill = result.scalar_one_or_none()
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    await delete_skill(db, skill)


# --- KnowledgePoint CRUD under skill ---


@model_router.post("/skills/{skill_id}/knowledge-points", response_model=SkillKnowledgePointResponse, status_code=201)
async def add_knowledge_point(
    skill_id: uuid.UUID,
    body: SkillKnowledgePointCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> SkillKnowledgePointResponse:
    kp = await create_knowledge_point(db, skill_id, body)
    return SkillKnowledgePointResponse.model_validate(kp)


@model_router.patch("/knowledge-points/{kp_id}", response_model=SkillKnowledgePointResponse)
async def update_kp(
    kp_id: uuid.UUID,
    body: SkillKnowledgePointUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> SkillKnowledgePointResponse:
    result = await db.execute(select(SkillKnowledgePoint).where(SkillKnowledgePoint.id == kp_id))
    kp = result.scalar_one_or_none()
    if kp is None:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    updated = await update_knowledge_point(db, kp, body)
    return SkillKnowledgePointResponse.model_validate(updated)


@model_router.delete("/knowledge-points/{kp_id}", status_code=204)
async def remove_knowledge_point(
    kp_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> None:
    result = await db.execute(select(SkillKnowledgePoint).where(SkillKnowledgePoint.id == kp_id))
    kp = result.scalar_one_or_none()
    if kp is None:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    await delete_knowledge_point(db, kp)


# --- Template Routes ---


@template_router.get("", response_model=list[TemplateResponse])
async def list_all_templates(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    industry: str | None = None,
) -> list[TemplateResponse]:
    templates = await list_templates(db, industry=industry)
    return [TemplateResponse.model_validate(t) for t in templates]


@template_router.post("", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_new_template(
    body: TemplateCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> TemplateResponse:
    template = await create_template(db, body, user_id=user.id)
    return TemplateResponse.model_validate(template)


@template_router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> TemplateResponse:
    template = await get_template_by_id(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return TemplateResponse.model_validate(template)


@template_router.patch("/{template_id}", response_model=TemplateResponse)
async def update_existing_template(
    template_id: uuid.UUID,
    body: TemplateUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> TemplateResponse:
    template = await get_template_by_id(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    updated = await update_template(db, template, body)
    return TemplateResponse.model_validate(updated)
```

- [ ] **Step 2: Register routers in main.py**

Add to `backend/src/app/main.py`:

```python
from app.job_models.router import model_router as job_model_router
from app.job_models.router import project_router as job_project_router
from app.job_models.router import template_router as job_template_router

# After existing router registrations:
app.include_router(job_project_router, prefix="/api/job-models/projects", tags=["job-model-projects"])
app.include_router(job_model_router, prefix="/api/job-models/models", tags=["job-models"])
app.include_router(job_template_router, prefix="/api/job-models/templates", tags=["job-model-templates"])
```

- [ ] **Step 3: Write router tests**

Create `backend/tests/job_models/test_router.py`:

```python
"""Integration tests for job model API endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_and_list_projects(admin_client: AsyncClient) -> None:
    resp = await admin_client.post(
        "/api/job-models/projects",
        json={"name": "Test Project", "industry": "IT"},
    )
    assert resp.status_code == 201
    project_id = resp.json()["id"]

    resp = await admin_client.get("/api/job-models/projects")
    assert resp.status_code == 200
    projects = resp.json()
    assert any(p["id"] == project_id for p in projects)


@pytest.mark.asyncio
async def test_create_model_with_hierarchy(admin_client: AsyncClient) -> None:
    # Create project first
    resp = await admin_client.post(
        "/api/job-models/projects",
        json={"name": "P", "industry": "Auto"},
    )
    project_id = resp.json()["id"]

    # Create model with nested data
    resp = await admin_client.post(
        f"/api/job-models/projects/{project_id}/models",
        json={
            "job_role": "Embedded Engineer",
            "dimensions": [
                {
                    "name": "Technical Skills",
                    "skills": [
                        {
                            "name": "C Programming",
                            "level": "L3",
                            "knowledge_points": [
                                {"name": "Pointers"},
                                {"name": "Memory Management"},
                            ],
                        },
                    ],
                },
            ],
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["job_role"] == "Embedded Engineer"
    assert len(data["dimensions"]) == 1
    assert len(data["dimensions"][0]["skills"]) == 1
    assert len(data["dimensions"][0]["skills"][0]["knowledge_points"]) == 2


@pytest.mark.asyncio
async def test_get_model_detail(admin_client: AsyncClient) -> None:
    resp = await admin_client.post(
        "/api/job-models/projects",
        json={"name": "P"},
    )
    project_id = resp.json()["id"]

    resp = await admin_client.post(
        f"/api/job-models/projects/{project_id}/models",
        json={"job_role": "Dev"},
    )
    model_id = resp.json()["id"]

    resp = await admin_client.get(f"/api/job-models/models/{model_id}")
    assert resp.status_code == 200
    assert resp.json()["job_role"] == "Dev"


@pytest.mark.asyncio
async def test_publish_new_version(admin_client: AsyncClient) -> None:
    resp = await admin_client.post(
        "/api/job-models/projects",
        json={"name": "P"},
    )
    project_id = resp.json()["id"]

    resp = await admin_client.post(
        f"/api/job-models/projects/{project_id}/models",
        json={
            "job_role": "Dev",
            "dimensions": [{"name": "Tech", "skills": [{"name": "Go"}]}],
        },
    )
    model_id = resp.json()["id"]

    resp = await admin_client.post(
        f"/api/job-models/models/{model_id}/publish?version_note=v2"
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == 2
    assert resp.json()["is_current"] is True


@pytest.mark.asyncio
async def test_template_crud(admin_client: AsyncClient) -> None:
    resp = await admin_client.post(
        "/api/job-models/templates",
        json={"name": "Generic Engineer", "industry": "IT", "template_data": {"dimensions": []}},
    )
    assert resp.status_code == 201

    resp = await admin_client.get("/api/job-models/templates")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


@pytest.mark.asyncio
async def test_project_not_found(admin_client: AsyncClient) -> None:
    import uuid
    resp = await admin_client.get(f"/api/job-models/projects/{uuid.uuid4()}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_unauthenticated_request(client: AsyncClient) -> None:
    resp = await client.get("/api/job-models/projects")
    assert resp.status_code in (401, 403)
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run pytest tests/job_models/test_router.py -v`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/job_models/router.py backend/src/app/main.py backend/tests/job_models/test_router.py
git commit -m "feat: add job model API routes and integration tests"
```

---

### Task 5: Alembic Migration

**Files:**
- Create: `backend/alembic/versions/add_job_model_tables.py`

- [ ] **Step 1: Generate migration**

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run alembic revision --autogenerate -m "add job model tables"`

If autogenerate doesn't work (SQLite test DB), create manually.

- [ ] **Step 2: Verify migration file**

The migration should create these tables:
- `job_model_projects`
- `job_models`
- `competency_dimensions`
- `skills`
- `skill_knowledge_points`
- `skill_kp_mappings`
- `source_documents`
- `job_model_templates`

With proper foreign keys and indexes. Verify the `down_revision` chains from `5430b9d518c3` (the latest RBAC migration).

- [ ] **Step 3: Test migration**

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run alembic upgrade head`
Expected: Migration applies without errors.

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run alembic downgrade -1`
Expected: Rollback succeeds.

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run alembic upgrade head`
Expected: Re-apply succeeds.

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/
git commit -m "feat: add Alembic migration for job model tables"
```

---

### Task 6: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all job_models tests**

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run pytest tests/job_models/ -v`
Expected: All tests pass (model tests + service tests + router tests).

- [ ] **Step 2: Run full backend test suite**

Run: `cd /Users/jzefan/work/proj/exam/backend && uv run pytest -v`
Expected: All tests pass except the pre-existing `test_student_exam_flow` failure (KeyError: 'participated').

- [ ] **Step 3: Verify API docs**

Start server: `cd /Users/jzefan/work/proj/exam/backend && uv run uvicorn app.main:app --reload`
Open: `http://localhost:8000/docs`
Expected: `/api/job-models/projects`, `/api/job-models/models`, `/api/job-models/templates` endpoints visible.

- [ ] **Step 4: Commit if any fixes were needed**

Only commit if test failures required fixes.

# Paper Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable paper assets under exam management, support importing reviewed historical papers into reusable `Paper` records, and allow papers to seed exams/practices and AI-derived papers.

**Architecture:** Introduce a new `papers` backend module instead of extending `Exam`. `Paper` stores only successful reusable assets; import recovery is held in a lightweight import session with `preview_payload`, `error_detail`, and `created_paper_id`, not a status machine. Reuse existing question import recognition, question bulk creation, paper preview UI, and exam creation flows.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Alembic, Pydantic, pytest, React, TypeScript, Refine, React Router, shadcn/ui, Vitest

---

## File Map

### Backend

- Create: `backend/src/app/papers/__init__.py`
  - Package marker.
- Create: `backend/src/app/papers/models.py`
  - `Paper`, `PaperQuestion`, `PaperImportSession`, and `PaperSourceType`.
- Create: `backend/src/app/papers/schemas.py`
  - CRUD, detail, import, publish, and AI-generate request/response schemas.
- Create: `backend/src/app/papers/service.py`
  - Visibility queries, create/update/copy/archive/delete, import confirmation, exam seeding, and AI paper generation helpers.
- Create: `backend/src/app/papers/router.py`
  - `/api/papers` routes.
- Modify: `backend/src/app/main.py`
  - Import paper models in lifespan and include the router.
- Create: `backend/alembic/versions/20260509_add_papers.py`
  - Tables and indexes for `papers`, `paper_questions`, `paper_import_sessions`.
- Create: `backend/tests/test_papers.py`
  - API and service tests for core paper behavior.
- Create: `backend/tests/test_paper_import.py`
  - Import-session and confirm-import tests.
- Create: `backend/tests/test_paper_ai_generate.py`
  - Unit tests for source-paper profile mapping and AI event consumption.

### Frontend

- Modify: `frontend/src/types/index.ts`
  - `IPaper`, `IPaperQuestion`, `PaperSourceType`, import session response types.
- Modify: `frontend/src/App.tsx`
  - Add `papers` resource and `/papers`, `/papers/import`, `/papers/:id` routes.
- Modify: `frontend/src/components/layout.tsx`
  - Add “试卷列表” and “导入试卷” entries under 考试管理.
- Create: `frontend/src/pages/papers/api.ts`
  - Paper-specific API helpers for import and non-Refine actions.
- Create: `frontend/src/pages/papers/list.tsx`
  - Paper asset list.
- Create: `frontend/src/pages/papers/detail.tsx`
  - Paper detail and actions.
- Create: `frontend/src/pages/papers/import.tsx`
  - Paper import wizard reusing question import utils/components.
- Create: `frontend/src/pages/papers/ai-generate-dialog.tsx`
  - Source-paper AI generation dialog.
- Modify: `frontend/src/pages/exams/create.tsx`
  - Hydrate initial form from `paper_id` query string.
- Modify: `frontend/src/pages/exams/practice-create.tsx`
  - Hydrate practice form from `paper_id` query string.
- Modify: `frontend/src/pages/exams/components/PaperPreview.tsx`
  - Allow read-only usage for paper details.
- Create: `frontend/src/pages/papers/paper-utils.test.ts`
  - Frontend utility tests.

---

## Phase 1: Reusable Paper Assets

### Task 1: Add Paper Models and Migration

**Files:**
- Create: `backend/src/app/papers/__init__.py`
- Create: `backend/src/app/papers/models.py`
- Create: `backend/alembic/versions/20260509_add_papers.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/test_papers.py`

- [ ] **Step 1: Write the failing model smoke test**

Add this to `backend/tests/test_papers.py`:

```python
import pytest
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.service import create_user
from app.papers.models import Paper, PaperQuestion, PaperSourceType
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _teacher(db_session, username: str = "paper-teacher"):
    org = Organization(name=f"Org {username}", type="school", is_active=True)
    role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, role])
    await db_session.flush()
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="teacherpass123",
            full_name="Paper Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )


@pytest.mark.asyncio
async def test_paper_model_links_questions_without_import_status(db_session):
    teacher = await _teacher(db_session)
    question = Question(
        type=QuestionType.CHOICE,
        title="数据库单选题",
        content={"text": "MySQL 属于哪类数据库？"},
        options={"A": "关系型", "B": "缓存"},
        answer={"correct": "A"},
        analysis=None,
        difficulty=2,
        score=10,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    paper = Paper(
        title="历史试卷 A",
        description=None,
        source_type=PaperSourceType.IMPORT,
        source_paper_id=None,
        root_knowledge_point_id=None,
        is_reusable=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([question, paper])
    await db_session.flush()
    db_session.add(PaperQuestion(paper_id=paper.id, question_id=question.id, order=0, score_override=10))
    await db_session.commit()

    saved = (await db_session.execute(select(Paper).where(Paper.id == paper.id))).scalar_one()
    assert saved.source_type == PaperSourceType.IMPORT
    assert not hasattr(saved, "import_status")
    assert len(saved.paper_questions) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py::test_paper_model_links_questions_without_import_status -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.papers'`.

- [ ] **Step 3: Create `backend/src/app/papers/models.py`**

Implement:

```python
"""Reusable paper asset models."""

import enum
import uuid

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, JSON, String, Text, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.data_visibility import OwnerMixin
from app.models import Base, BaseModel, TimestampMixin


class PaperSourceType(str, enum.Enum):
    MANUAL = "manual"
    IMPORT = "import"
    AI_GENERATED = "ai_generated"


class Paper(OwnerMixin, BaseModel):
    __tablename__ = "papers"

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[PaperSourceType] = mapped_column(String(30), nullable=False, default=PaperSourceType.MANUAL.value)
    source_paper_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("papers.id", ondelete="SET NULL"), nullable=True)
    root_knowledge_point_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("knowledge_points.id", ondelete="SET NULL"), nullable=True)
    is_reusable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    archived_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)

    creator: Mapped["app.auth.models.User"] = relationship("User", foreign_keys=[created_by], lazy="joined")  # type: ignore[name-defined]
    root_knowledge_point: Mapped["app.learning.models.KnowledgePoint | None"] = relationship("KnowledgePoint", lazy="joined")  # type: ignore[name-defined]
    source_paper: Mapped["Paper | None"] = relationship("Paper", remote_side="Paper.id", lazy="joined")
    paper_questions: Mapped[list["PaperQuestion"]] = relationship("PaperQuestion", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        Index("ix_papers_owner_deleted_created", "owner_id", "deleted_at", "created_at"),
        Index("ix_papers_source_type", "source_type"),
        Index("ix_papers_root_knowledge_point_id", "root_knowledge_point_id"),
    )


class PaperQuestion(Base, TimestampMixin):
    __tablename__ = "paper_questions"

    paper_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    question_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("questions.id", ondelete="RESTRICT"), primary_key=True)
    order: Mapped[int] = mapped_column(nullable=False, default=0)
    score_override: Mapped[float | None] = mapped_column(Float, nullable=True)

    question: Mapped["app.questions.models.Question"] = relationship("Question", lazy="joined")  # type: ignore[name-defined]

    __table_args__ = (
        UniqueConstraint("paper_id", "order", name="uq_paper_questions_paper_order"),
        Index("ix_paper_questions_question_id", "question_id"),
    )


class PaperImportSession(BaseModel):
    __tablename__ = "paper_import_sessions"

    json_field = JSON().with_variant(JSONB, "postgresql")

    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_format: Mapped[str] = mapped_column(String(20), nullable=False)
    root_knowledge_point_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("knowledge_points.id", ondelete="SET NULL"), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_payload: Mapped[dict] = mapped_column(json_field, nullable=False, default=dict)
    created_paper_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("papers.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
```

- [ ] **Step 4: Create migration**

Create `backend/alembic/versions/20260509_add_papers.py` with `down_revision = "20260430_add_exam_public_links"` and tables matching the model. Use `sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")` for `preview_payload`. Add indexes from the model.

- [ ] **Step 5: Register metadata**

In `backend/src/app/main.py`, inside lifespan imports, add:

```python
from app.papers.models import Paper, PaperImportSession, PaperQuestion  # noqa: F401
```

- [ ] **Step 6: Run focused test**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py::test_paper_model_links_questions_without_import_status -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/papers/__init__.py backend/src/app/papers/models.py backend/src/app/main.py backend/alembic/versions/20260509_add_papers.py backend/tests/test_papers.py
git commit -m "feat: add reusable paper models"
```

### Task 2: Add Paper Schemas and Core Service

**Files:**
- Create: `backend/src/app/papers/schemas.py`
- Create: `backend/src/app/papers/service.py`
- Test: `backend/tests/test_papers.py`

- [ ] **Step 1: Add failing service tests**

Append to `backend/tests/test_papers.py`:

```python
from app.papers.schemas import PaperCreate, PaperQuestionItem
from app.papers.service import create_paper, get_paper_by_id, list_papers_for_user


@pytest.mark.asyncio
async def test_create_paper_service_returns_ordered_questions(db_session):
    teacher = await _teacher(db_session, "paper-create-teacher")
    q1 = Question(
        type=QuestionType.CHOICE,
        title="题目 1",
        content={"text": "题目 1"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    q2 = Question(
        type=QuestionType.CHOICE,
        title="题目 2",
        content={"text": "题目 2"},
        options={"A": "是", "B": "否"},
        answer={"correct": "B"},
        difficulty=3,
        score=8,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([q1, q2])
    await db_session.flush()

    paper = await create_paper(
        db_session,
        PaperCreate(
            title="服务创建试卷",
            description=None,
            source_type="manual",
            root_knowledge_point_id=None,
            question_items=[
                PaperQuestionItem(question_id=q2.id, order=0, score_override=8),
                PaperQuestionItem(question_id=q1.id, order=1, score_override=5),
            ],
        ),
        user=teacher,
        is_admin=False,
    )
    await db_session.commit()

    detail = await get_paper_by_id(db_session, paper.id, user=teacher, is_admin=False)
    assert detail is not None
    assert [item.question.title for item in detail.paper_questions] == ["题目 2", "题目 1"]


@pytest.mark.asyncio
async def test_list_papers_for_user_is_owner_scoped(db_session):
    teacher = await _teacher(db_session, "paper-owner-a")
    other = await _teacher(db_session, "paper-owner-b")
    db_session.add_all(
        [
            Paper(title="我的试卷", source_type=PaperSourceType.MANUAL, created_by=teacher.id, owner_id=teacher.id),
            Paper(title="别人的试卷", source_type=PaperSourceType.MANUAL, created_by=other.id, owner_id=other.id),
        ]
    )
    await db_session.commit()

    papers, total = await list_papers_for_user(db_session, user=teacher, is_admin=False)
    assert total == 1
    assert [paper.title for paper in papers] == ["我的试卷"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py -v
```

Expected: FAIL because schemas/service do not exist.

- [ ] **Step 3: Implement `schemas.py`**

Include:

```python
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.questions.schemas import KnowledgePointResponse, QuestionCreate, QuestionResponse

PaperSourceTypeLiteral = Literal["manual", "import", "ai_generated"]


class PaperQuestionItem(BaseModel):
    question_id: uuid.UUID
    order: int = Field(default=0, ge=0)
    score_override: float | None = Field(default=None, ge=0)


class PaperCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    source_type: PaperSourceTypeLiteral = "manual"
    source_paper_id: uuid.UUID | None = None
    root_knowledge_point_id: uuid.UUID | None = None
    is_reusable: bool = True
    question_items: list[PaperQuestionItem] = Field(default_factory=list, max_length=500)


class PaperUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    root_knowledge_point_id: uuid.UUID | None = None
    is_reusable: bool | None = None
    question_items: list[PaperQuestionItem] | None = Field(default=None, max_length=500)


class PaperQuestionResponse(BaseModel):
    question_id: uuid.UUID
    order: int
    score_override: float | None
    question: QuestionResponse | None = None


class PaperResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    source_type: PaperSourceTypeLiteral
    source_paper_id: uuid.UUID | None
    root_knowledge_point_id: uuid.UUID | None
    root_knowledge_point: KnowledgePointResponse | None = None
    is_reusable: bool
    archived_at: datetime | None
    question_count: int
    total_score: float
    owner_id: uuid.UUID
    created_by: uuid.UUID
    created_by_name: str
    created_at: datetime
    updated_at: datetime


class PaperDetailResponse(PaperResponse):
    questions: list[PaperQuestionResponse] = Field(default_factory=list)
```

- [ ] **Step 4: Implement `service.py` core functions**

Implement these imports and functions:

```python
from datetime import datetime, timezone
import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.auth.models import User
from app.common.resource_access import teacher_owned_resource_filter
from app.papers.models import Paper, PaperQuestion
from app.papers.schemas import PaperCreate, PaperQuestionItem, PaperUpdate


def paper_base_query() -> Select:
    return (
        select(Paper)
        .where(Paper.deleted_at.is_(None))
        .options(
            joinedload(Paper.creator),
            joinedload(Paper.root_knowledge_point),
            selectinload(Paper.paper_questions).joinedload(PaperQuestion.question),
        )
    )


def paper_scope_query(user: User, is_admin: bool) -> Select:
    query = paper_base_query()
    if not is_admin:
        query = query.where(teacher_owned_resource_filter(Paper, user.id))
    return query


async def list_papers_for_user(db: AsyncSession, *, user: User, is_admin: bool) -> tuple[list[Paper], int]:
    query = paper_scope_query(user, is_admin).order_by(Paper.created_at.desc())
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.execute(query)).scalars().unique().all()
    return list(rows), int(total or 0)


async def get_paper_by_id(db: AsyncSession, paper_id: uuid.UUID, *, user: User, is_admin: bool) -> Paper | None:
    result = await db.execute(paper_scope_query(user, is_admin).where(Paper.id == paper_id))
    paper = result.scalars().unique().one_or_none()
    if paper:
        paper.paper_questions.sort(key=lambda item: item.order)
    return paper


async def sync_paper_questions(db: AsyncSession, paper: Paper, question_items: list[PaperQuestionItem]) -> None:
    paper.paper_questions.clear()
    await db.flush()
    for index, item in enumerate(question_items):
        paper.paper_questions.append(
            PaperQuestion(
                paper_id=paper.id,
                question_id=item.question_id,
                order=item.order if item.order is not None else index,
                score_override=item.score_override,
            )
        )


async def create_paper(db: AsyncSession, data: PaperCreate, *, user: User, is_admin: bool) -> Paper:
    paper = Paper(
        title=data.title,
        description=data.description,
        source_type=data.source_type,
        source_paper_id=data.source_paper_id,
        root_knowledge_point_id=data.root_knowledge_point_id,
        is_reusable=data.is_reusable,
        created_by=user.id,
        owner_id=user.id,
    )
    db.add(paper)
    await db.flush()
    if data.question_items:
        await sync_paper_questions(db, paper, data.question_items)
    await db.flush()
    return (await get_paper_by_id(db, paper.id, user=user, is_admin=True)) or paper
```

Add these functions in the same file:

```python
async def update_paper(db: AsyncSession, paper: Paper, data: PaperUpdate) -> Paper:
    values = data.model_dump(exclude_unset=True, exclude={"question_items"})
    for field, value in values.items():
        setattr(paper, field, value)
    if data.question_items is not None:
        await sync_paper_questions(db, paper, data.question_items)
    await db.flush()
    return paper


async def archive_paper(db: AsyncSession, paper: Paper) -> Paper:
    paper.archived_at = datetime.now(timezone.utc)
    await db.flush()
    return paper


async def soft_delete_paper(db: AsyncSession, paper: Paper) -> None:
    paper.deleted_at = datetime.now(timezone.utc)
    await db.flush()
```

- [ ] **Step 5: Run focused backend tests**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/papers/schemas.py backend/src/app/papers/service.py backend/tests/test_papers.py
git commit -m "feat: add paper service layer"
```

### Task 3: Add Paper API Router

**Files:**
- Create: `backend/src/app/papers/router.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/test_papers.py`

- [ ] **Step 1: Add failing API tests**

Append:

```python
from app.auth.security import create_access_token


@pytest.mark.asyncio
async def test_paper_crud_api(client, db_session):
    teacher = await _teacher(db_session, "paper-api-teacher")
    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    create_response = await client.post(
        "/api/papers",
        json={"title": "API 试卷", "description": None, "question_items": []},
    )
    assert create_response.status_code == 201
    paper_id = create_response.json()["id"]
    assert create_response.json()["question_count"] == 0

    list_response = await client.get("/api/papers")
    assert list_response.status_code == 200
    assert list_response.headers["x-total-count"] == "1"
    assert [item["title"] for item in list_response.json()] == ["API 试卷"]

    detail_response = await client.get(f"/api/papers/{paper_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["title"] == "API 试卷"

    patch_response = await client.patch(f"/api/papers/{paper_id}", json={"title": "改名试卷"})
    assert patch_response.status_code == 200
    assert patch_response.json()["title"] == "改名试卷"

    archive_response = await client.post(f"/api/papers/{paper_id}/archive")
    assert archive_response.status_code == 200
    assert archive_response.json()["archived_at"] is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py::test_paper_crud_api -v
```

Expected: FAIL with 404 for `/api/papers`.

- [ ] **Step 3: Implement response builders**

In `backend/src/app/papers/router.py`, add helpers:

```python
from app.questions.schemas import QuestionResponse


def _paper_totals(paper: Paper) -> tuple[int, float]:
    items = paper.paper_questions or []
    total = sum(float(item.score_override if item.score_override is not None else item.question.score) for item in items if item.question)
    return len(items), total


def build_paper_response(paper: Paper) -> PaperResponse:
    question_count, total_score = _paper_totals(paper)
    return PaperResponse(
        id=paper.id,
        title=paper.title,
        description=paper.description,
        source_type=paper.source_type.value if hasattr(paper.source_type, "value") else paper.source_type,
        source_paper_id=paper.source_paper_id,
        root_knowledge_point_id=paper.root_knowledge_point_id,
        root_knowledge_point=paper.root_knowledge_point,
        is_reusable=paper.is_reusable,
        archived_at=paper.archived_at,
        question_count=question_count,
        total_score=total_score,
        owner_id=paper.owner_id,
        created_by=paper.created_by,
        created_by_name=paper.creator.full_name if paper.creator else "",
        created_at=paper.created_at,
        updated_at=paper.updated_at,
    )


def build_paper_detail_response(paper: Paper) -> PaperDetailResponse:
    base = build_paper_response(paper)
    questions = [
        PaperQuestionResponse(
            question_id=item.question_id,
            order=item.order,
            score_override=item.score_override,
            question=QuestionResponse.from_question(item.question) if item.question else None,
        )
        for item in sorted(paper.paper_questions, key=lambda item: item.order)
    ]
    return PaperDetailResponse(**base.model_dump(), questions=questions)
```

- [ ] **Step 4: Implement routes**

Routes must use these signatures:

```python
router = APIRouter()

@router.get("", response_model=list[PaperResponse])
async def list_papers(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[PaperResponse]:
    is_admin = await _is_paper_admin(db, user.id)
    papers, total = await list_papers_for_user(db, user=user, is_admin=is_admin)
    response.headers["X-Total-Count"] = str(total)
    return [build_paper_response(paper) for paper in papers]

@router.post("", response_model=PaperDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_paper_endpoint(
    body: PaperCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")],
) -> PaperDetailResponse:
    is_admin = await _is_paper_admin(db, user.id)
    paper = await create_paper(db, body, user=user, is_admin=is_admin)
    await db.commit()
    return build_paper_detail_response(paper)

@router.get("/{paper_id}", response_model=PaperDetailResponse)
async def get_paper_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PaperDetailResponse:
    paper = await _get_visible_paper_or_404(db, paper_id, user)
    return build_paper_detail_response(paper)

@router.patch("/{paper_id}", response_model=PaperDetailResponse)
async def update_paper_endpoint(
    paper_id: uuid.UUID,
    body: PaperUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")],
) -> PaperDetailResponse:
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    await update_paper(db, paper, body)
    await db.commit()
    refreshed = await _get_visible_paper_or_404(db, paper_id, user)
    return build_paper_detail_response(refreshed)

@router.post("/{paper_id}/archive", response_model=PaperResponse)
async def archive_paper_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")],
) -> PaperResponse:
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    await archive_paper(db, paper)
    await db.commit()
    return build_paper_response(paper)

@router.delete("/{paper_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_paper_endpoint(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")],
) -> None:
    paper = await _get_writable_paper_or_404(db, paper_id, user)
    await soft_delete_paper(db, paper)
    await db.commit()
```

Use `require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")` for mutating routes, and `_is_paper_admin()` checking `platform_admin`, `school_admin`, `admin`, `enterprise_admin`.

Add these route-local helpers:

```python
async def _is_paper_admin(db: AsyncSession, user_id: uuid.UUID) -> bool:
    return await user_has_role(db, user_id, "platform_admin", "school_admin", "admin", "enterprise_admin")


async def _get_visible_paper_or_404(db: AsyncSession, paper_id: uuid.UUID, user: User) -> Paper:
    paper = await get_paper_by_id(db, paper_id, user=user, is_admin=await _is_paper_admin(db, user.id))
    if paper is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    return paper


async def _get_writable_paper_or_404(db: AsyncSession, paper_id: uuid.UUID, user: User) -> Paper:
    paper = await _get_visible_paper_or_404(db, paper_id, user)
    if not can_write_owned_resource(
        is_platform_admin=await _is_paper_admin(db, user.id),
        current_user_id=user.id,
        owner_id=paper.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to modify this paper")
    return paper
```

- [ ] **Step 5: Include router**

In `backend/src/app/main.py`:

```python
from app.papers.router import router as papers_router
app.include_router(papers_router, prefix="/api/papers", tags=["papers"])
```

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/papers/router.py backend/src/app/main.py backend/tests/test_papers.py
git commit -m "feat: expose paper asset api"
```

### Task 4: Add Paper Import Session and Confirm Import

**Files:**
- Modify: `backend/src/app/papers/schemas.py`
- Modify: `backend/src/app/papers/service.py`
- Modify: `backend/src/app/papers/router.py`
- Test: `backend/tests/test_paper_import.py`

- [ ] **Step 1: Write failing import tests**

Create `backend/tests/test_paper_import.py`:

```python
import pytest

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role


async def _teacher(db_session):
    org = Organization(name="Import Org", type="school", is_active=True)
    role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, role])
    await db_session.flush()
    return await create_user(
        db_session,
        UserCreate(
            username="paper-import-teacher",
            email="paper-import-teacher@example.com",
            password="teacherpass123",
            full_name="Import Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )


@pytest.mark.asyncio
async def test_paper_import_recognize_and_confirm_creates_paper(client, db_session):
    teacher = await _teacher(db_session)
    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    recognize_response = await client.post(
        "/api/papers/import/recognize",
        json={
            "file_name": "history.md",
            "source_format": "md",
            "root_knowledge_point_id": None,
            "raw_text": "1. 单选题 MySQL 属于哪类数据库？\nA. 关系型\nB. 缓存\n答案：A",
            "images": [],
        },
    )
    assert recognize_response.status_code == 200
    recognized = recognize_response.json()
    assert recognized["session_id"]
    assert recognized["drafts"]

    draft = recognized["drafts"][0]
    draft["review_status"] = "approved"
    confirm_response = await client.post(
        f"/api/papers/import/sessions/{recognized['session_id']}/confirm",
        json={
            "title": "导入历史试卷",
            "description": None,
            "root_knowledge_point_id": None,
            "drafts": [draft],
        },
    )
    assert confirm_response.status_code == 201
    payload = confirm_response.json()
    assert payload["title"] == "导入历史试卷"
    assert payload["source_type"] == "import"
    assert payload["question_count"] == 1

    session_response = await client.get(f"/api/papers/import/sessions/{recognized['session_id']}")
    assert session_response.status_code == 200
    assert session_response.json()["created_paper_id"] == payload["id"]
    assert session_response.json()["error_detail"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_paper_import.py -v
```

Expected: FAIL with 404 for import routes.

- [ ] **Step 3: Add import schemas**

In `backend/src/app/papers/schemas.py`, add:

```python
from app.questions.schemas import QuestionImportDraft, QuestionImportImageInput, QuestionImportDocumentSummary


class PaperImportRecognizeRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    raw_text: str = Field(min_length=1, max_length=200000)
    source_format: str = Field(pattern="^(pdf|docx|md)$")
    root_knowledge_point_id: uuid.UUID | None = None
    images: list[QuestionImportImageInput] = Field(default_factory=list, max_length=200)


class PaperImportRecognizeResponse(BaseModel):
    session_id: uuid.UUID
    mode: str
    summary: QuestionImportDocumentSummary
    drafts: list[QuestionImportDraft]


class PaperImportSessionResponse(BaseModel):
    id: uuid.UUID
    file_name: str
    source_format: str
    root_knowledge_point_id: uuid.UUID | None
    error_detail: str | None
    preview_payload: dict
    created_paper_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PaperImportConfirmRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    root_knowledge_point_id: uuid.UUID | None = None
    drafts: list[QuestionImportDraft] = Field(min_length=1, max_length=500)
```

- [ ] **Step 4: Add import service helpers**

In `backend/src/app/papers/service.py`:

```python
from app.papers.models import PaperImportSession
from app.questions.schemas import QuestionImportDocumentRecognizeRequest, QuestionCreate
from app.questions.service import bulk_create_questions_fast, recognize_question_document


def question_create_from_import_draft(draft: QuestionImportDraft, root_knowledge_point_id: uuid.UUID | None) -> QuestionCreate:
    answer_text = draft.answer_text or ""
    if draft.type.value == "choice":
        answer = {"correct": answer_text}
    elif draft.type.value == "true_false":
        answer = {"correct": answer_text.strip().lower() in {"正确", "对", "true", "t", "√"}}
    elif draft.type.value == "fill_in":
        answer = {"correct": [part.strip() for part in re.split(r"[;,；\n]", answer_text) if part.strip()]}
    elif draft.type.value == "code":
        answer = {"code": answer_text}
    else:
        answer = {"points": [part.strip() for part in answer_text.splitlines() if part.strip()]}
    return QuestionCreate(
        type=draft.type,
        title=(draft.title or draft.content_text[:120] or "未命名题目")[:500],
        content={"text": draft.content_text},
        options=draft.options if draft.type.value == "choice" else None,
        answer=answer,
        analysis=draft.analysis,
        difficulty=draft.difficulty,
        score=10,
        knowledge_point_ids=[root_knowledge_point_id] if root_knowledge_point_id else [],
        tag_ids=[],
        question_bank_id=None,
    )
```

Implement these functions:

```python
async def create_import_session_from_recognition(
    db: AsyncSession,
    *,
    user: User,
    request: PaperImportRecognizeRequest,
) -> tuple[PaperImportSession, QuestionImportDocumentRecognizeResponse]:
    recognition = await recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name=request.file_name,
            raw_text=request.raw_text,
            source_format=request.source_format,
            images=request.images,
        )
    )
    session = PaperImportSession(
        file_name=request.file_name,
        source_format=request.source_format,
        root_knowledge_point_id=request.root_knowledge_point_id,
        preview_payload=recognition.model_dump(mode="json"),
        error_detail=None,
        created_by=user.id,
    )
    db.add(session)
    await db.flush()
    return session, recognition


async def get_import_session(db: AsyncSession, session_id: uuid.UUID, *, user: User, is_admin: bool) -> PaperImportSession | None:
    stmt = select(PaperImportSession).where(PaperImportSession.id == session_id, PaperImportSession.deleted_at.is_(None))
    if not is_admin:
        stmt = stmt.where(PaperImportSession.created_by == user.id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def confirm_import_session(
    db: AsyncSession,
    session: PaperImportSession,
    body: PaperImportConfirmRequest,
    *,
    user: User,
) -> Paper:
    root_id = body.root_knowledge_point_id or session.root_knowledge_point_id
    questions = [
        question_create_from_import_draft(draft, root_id)
        for draft in body.drafts
        if draft.review_status.value == "approved" and not _blocking_import_issues(draft)
    ]
    if not questions:
        session.error_detail = "没有可入库的题目"
        raise ValueError("没有可入库的题目")
    try:
        result = await bulk_create_questions_fast(db, questions, user.id)
        paper = await create_paper(
            db,
            PaperCreate(
                title=body.title,
                description=body.description,
                source_type="import",
                root_knowledge_point_id=root_id,
                question_items=[
                    PaperQuestionItem(question_id=question_id, order=index, score_override=questions[index].score)
                    for index, question_id in enumerate(result.created_question_ids)
                ],
            ),
            user=user,
            is_admin=False,
        )
        session.created_paper_id = paper.id
        session.error_detail = None
        await db.flush()
        return paper
    except Exception as exc:
        session.error_detail = str(exc)
        await db.flush()
        raise
```

Add `_blocking_import_issues()` beside the conversion helper:

```python
def _blocking_import_issues(draft: QuestionImportDraft) -> list[str]:
    return [issue for issue in draft.issues if not re.search(r"未识别到答案|缺少答案|缺答案", issue)]
```

`confirm_import_session()` behavior checklist:

1. Load session by ID and current user.
2. Convert approved drafts without blocking issues to `QuestionCreate`.
3. Call `bulk_create_questions_fast`.
4. Create `Paper(source_type="import")`.
5. Create `PaperQuestion` rows for created question IDs in order.
6. Set `session.created_paper_id`.
7. Clear `session.error_detail`.
8. On exception, set `session.error_detail` and re-raise.

- [ ] **Step 5: Add import routes**

In `backend/src/app/papers/router.py`:

```python
@router.post("/import/recognize", response_model=PaperImportRecognizeResponse)
async def recognize_paper_import(
    body: PaperImportRecognizeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")],
) -> PaperImportRecognizeResponse:
    session, recognition = await create_import_session_from_recognition(db, user=user, request=body)
    await db.commit()
    return PaperImportRecognizeResponse(
        session_id=session.id,
        mode=recognition.mode,
        summary=recognition.summary,
        drafts=recognition.drafts,
    )

@router.get("/import/sessions/{session_id}", response_model=PaperImportSessionResponse)
async def get_import_session_endpoint(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PaperImportSessionResponse:
    session = await get_import_session(db, session_id, user=user, is_admin=await _is_paper_admin(db, user.id))
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper import session not found")
    return PaperImportSessionResponse.model_validate(session)

@router.post("/import/sessions/{session_id}/confirm", response_model=PaperDetailResponse, status_code=status.HTTP_201_CREATED)
async def confirm_import_session_endpoint(
    session_id: uuid.UUID,
    body: PaperImportConfirmRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")],
) -> PaperDetailResponse:
    session = await get_import_session(db, session_id, user=user, is_admin=await _is_paper_admin(db, user.id))
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper import session not found")
    try:
        paper = await confirm_import_session(db, session, body, user=user)
    except ValueError as exc:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return build_paper_detail_response(paper)
```

- [ ] **Step 6: Run import tests**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_paper_import.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/papers/schemas.py backend/src/app/papers/service.py backend/src/app/papers/router.py backend/tests/test_paper_import.py
git commit -m "feat: import reviewed documents as papers"
```

### Task 5: Add Frontend Paper Types, Routes, and Navigation

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout.tsx`
- Create: `frontend/src/pages/papers/api.ts`
- Create: `frontend/src/pages/papers/paper-utils.test.ts`

- [ ] **Step 1: Add failing utility test**

Create `frontend/src/pages/papers/paper-utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getPaperSourceLabel } from "./api";

describe("paper utilities", () => {
  it("labels paper sources", () => {
    expect(getPaperSourceLabel("manual")).toBe("手工");
    expect(getPaperSourceLabel("import")).toBe("导入");
    expect(getPaperSourceLabel("ai_generated")).toBe("AI 生成");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && pnpm test src/pages/papers/paper-utils.test.ts --run
```

Expected: FAIL because `./api` does not exist.

- [ ] **Step 3: Add types**

In `frontend/src/types/index.ts`, add:

```ts
export type PaperSourceType = "manual" | "import" | "ai_generated";

export interface IPaperQuestion {
  question_id: string;
  order: number;
  score_override: number | null;
  question: IQuestion | null;
}

export interface IPaper {
  id: string;
  title: string;
  description: string | null;
  source_type: PaperSourceType;
  source_paper_id: string | null;
  root_knowledge_point_id: string | null;
  root_knowledge_point: IKnowledgePoint | null;
  is_reusable: boolean;
  archived_at: string | null;
  question_count: number;
  total_score: number;
  owner_id: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  questions?: IPaperQuestion[];
}
```

- [ ] **Step 4: Add paper API helpers**

Create `frontend/src/pages/papers/api.ts`:

```ts
import { apiClient } from "@/lib/api";
import type { IPaper, PaperSourceType } from "@/types";
import type { QuestionImportDraft, QuestionImportDocumentSummary } from "@/pages/questions/import-types";

export function getPaperSourceLabel(source: PaperSourceType): string {
  return {
    manual: "手工",
    import: "导入",
    ai_generated: "AI 生成",
  }[source];
}

export interface PaperImportRecognizeResponse {
  session_id: string;
  mode: "template" | "smart";
  summary: QuestionImportDocumentSummary;
  drafts: QuestionImportDraft[];
}

export async function confirmPaperImport(sessionId: string, payload: {
  title: string;
  description: string | null;
  root_knowledge_point_id: string | null;
  drafts: QuestionImportDraft[];
}): Promise<IPaper> {
  const response = await apiClient.post<IPaper>(`/api/papers/import/sessions/${sessionId}/confirm`, payload);
  return response.data;
}
```

- [ ] **Step 5: Add lazy route stubs**

In `frontend/src/App.tsx`, add lazy imports:

```tsx
const PaperList = lazyNamed(() => import("./pages/papers/list"), "PaperList");
const PaperDetail = lazyNamed(() => import("./pages/papers/detail"), "PaperDetail");
const PaperImportPage = lazyNamed(() => import("./pages/papers/import"), "PaperImportPage");
```

Add Refine resource:

```tsx
{ name: "papers", list: "/papers", meta: { label: "试卷列表" } }
```

Add routes under teacher layout:

```tsx
<Route path="/papers">
  <Route index element={<PaperList />} />
  <Route path="import" element={<PaperImportPage />} />
  <Route path=":id" element={<PaperDetail />} />
</Route>
```

- [ ] **Step 6: Add navigation entries**

In `frontend/src/components/layout.tsx`, under 考试管理 dropdown, add:

```tsx
<NavItem href="/papers" title="试卷列表" icon={<FileText size={14} />} onNavigate={() => setExamMenuOpen(false)}>
  管理手工、导入和 AI 生成的可复用试卷
</NavItem>
<NavItem href="/papers/import" title="导入试卷" icon={<Upload size={14} />} onNavigate={() => setExamMenuOpen(false)}>
  从历史试卷文件识别题目并入库
</NavItem>
```

Update active check:

```ts
isActive("/exams") || isActive("/papers")
```

- [ ] **Step 7: Run frontend test**

Run:

```bash
cd frontend && pnpm test src/pages/papers/paper-utils.test.ts --run
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/App.tsx frontend/src/components/layout.tsx frontend/src/pages/papers/api.ts frontend/src/pages/papers/paper-utils.test.ts
git commit -m "feat: add paper frontend routes"
```

### Task 6: Build Paper List and Detail Pages

**Files:**
- Create: `frontend/src/pages/papers/list.tsx`
- Create: `frontend/src/pages/papers/detail.tsx`
- Modify: `frontend/src/pages/exams/components/PaperPreview.tsx`
- Test: `frontend/src/pages/papers/paper-utils.test.ts`

- [ ] **Step 1: Add utility test for preview item mapping**

Append:

```ts
import { buildPaperPreviewItemsFromPaper } from "./api";

it("maps paper questions to ordered preview items", () => {
  const items = buildPaperPreviewItemsFromPaper({
    questions: [
      { order: 1, score_override: 5, question_id: "q2", question: { id: "q2", title: "B", type: "choice" } as never },
      { order: 0, score_override: 10, question_id: "q1", question: { id: "q1", title: "A", type: "choice" } as never },
    ],
  } as never);
  expect(items.map((item) => item.question.id)).toEqual(["q1", "q2"]);
});
```

- [ ] **Step 2: Implement utility**

In `frontend/src/pages/papers/api.ts`, add:

```ts
export function buildPaperPreviewItemsFromPaper(paper: IPaper) {
  return (paper.questions ?? [])
    .filter((item) => item.question)
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((item) => ({
      question: item.question!,
      order: item.order,
      scoreOverride: item.score_override,
    }));
}
```

- [ ] **Step 3: Make `PaperPreview` read-only capable**

In `frontend/src/pages/exams/components/PaperPreview.tsx`, make these props optional:

```ts
scoreMode?: ScoreViewMode;
onScoreModeChange?: (mode: ScoreViewMode) => void;
questionTypeSummaries?: QuestionTypeSummary[];
typeScoreDrafts?: Partial<Record<QuestionType, string>>;
onTypeScoreChange?: (summary: QuestionTypeSummary, value: string) => void;
onQuestionScoreChange?: (questionId: string, value: string) => void;
readOnly?: boolean;
```

When `readOnly` is true, hide score inputs and the mode toggle button.

- [ ] **Step 4: Build list page**

`frontend/src/pages/papers/list.tsx` should use `useList<IPaper>({ resource: "papers" })`, show filters for source and search, and render actions:

```tsx
<Button onClick={() => navigate("/papers/import")}>导入试卷</Button>
<Button variant="ghost" onClick={() => navigate(`/papers/${paper.id}`)}>查看</Button>
```

For V1, do not show `新建试卷` until a real create page or dialog is implemented.

- [ ] **Step 5: Build detail page**

`frontend/src/pages/papers/detail.tsx` should:

- Load `useOne<IPaper>({ resource: "papers", id })`.
- Render title/source/root knowledge point/count/score.
- Render read-only `PaperPreview`.
- Include implemented actions: `创建考试`, `发布练习`, `归档`.
- Add `AI 生成新试卷` in Task 10 after the dialog exists.
- Omit `复制` until a copy endpoint and UI are implemented.

Do not render inert action buttons. Every visible action should either work or be hidden.

- [ ] **Step 6: Run test and type-check**

Run:

```bash
cd frontend && pnpm test src/pages/papers/paper-utils.test.ts --run
cd frontend && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/papers/list.tsx frontend/src/pages/papers/detail.tsx frontend/src/pages/papers/api.ts frontend/src/pages/exams/components/PaperPreview.tsx frontend/src/pages/papers/paper-utils.test.ts
git commit -m "feat: add paper list and detail pages"
```

### Task 7: Build Paper Import Wizard

**Files:**
- Create: `frontend/src/pages/papers/import.tsx`
- Modify: `frontend/src/pages/papers/api.ts`
- Reuse: `frontend/src/pages/questions/import-utils.ts`
- Reuse: `frontend/src/pages/questions/components/import-review-workspace.tsx`
- Test: `frontend/src/pages/papers/paper-utils.test.ts`

- [ ] **Step 1: Add helper test for confirm payload filtering**

Append:

```ts
import { getConfirmablePaperImportDrafts } from "./api";

it("keeps approved non-blocking drafts for paper import", () => {
  const drafts = [
    { draft_id: "a", review_status: "approved", issues: [], answer_text: "A" },
    { draft_id: "b", review_status: "pending", issues: [], answer_text: "B" },
    { draft_id: "c", review_status: "approved", issues: ["未识别到答案"], answer_text: null },
    { draft_id: "d", review_status: "approved", issues: ["题干为空"], answer_text: "D" },
  ] as never;
  expect(getConfirmablePaperImportDrafts(drafts).map((draft) => draft.draft_id)).toEqual(["a", "c"]);
});
```

- [ ] **Step 2: Add helper**

In `frontend/src/pages/papers/api.ts`:

```ts
import { getBlockingImportIssues } from "@/pages/questions/import-utils";

export function getConfirmablePaperImportDrafts(drafts: QuestionImportDraft[]) {
  return drafts.filter((draft) => draft.review_status === "approved" && getBlockingImportIssues(draft).length === 0);
}

export async function recognizePaperImport(payload: {
  file_name: string;
  raw_text: string;
  source_format: "pdf" | "docx" | "md";
  root_knowledge_point_id: string | null;
  images: Array<{ image_id: string; url: string; order: number; page?: number; alt?: string | null }>;
}): Promise<PaperImportRecognizeResponse> {
  const response = await apiClient.post<PaperImportRecognizeResponse>("/api/papers/import/recognize", payload);
  return response.data;
}
```

- [ ] **Step 3: Build wizard page**

`frontend/src/pages/papers/import.tsx` should:

1. Let user upload `pdf/docx/md`.
2. Require a paper title.
3. Require or allow selecting `root_knowledge_point_id` based on available knowledge data. If no knowledge points exist, allow null and show a non-blocking message.
4. Use `extractQuestionImportPayload(file)`.
5. Call `recognizePaperImport`.
6. Render existing review workspace with `drafts`.
7. Confirm via `confirmPaperImport`.
8. Navigate to `/papers/${paper.id}`.

- [ ] **Step 4: Keep UI first-screen usable**

Do not make a marketing page. The first screen should be the import tool: file picker, paper title, root knowledge point selector, and parse button.

- [ ] **Step 5: Run tests and type-check**

Run:

```bash
cd frontend && pnpm test src/pages/papers/paper-utils.test.ts --run
cd frontend && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/papers/import.tsx frontend/src/pages/papers/api.ts frontend/src/pages/papers/paper-utils.test.ts
git commit -m "feat: add paper import wizard"
```

### Task 8: Seed Exam and Practice Creation from Paper

**Files:**
- Modify: `backend/src/app/papers/schemas.py`
- Modify: `backend/src/app/papers/service.py`
- Modify: `backend/src/app/papers/router.py`
- Modify: `frontend/src/pages/papers/detail.tsx`
- Modify: `frontend/src/pages/exams/create.tsx`
- Modify: `frontend/src/pages/exams/practice-create.tsx`
- Test: `backend/tests/test_papers.py`

- [ ] **Step 1: Add failing backend seed test**

Append:

```python
@pytest.mark.asyncio
async def test_get_paper_exam_seed_returns_question_items(client, db_session):
    teacher = await _teacher(db_session, "paper-seed-teacher")
    question = Question(
        type=QuestionType.CHOICE,
        title="种子题",
        content={"text": "种子题"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    paper = Paper(title="种子试卷", source_type=PaperSourceType.MANUAL, created_by=teacher.id, owner_id=teacher.id)
    db_session.add_all([question, paper])
    await db_session.flush()
    db_session.add(PaperQuestion(paper_id=paper.id, question_id=question.id, order=0, score_override=6))
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get(f"/api/papers/{paper.id}/exam-seed")
    assert response.status_code == 200
    assert response.json()["title"] == "种子试卷"
    assert response.json()["question_items"] == [
        {"question_id": str(question.id), "order": 0, "score_override": 6.0}
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py::test_get_paper_exam_seed_returns_question_items -v
```

Expected: FAIL with 404.

- [ ] **Step 3: Add seed schema and endpoint**

In `schemas.py`:

```python
class PaperExamSeedResponse(BaseModel):
    paper_id: uuid.UUID
    title: str
    description: str | None
    total_score: float
    question_items: list[PaperQuestionItem]
```

In router:

```python
@router.get("/{paper_id}/exam-seed", response_model=PaperExamSeedResponse)
async def get_paper_exam_seed(
    paper_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> PaperExamSeedResponse:
    paper = await _get_visible_paper_or_404(db, paper_id, user)
    question_items = [
        PaperQuestionItem(
            question_id=item.question_id,
            order=item.order,
            score_override=item.score_override if item.score_override is not None else item.question.score,
        )
        for item in sorted(paper.paper_questions, key=lambda item: item.order)
        if item.question is not None
    ]
    return PaperExamSeedResponse(
        paper_id=paper.id,
        title=paper.title,
        description=paper.description,
        total_score=sum(float(item.score_override or 0) for item in question_items),
        question_items=question_items,
    )
```

- [ ] **Step 4: Wire frontend detail actions**

In `frontend/src/pages/papers/detail.tsx`:

```tsx
<Button onClick={() => navigate(`/exams/create?paper_id=${paper.id}`)}>创建考试</Button>
<Button variant="outline" onClick={() => navigate(`/exams/practice/create?paper_id=${paper.id}`)}>发布练习</Button>
```

- [ ] **Step 5: Hydrate exam create from `paper_id`**

In `frontend/src/pages/exams/create.tsx`, read `paper_id` from `useSearchParams()`. If present:

1. Fetch `/api/papers/{paper_id}/exam-seed` with `apiClient`.
2. Set initial values:
   - `title`: seed title
   - `description`: seed description or empty
   - `total_score`: seed total score or 100
   - `question_mode`: `"manual"`
   - `question_ids`: seed question IDs
   - `question_items`: seed items

Do not auto-publish.

- [ ] **Step 6: Hydrate practice create from `paper_id`**

In `frontend/src/pages/exams/practice-create.tsx`, read `paper_id` from `useSearchParams()`. If present:

1. Fetch `/api/papers/{paper_id}/exam-seed` with `apiClient`.
2. Use seeded `title`, `description`, `total_score`, `question_ids`, and `question_items`.
3. Keep practice-specific defaults for `category`, publication mode, and student selection.
4. Do not auto-publish.

- [ ] **Step 7: Run backend and frontend checks**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py::test_get_paper_exam_seed_returns_question_items -v
cd frontend && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/app/papers/schemas.py backend/src/app/papers/router.py backend/tests/test_papers.py frontend/src/pages/papers/detail.tsx frontend/src/pages/exams/create.tsx frontend/src/pages/exams/practice-create.tsx
git commit -m "feat: seed exams from reusable papers"
```

---

## Phase 2: AI-Derived Papers

### Task 9: Add Paper Profile and AI Generation Service

**Files:**
- Modify: `backend/src/app/papers/schemas.py`
- Modify: `backend/src/app/papers/service.py`
- Modify: `backend/src/app/papers/router.py`
- Test: `backend/tests/test_paper_ai_generate.py`

- [ ] **Step 1: Write profile unit tests**

Create `backend/tests/test_paper_ai_generate.py`:

```python
from app.papers.service import build_paper_generation_profile


def test_build_paper_generation_profile_inherits_type_distribution():
    source = [
        {"type": "choice", "difficulty": 2, "knowledge_point_ids": ["kp1"]},
        {"type": "choice", "difficulty": 4, "knowledge_point_ids": ["kp1"]},
        {"type": "short_answer", "difficulty": 3, "knowledge_point_ids": ["kp2"]},
    ]
    profile = build_paper_generation_profile(source, root_knowledge_point_id="kp-root", difficulty_strategy="similar")
    assert profile.total_count == 3
    assert profile.type_distribution == {"choice": 2, "short_answer": 1}
    assert profile.difficulty == 3
    assert profile.knowledge_point_ids == ["kp-root"]
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_paper_ai_generate.py -v
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Add schemas**

In `backend/src/app/papers/schemas.py`:

```python
class PaperAIGenerateRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=1)
    difficulty_strategy: Literal["similar", "easier", "harder"] = "similar"
    question_type_strategy: Literal["inherit"] = "inherit"
    prefer_root_knowledge_point: bool = True
    model: str = "deepseek"


class PaperAIGenerateResponse(BaseModel):
    paper_id: uuid.UUID
    generated_question_count: int
```

- [ ] **Step 4: Implement profile helper**

In `backend/src/app/papers/service.py`:

```python
from dataclasses import dataclass
from collections import Counter


@dataclass
class PaperGenerationProfile:
    total_count: int
    type_distribution: dict[str, int]
    difficulty: int
    knowledge_point_ids: list[uuid.UUID | str]
    prompt: str


def build_paper_generation_profile(source_questions: list[dict], root_knowledge_point_id, difficulty_strategy: str) -> PaperGenerationProfile:
    distribution = Counter(str(item["type"]) for item in source_questions)
    difficulties = [int(item.get("difficulty") or 3) for item in source_questions]
    average = round(sum(difficulties) / len(difficulties)) if difficulties else 3
    if difficulty_strategy == "easier":
        average -= 1
    elif difficulty_strategy == "harder":
        average += 1
    difficulty = min(5, max(1, average))
    return PaperGenerationProfile(
        total_count=len(source_questions),
        type_distribution=dict(distribution),
        difficulty=difficulty,
        knowledge_point_ids=[root_knowledge_point_id] if root_knowledge_point_id else [],
        prompt="请参考源试卷的题型结构、难度和考查范围，生成一份内容不同但能力要求接近的新试卷。",
    )
```

- [ ] **Step 5: Implement generation service**

Add `generate_paper_from_source()` with this signature:

```python
async def generate_paper_from_source(
    db: AsyncSession,
    source: Paper,
    body: PaperAIGenerateRequest,
    *,
    user: User,
) -> Paper:
    source_questions = [
        {
            "type": item.question.type.value,
            "difficulty": item.question.difficulty,
            "knowledge_point_ids": [kp.id for kp in item.question.knowledge_points],
        }
        for item in sorted(source.paper_questions, key=lambda item: item.order)
        if item.question is not None
    ]
    profile = build_paper_generation_profile(
        source_questions,
        source.root_knowledge_point_id if body.prefer_root_knowledge_point else None,
        body.difficulty_strategy,
    )
    request = AIGenerateRequest(
        total_count=profile.total_count,
        difficulty=profile.difficulty,
        type_distribution=profile.type_distribution,
        knowledge_point_ids=profile.knowledge_point_ids,
        prompt=profile.prompt,
        model=body.model,
    )
    generated: list[QuestionCreate] = []
    async for event in generate_questions_stream(db, request, user.id):
        if event.get("type") != "question":
            continue
        data = event["data"]
        generated.append(
            QuestionCreate(
                type=data["type"],
                title=data["title"],
                content=data["content"],
                options=data.get("options"),
                answer=data["answer"],
                analysis=data.get("analysis"),
                difficulty=data.get("difficulty") or profile.difficulty,
                score=10,
                knowledge_point_ids=profile.knowledge_point_ids,
            )
        )
    if len(generated) != profile.total_count:
        raise ValueError("AI 生成题目数量不足")
    result = await bulk_create_questions_fast(db, generated, user.id)
    return await create_paper(
        db,
        PaperCreate(
            title=f"{source.title} - AI 生成",
            description=source.description,
            source_type="ai_generated",
            source_paper_id=source.id,
            root_knowledge_point_id=source.root_knowledge_point_id,
            question_items=[
                PaperQuestionItem(question_id=question_id, order=index, score_override=generated[index].score)
                for index, question_id in enumerate(result.created_question_ids)
            ],
        ),
        user=user,
        is_admin=False,
    )
```

Behavior checklist:

1. Load source `Paper`.
2. Build profile from source questions.
3. Construct `AIGenerateRequest`.
4. Iterate `generate_questions_stream(db, request, user.id)`.
5. Collect `question` events.
6. Convert event data to `QuestionCreate`.
7. `bulk_create_questions_fast`.
8. Create new `Paper(source_type="ai_generated", source_paper_id=source.id)`.
9. Attach created questions.

- [ ] **Step 6: Add route**

In `router.py`:

```python
@router.post("/{paper_id}/ai-generate", response_model=PaperAIGenerateResponse)
async def ai_generate_paper_endpoint(
    paper_id: uuid.UUID,
    body: PaperAIGenerateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, require_roles("admin", "platform_admin", "school_admin", "teacher", "evaluator")],
) -> PaperAIGenerateResponse:
    source = await _get_visible_paper_or_404(db, paper_id, user)
    try:
        paper = await generate_paper_from_source(db, source, body, user=user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return PaperAIGenerateResponse(paper_id=paper.id, generated_question_count=len(paper.paper_questions))
```

- [ ] **Step 7: Run unit test**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_paper_ai_generate.py -v
```

Expected: PASS for profile tests. Do not call external AI services from tests; use profile and conversion tests only in this task.

- [ ] **Step 8: Commit**

```bash
git add backend/src/app/papers/schemas.py backend/src/app/papers/service.py backend/src/app/papers/router.py backend/tests/test_paper_ai_generate.py
git commit -m "feat: generate papers from source paper profiles"
```

### Task 10: Add Frontend AI Generate Dialog

**Files:**
- Create: `frontend/src/pages/papers/ai-generate-dialog.tsx`
- Modify: `frontend/src/pages/papers/api.ts`
- Modify: `frontend/src/pages/papers/detail.tsx`
- Modify: `frontend/src/pages/papers/list.tsx`
- Test: `frontend/src/pages/papers/paper-utils.test.ts`

- [ ] **Step 1: Add helper test**

Append:

```ts
import { getDifficultyStrategyLabel } from "./api";

it("labels paper AI difficulty strategies", () => {
  expect(getDifficultyStrategyLabel("similar")).toBe("接近原卷");
  expect(getDifficultyStrategyLabel("easier")).toBe("略降");
  expect(getDifficultyStrategyLabel("harder")).toBe("略升");
});
```

- [ ] **Step 2: Add API helper**

In `api.ts`:

```ts
export type PaperDifficultyStrategy = "similar" | "easier" | "harder";

export function getDifficultyStrategyLabel(strategy: PaperDifficultyStrategy): string {
  return {
    similar: "接近原卷",
    easier: "略降",
    harder: "略升",
  }[strategy];
}

export async function generatePaperFromSource(paperId: string, payload: {
  count: 1;
  difficulty_strategy: PaperDifficultyStrategy;
  question_type_strategy: "inherit";
  prefer_root_knowledge_point: boolean;
}) {
  const response = await apiClient.post<{ paper_id: string; generated_question_count: number }>(
    `/api/papers/${paperId}/ai-generate`,
    payload,
  );
  return response.data;
}
```

- [ ] **Step 3: Build dialog**

Create `ai-generate-dialog.tsx` with:

- Trigger controlled by parent.
- Segmented difficulty choice.
- Toggle for `prefer_root_knowledge_point`.
- Disabled “题型配比：继承原卷” display.
- Confirm button calls `generatePaperFromSource`.
- On success navigates to `/papers/${result.paper_id}`.

- [ ] **Step 4: Wire detail and list actions**

In both list and detail, make `AI 生成新试卷` open the dialog for the selected paper.

- [ ] **Step 5: Run checks**

Run:

```bash
cd frontend && pnpm test src/pages/papers/paper-utils.test.ts --run
cd frontend && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/papers/ai-generate-dialog.tsx frontend/src/pages/papers/api.ts frontend/src/pages/papers/detail.tsx frontend/src/pages/papers/list.tsx frontend/src/pages/papers/paper-utils.test.ts
git commit -m "feat: add paper ai generation dialog"
```

---

## Final Verification

- [ ] **Backend tests**

Run:

```bash
cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_papers.py tests/test_paper_import.py tests/test_paper_ai_generate.py -v
```

Expected: PASS.

- [ ] **Alembic sanity**

Run:

```bash
cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run alembic heads
cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run alembic upgrade head
```

Expected: single head and upgrade succeeds.

- [ ] **Frontend checks**

Run:

```bash
cd frontend && pnpm test src/pages/papers/paper-utils.test.ts --run
cd frontend && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Manual smoke**

Start the app with the existing project workflow, then verify:

1. `考试管理 -> 试卷列表` opens.
2. `导入试卷` can parse a small markdown paper.
3. Confirm import creates a `Paper`.
4. Paper detail shows questions in order.
5. `创建考试` opens exam creation with seeded questions.
6. `AI 生成新试卷` creates a derived paper when AI credentials are configured.

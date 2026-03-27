# Knowledge Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visual knowledge tree management module (专业→方向→知识点) with ReactFlow horizontal tree, prerequisite dashed edges, and right-click context menu.

**Architecture:** Extend existing `knowledge_points` table with new `major`/`direction` tables via Alembic migration. Move `KnowledgePoint` model to a new `learning` module. Backend returns pre-computed ReactFlow-compatible `{nodes, edges}` from `/api/knowledge`. Frontend page at `/knowledge` uses `@xyflow/react` with custom node cards and a custom prerequisite edge type.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, pytest, React 19, TypeScript, @xyflow/react, Radix UI, UnoCSS

**Spec:** `docs/superpowers/specs/2026-03-17-knowledge-management-design.md`

---

## File Map

### Backend — New Files
| File | Responsibility |
|------|----------------|
| `backend/src/app/learning/__init__.py` | Package marker |
| `backend/src/app/learning/models.py` | Major, Direction, KnowledgePoint (moved), KnowledgePointPrerequisite |
| `backend/src/app/learning/schemas.py` | Pydantic request/response models |
| `backend/src/app/learning/service.py` | Tree build, CRUD, cycle detection |
| `backend/src/app/learning/router.py` | FastAPI routes under `/api/knowledge` |
| `backend/alembic/versions/<hash>_add_knowledge_management.py` | DB migration |

### Backend — Modified Files
| File | Change |
|------|--------|
| `backend/src/app/questions/models.py` | Replace `KnowledgePoint` class with re-export alias |
| `backend/src/app/main.py` | Register learning router |

### Frontend — New Files
| File | Responsibility |
|------|----------------|
| `frontend/src/pages/knowledge/types.ts` | IKnowledgePointDetail, IDirection, IMajor, IFlowData |
| `frontend/src/pages/knowledge/MajorDirectionSidebar.tsx` | Left panel: collapsible major/direction list |
| `frontend/src/pages/knowledge/KnowledgeNode.tsx` | ReactFlow custom node card |
| `frontend/src/pages/knowledge/PrerequisiteEdge.tsx` | ReactFlow custom edge (red dashed) |
| `frontend/src/pages/knowledge/NodeContextMenu.tsx` | Portal right-click menu |
| `frontend/src/pages/knowledge/NodeDetailPanel.tsx` | Slide-in create/edit form |
| `frontend/src/pages/knowledge/PrerequisiteSelectModal.tsx` | Modal for choosing prerequisite from same-direction nodes |
| `frontend/src/pages/knowledge/KnowledgeTreeCanvas.tsx` | ReactFlow canvas, composes above |
| `frontend/src/pages/knowledge/index.tsx` | Page entry, top-level state |

### Frontend — Modified Files
| File | Change |
|------|--------|
| `frontend/src/types/index.ts` | Extend `IKnowledgePoint` with new fields |
| `frontend/src/App.tsx` | Add `/knowledge` route + `"knowledge"` Refine resource |
| `frontend/src/providers/access-control.ts` | Add `"knowledge"` to `teacherResources` |
| `frontend/src/components/layout.tsx` | Rename existing nav item; add new nav entry |
| `frontend/package.json` | Add `@xyflow/react` |

---

## Task 1: Database Migration

**Files:**
- Create: `backend/alembic/versions/<hash>_add_knowledge_management.py`

- [ ] **Step 1: Generate migration skeleton**

```bash
cd backend
uv run alembic revision --rev-id add_knowledge_management -m "add_knowledge_management"
```

- [ ] **Step 2: Fill in upgrade() and downgrade()**

Open the generated file and replace its body with:

```python
"""add_knowledge_management

Revision ID: add_knowledge_management
Revises: 3074655518ba
Create Date: 2026-03-17

"""
from typing import Sequence, Union
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = 'add_knowledge_management'
down_revision: Union[str, None] = '3074655518ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'major',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'direction',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('major_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['major_id'], ['major.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.add_column('knowledge_points', sa.Column('direction_id', sa.Uuid(), nullable=True))
    op.add_column('knowledge_points', sa.Column('tags', postgresql.JSONB(), server_default='[]', nullable=True))
    op.add_column('knowledge_points', sa.Column('difficulty', sa.String(10), nullable=True))
    op.create_foreign_key(
        'fk_kp_direction', 'knowledge_points', 'direction', ['direction_id'], ['id'], ondelete='SET NULL'
    )
    op.create_check_constraint(
        'ck_kp_difficulty', 'knowledge_points',
        "difficulty IN ('入门','初级','中级','高级','困难')"
    )
    op.create_table(
        'knowledge_point_prerequisite',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('from_id', sa.Uuid(), nullable=False),
        sa.Column('to_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['from_id'], ['knowledge_points.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['to_id'], ['knowledge_points.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('from_id', 'to_id'),
    )


def downgrade() -> None:
    op.drop_table('knowledge_point_prerequisite')
    op.drop_constraint('ck_kp_difficulty', 'knowledge_points', type_='check')
    op.drop_constraint('fk_kp_direction', 'knowledge_points', type_='foreignkey')
    op.drop_column('knowledge_points', 'difficulty')
    op.drop_column('knowledge_points', 'tags')
    op.drop_column('knowledge_points', 'direction_id')
    op.drop_table('direction')
    op.drop_table('major')
```

- [ ] **Step 3: Run migration**

```bash
cd backend
uv run alembic upgrade head
```

Expected: no errors, ends with `Running upgrade 3074655518ba -> add_knowledge_management`

- [ ] **Step 4: Verify tables exist**

```bash
cd backend
uv run python -c "
from sqlalchemy import create_engine, inspect
from app.config import settings
engine = create_engine(str(settings.database_url).replace('+asyncpg',''))
insp = inspect(engine)
print(insp.get_table_names())
"
```

Expected: output includes `major`, `direction`, `knowledge_point_prerequisite`

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/
git commit -m "feat: add knowledge management db migration"
```

---

## Task 2: Backend Models

**Files:**
- Create: `backend/src/app/learning/__init__.py`
- Create: `backend/src/app/learning/models.py`
- Modify: `backend/src/app/questions/models.py`

- [ ] **Step 1: Create package marker**

```python
# backend/src/app/learning/__init__.py
```

(empty file)

- [ ] **Step 2: Write `learning/models.py`**

```python
"""Models for knowledge management: Major, Direction, KnowledgePoint, KnowledgePointPrerequisite."""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, BaseModel


class Major(BaseModel):
    __tablename__ = "major"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    directions: Mapped[list["Direction"]] = relationship(
        back_populates="major", cascade="all, delete-orphan"
    )


class Direction(BaseModel):
    __tablename__ = "direction"

    major_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("major.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    major: Mapped["Major"] = relationship(back_populates="directions")
    knowledge_points: Mapped[list["KnowledgePoint"]] = relationship(back_populates="direction")


class KnowledgePoint(BaseModel):
    """Extended knowledge point with direction, tags, and difficulty."""
    __tablename__ = "knowledge_points"
    __table_args__ = (
        CheckConstraint("difficulty IN ('入门','初级','中级','高级','困难')", name="ck_kp_difficulty"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    direction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("direction.id", ondelete="SET NULL"), nullable=True
    )
    tags: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    difficulty: Mapped[str | None] = mapped_column(String(10), nullable=True)

    direction: Mapped["Direction | None"] = relationship(back_populates="knowledge_points")
    parent: Mapped["KnowledgePoint | None"] = relationship(
        remote_side="KnowledgePoint.id", back_populates="children"
    )
    children: Mapped[list["KnowledgePoint"]] = relationship(back_populates="parent")

    # Existing relationship — preserved for questions module
    from app.questions.models import question_knowledge_points  # type: ignore[assignment]
    questions: Mapped[list] = relationship(
        "Question", secondary="question_knowledge_points", back_populates="knowledge_points"
    )

    # Prerequisites: this node depends on `prerequisites_of` nodes
    prerequisites: Mapped[list["KnowledgePointPrerequisite"]] = relationship(
        foreign_keys="KnowledgePointPrerequisite.to_id",
        back_populates="target",
        cascade="all, delete-orphan",
    )


class KnowledgePointPrerequisite(Base):
    """A directed edge: to_id requires from_id first. Lightweight — no timestamps."""
    __tablename__ = "knowledge_point_prerequisite"
    __table_args__ = (UniqueConstraint("from_id", "to_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    from_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False
    )
    to_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False
    )

    source: Mapped["KnowledgePoint"] = relationship(foreign_keys=[from_id])
    target: Mapped["KnowledgePoint"] = relationship(
        foreign_keys=[to_id], back_populates="prerequisites"
    )
```

- [ ] **Step 3: Update `questions/models.py` to re-export `KnowledgePoint`**

Replace the existing `class KnowledgePoint(BaseModel): ...` block with:

```python
# KnowledgePoint has moved to app.learning.models — re-export for backward compatibility
from app.learning.models import KnowledgePoint as KnowledgePoint  # noqa: F401
```

Keep `question_knowledge_points` Table definition in `questions/models.py` unchanged.

- [ ] **Step 4: Verify imports work**

```bash
cd backend
uv run python -c "from app.learning.models import Major, Direction, KnowledgePoint, KnowledgePointPrerequisite; print('OK')"
uv run python -c "from app.questions.models import KnowledgePoint; print(KnowledgePoint.__tablename__)"
```

Expected: `OK` then `knowledge_points`

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/learning/ backend/src/app/questions/models.py
git commit -m "feat: move KnowledgePoint to learning module, add Major/Direction/Prerequisite models"
```

---

## Task 3: Backend Schemas

**Files:**
- Create: `backend/src/app/learning/schemas.py`

- [ ] **Step 1: Write schemas**

```python
"""Pydantic schemas for knowledge management."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# --- Major ---

class MajorCreate(BaseModel):
    name: str = Field(max_length=100)
    description: str | None = None


class MajorResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime


# --- Direction ---

class DirectionCreate(BaseModel):
    major_id: uuid.UUID
    name: str = Field(max_length=100)
    description: str | None = None


class DirectionResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    major_id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime


# --- KnowledgePoint ---

class KnowledgePointCreate(BaseModel):
    direction_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    name: str = Field(max_length=200)
    description: str | None = None
    tags: list[str] = []
    difficulty: str | None = Field(None, pattern="^(入门|初级|中级|高级|困难)$")


class KnowledgePointUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    description: str | None = None
    tags: list[str] | None = None
    difficulty: str | None = Field(None, pattern="^(入门|初级|中级|高级|困难)$")


class KnowledgePointDetail(BaseModel):
    """Single node as returned in the flat tree list."""
    model_config = {"from_attributes": True}
    id: uuid.UUID
    name: str
    description: str | None
    tags: list[str]
    difficulty: str | None
    parent_id: uuid.UUID | None
    direction_id: uuid.UUID | None
    question_count: int = 0


# --- Tree (ReactFlow-compatible) ---

class FlowNode(BaseModel):
    id: str
    type: str = "knowledgeNode"
    position: dict  # {"x": int, "y": int}
    data: KnowledgePointDetail


class FlowEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str  # "smoothstep" | "prerequisite"


class FlowData(BaseModel):
    nodes: list[FlowNode]
    edges: list[FlowEdge]


# --- Prerequisite ---

class PrerequisiteCreate(BaseModel):
    from_id: uuid.UUID  # the node that must be learned first
```

- [ ] **Step 2: Verify schemas parse**

```bash
cd backend
uv run python -c "from app.learning.schemas import MajorCreate, FlowData; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/app/learning/schemas.py
git commit -m "feat: add knowledge management pydantic schemas"
```

---

## Task 4: Backend Service (with TDD)

**Files:**
- Create: `backend/src/app/learning/service.py`
- Create: `backend/tests/unit/learning/test_service.py`

The service layer contains the two non-trivial algorithms: tree building (layout calculation) and cycle detection. Write these as pure functions with unit tests first.

- [ ] **Step 1: Create test file**

```bash
mkdir -p backend/tests/unit/learning
touch backend/tests/unit/learning/__init__.py
```

- [ ] **Step 2: Write failing unit tests**

```python
# backend/tests/unit/learning/test_service.py
"""Unit tests for knowledge management service — pure functions only."""
import uuid
import pytest
from app.learning.service import build_flow_data, has_cycle


# --- has_cycle ---

def make_id() -> str:
    return str(uuid.uuid4())


def test_no_cycle_returns_false():
    # A -> B -> C, no cycle
    a, b, c = make_id(), make_id(), make_id()
    edges = [(a, b), (b, c)]
    assert has_cycle(edges, new_from=a, new_to=c) is False


def test_direct_cycle_returns_true():
    # A -> B exists, adding B -> A would create cycle
    a, b = make_id(), make_id()
    edges = [(a, b)]
    assert has_cycle(edges, new_from=b, new_to=a) is True


def test_transitive_cycle_returns_true():
    # A -> B -> C exists, adding C -> A would create cycle
    a, b, c = make_id(), make_id(), make_id()
    edges = [(a, b), (b, c)]
    assert has_cycle(edges, new_from=c, new_to=a) is True


def test_self_loop_returns_true():
    a = make_id()
    assert has_cycle([], new_from=a, new_to=a) is True


# --- build_flow_data ---

def test_single_root_node_position():
    """Root node with no children should be at x=0, y=0."""
    root_id = make_id()
    nodes = [{"id": root_id, "parent_id": None, "direction_id": None,
              "name": "Root", "description": None, "tags": [], "difficulty": None, "question_count": 0}]
    prereqs = []
    result = build_flow_data(nodes, prereqs)
    assert len(result["nodes"]) == 1
    assert result["nodes"][0]["position"]["x"] == 0
    assert result["nodes"][0]["position"]["y"] == 0
    assert result["edges"] == []


def test_parent_child_produces_smoothstep_edge():
    parent_id, child_id = make_id(), make_id()
    nodes = [
        {"id": parent_id, "parent_id": None, "direction_id": None,
         "name": "Parent", "description": None, "tags": [], "difficulty": None, "question_count": 0},
        {"id": child_id, "parent_id": parent_id, "direction_id": None,
         "name": "Child", "description": None, "tags": [], "difficulty": None, "question_count": 0},
    ]
    prereqs = []
    result = build_flow_data(nodes, prereqs)
    assert len(result["edges"]) == 1
    assert result["edges"][0]["type"] == "smoothstep"
    assert result["edges"][0]["source"] == parent_id
    assert result["edges"][0]["target"] == child_id


def test_prerequisite_produces_prerequisite_edge():
    a_id, b_id = make_id(), make_id()
    nodes = [
        {"id": a_id, "parent_id": None, "direction_id": None,
         "name": "A", "description": None, "tags": [], "difficulty": None, "question_count": 0},
        {"id": b_id, "parent_id": None, "direction_id": None,
         "name": "B", "description": None, "tags": [], "difficulty": None, "question_count": 0},
    ]
    prereqs = [{"from_id": a_id, "to_id": b_id}]
    result = build_flow_data(nodes, prereqs)
    prereq_edges = [e for e in result["edges"] if e["type"] == "prerequisite"]
    assert len(prereq_edges) == 1
    assert prereq_edges[0]["source"] == a_id
    assert prereq_edges[0]["target"] == b_id


def test_child_x_is_greater_than_parent_x():
    parent_id, child_id = make_id(), make_id()
    nodes = [
        {"id": parent_id, "parent_id": None, "direction_id": None,
         "name": "P", "description": None, "tags": [], "difficulty": None, "question_count": 0},
        {"id": child_id, "parent_id": parent_id, "direction_id": None,
         "name": "C", "description": None, "tags": [], "difficulty": None, "question_count": 0},
    ]
    result = build_flow_data(nodes, [])
    parent_node = next(n for n in result["nodes"] if n["id"] == parent_id)
    child_node = next(n for n in result["nodes"] if n["id"] == child_id)
    assert child_node["position"]["x"] > parent_node["position"]["x"]
```

- [ ] **Step 3: Run tests — confirm they fail**

```bash
cd backend
uv run pytest tests/unit/learning/test_service.py -v
```

Expected: `ImportError` or `ModuleNotFoundError` — `service.py` does not exist yet.

- [ ] **Step 4: Write `service.py`**

```python
"""Service layer for knowledge management."""

import uuid
from collections import defaultdict, deque
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.learning.models import Direction, KnowledgePoint, KnowledgePointPrerequisite, Major
from app.learning.schemas import (
    DirectionCreate,
    KnowledgePointCreate,
    KnowledgePointUpdate,
    MajorCreate,
)
from app.questions.models import question_knowledge_points

HORIZONTAL_SPACING = 280
VERTICAL_SPACING = 120


# ---------------------------------------------------------------------------
# Pure functions (unit-testable without DB)
# ---------------------------------------------------------------------------

def has_cycle(existing_edges: list[tuple[str, str]], new_from: str, new_to: str) -> bool:
    """Return True if adding edge new_from -> new_to creates a cycle.

    Uses BFS: starting from new_to, can we reach new_from following existing edges?
    If yes, the new edge would create a cycle.
    """
    if new_from == new_to:
        return True
    adjacency: dict[str, list[str]] = defaultdict(list)
    for src, tgt in existing_edges:
        adjacency[src].append(tgt)
    queue = deque([new_to])
    visited = {new_to}
    while queue:
        node = queue.popleft()
        for neighbor in adjacency[node]:
            if neighbor == new_from:
                return True
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return False


def build_flow_data(
    nodes: list[dict[str, Any]],
    prereqs: list[dict[str, str]],
) -> dict[str, Any]:
    """Convert flat node list + prereq list to ReactFlow {nodes, edges}.

    Positions nodes using horizontal tree layout (left-to-right):
    - x = depth * HORIZONTAL_SPACING
    - y = sibling_index * VERTICAL_SPACING, centered on parent
    """
    # Build parent->children map
    children_map: dict[str | None, list[dict]] = defaultdict(list)
    for node in nodes:
        children_map[node["parent_id"]].append(node)

    flow_nodes: list[dict] = []
    flow_edges: list[dict] = []

    def layout(node_id: str | None, depth: int, y_offset: float) -> float:
        """Recursively assign positions. Returns next available y_offset."""
        children = children_map.get(node_id, [])
        if not children:
            return y_offset
        # First pass: count total height needed
        child_y = y_offset
        for child in children:
            child_y = layout(child["id"], depth + 1, child_y)
        return child_y

    # Two-pass layout: first assign depths, then center parents
    node_positions: dict[str, dict] = {}

    def assign_positions(node_id: str | None, depth: int, y_start: int) -> int:
        """Returns the y after the last leaf in this subtree."""
        children = children_map.get(node_id, [])
        if not children and node_id is not None:
            node_positions[node_id] = {"x": depth * HORIZONTAL_SPACING, "y": y_start}
            return y_start + VERTICAL_SPACING
        y_cursor = y_start
        for child in children:
            y_cursor = assign_positions(child["id"], depth + 1, y_cursor)
        # Center parent between first and last child
        if node_id is not None:
            first_child_y = node_positions.get(children[0]["id"], {}).get("y", y_start)
            last_child_y = node_positions.get(children[-1]["id"], {}).get("y", y_start)
            node_positions[node_id] = {
                "x": depth * HORIZONTAL_SPACING,
                "y": (first_child_y + last_child_y) // 2,
            }
        return y_cursor

    # Find root nodes (parent_id is None or parent not in node set)
    node_ids = {n["id"] for n in nodes}
    roots = [n for n in nodes if n["parent_id"] is None or n["parent_id"] not in node_ids]

    y_cursor = 0
    for root in roots:
        y_cursor = assign_positions(root["id"], 0, y_cursor)

    # Build flow nodes
    for node in nodes:
        pos = node_positions.get(node["id"], {"x": 0, "y": 0})
        flow_nodes.append({
            "id": node["id"],
            "type": "knowledgeNode",
            "position": pos,
            "data": {k: node[k] for k in node if k != "id"},
        })

    # Build parent-child edges
    for node in nodes:
        if node["parent_id"] and node["parent_id"] in node_ids:
            flow_edges.append({
                "id": f"pc-{node['parent_id']}-{node['id']}",
                "source": node["parent_id"],
                "target": node["id"],
                "type": "smoothstep",
            })

    # Build prerequisite edges
    for prereq in prereqs:
        flow_edges.append({
            "id": f"prereq-{prereq['from_id']}-{prereq['to_id']}",
            "source": prereq["from_id"],
            "target": prereq["to_id"],
            "type": "prerequisite",
        })

    return {"nodes": flow_nodes, "edges": flow_edges}


# ---------------------------------------------------------------------------
# DB operations
# ---------------------------------------------------------------------------

async def list_majors(db: AsyncSession) -> list[Major]:
    result = await db.execute(select(Major).where(Major.deleted_at.is_(None)).order_by(Major.name))
    return list(result.scalars().all())


async def get_major(db: AsyncSession, major_id: uuid.UUID) -> Major | None:
    result = await db.execute(select(Major).where(Major.id == major_id, Major.deleted_at.is_(None)))
    return result.scalar_one_or_none()


async def create_major(db: AsyncSession, data: MajorCreate) -> Major:
    major = Major(**data.model_dump())
    db.add(major)
    await db.commit()
    await db.refresh(major)
    return major


async def update_major(db: AsyncSession, major: Major, data: dict) -> Major:
    for key, value in data.items():
        setattr(major, key, value)
    await db.commit()
    await db.refresh(major)
    return major


async def soft_delete_major(db: AsyncSession, major: Major) -> None:
    from datetime import datetime, timezone
    major.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def list_directions(db: AsyncSession, major_id: uuid.UUID) -> list[Direction]:
    result = await db.execute(
        select(Direction)
        .where(Direction.major_id == major_id, Direction.deleted_at.is_(None))
        .order_by(Direction.name)
    )
    return list(result.scalars().all())


async def get_direction(db: AsyncSession, direction_id: uuid.UUID) -> Direction | None:
    result = await db.execute(
        select(Direction).where(Direction.id == direction_id, Direction.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def create_direction(db: AsyncSession, data: DirectionCreate) -> Direction:
    direction = Direction(**data.model_dump())
    db.add(direction)
    await db.commit()
    await db.refresh(direction)
    return direction


async def soft_delete_direction(db: AsyncSession, direction: Direction) -> None:
    from datetime import datetime, timezone
    direction.deleted_at = datetime.now(timezone.utc)
    await db.commit()


MAX_NODES_PER_DIRECTION = 300


async def get_direction_tree(db: AsyncSession, direction_id: uuid.UUID) -> dict[str, Any]:
    """Return ReactFlow-compatible {nodes, edges} for the direction.

    Raises ValueError if node count exceeds MAX_NODES_PER_DIRECTION.
    """
    # Count questions per knowledge point
    count_subq = (
        select(
            question_knowledge_points.c.knowledge_point_id,
            func.count().label("cnt"),
        )
        .group_by(question_knowledge_points.c.knowledge_point_id)
        .subquery()
    )
    stmt = (
        select(KnowledgePoint, func.coalesce(count_subq.c.cnt, 0).label("question_count"))
        .outerjoin(count_subq, KnowledgePoint.id == count_subq.c.knowledge_point_id)
        .where(KnowledgePoint.direction_id == direction_id, KnowledgePoint.deleted_at.is_(None))
    )
    rows = (await db.execute(stmt)).all()

    if len(rows) > MAX_NODES_PER_DIRECTION:
        raise ValueError(
            f"节点数超过上限（{MAX_NODES_PER_DIRECTION}），请拆分方向后再操作"
        )

    flat_nodes = [
        {
            "id": str(row[0].id),
            "name": row[0].name,
            "description": row[0].description,
            "tags": row[0].tags or [],
            "difficulty": row[0].difficulty,
            "parent_id": str(row[0].parent_id) if row[0].parent_id else None,
            "direction_id": str(row[0].direction_id) if row[0].direction_id else None,
            "question_count": row[1],
        }
        for row in rows
    ]

    node_ids = {n["id"] for n in flat_nodes}
    prereq_stmt = select(KnowledgePointPrerequisite).where(
        KnowledgePointPrerequisite.to_id.in_([uuid.UUID(nid) for nid in node_ids])
    )
    prereqs_rows = (await db.execute(prereq_stmt)).scalars().all()
    prereqs = [
        {"from_id": str(p.from_id), "to_id": str(p.to_id)}
        for p in prereqs_rows
        if str(p.from_id) in node_ids
    ]

    return build_flow_data(flat_nodes, prereqs)


async def create_knowledge_point(db: AsyncSession, data: KnowledgePointCreate) -> KnowledgePoint:
    kp = KnowledgePoint(**data.model_dump())
    db.add(kp)
    await db.commit()
    await db.refresh(kp)
    return kp


async def update_knowledge_point(db: AsyncSession, kp: KnowledgePoint, data: KnowledgePointUpdate) -> KnowledgePoint:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(kp, key, value)
    await db.commit()
    await db.refresh(kp)
    return kp


async def soft_delete_knowledge_point(db: AsyncSession, kp: KnowledgePoint) -> None:
    """Soft-delete this node and all descendants recursively."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    async def _delete_subtree(node_id: uuid.UUID) -> None:
        children_result = await db.execute(
            select(KnowledgePoint).where(
                KnowledgePoint.parent_id == node_id,
                KnowledgePoint.deleted_at.is_(None),
            )
        )
        for child in children_result.scalars().all():
            await _delete_subtree(child.id)
            child.deleted_at = now

    await _delete_subtree(kp.id)
    kp.deleted_at = now
    await db.commit()


async def get_knowledge_point(db: AsyncSession, kp_id: uuid.UUID) -> KnowledgePoint | None:
    result = await db.execute(
        select(KnowledgePoint).where(KnowledgePoint.id == kp_id, KnowledgePoint.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def add_prerequisite(
    db: AsyncSession, kp_id: uuid.UUID, from_id: uuid.UUID
) -> KnowledgePointPrerequisite:
    """Add prerequisite: from_id must be learned before kp_id (to_id).

    Raises ValueError if cycle detected.
    """
    existing = (await db.execute(select(KnowledgePointPrerequisite))).scalars().all()
    edges = [(str(p.from_id), str(p.to_id)) for p in existing]
    if has_cycle(edges, new_from=str(from_id), new_to=str(kp_id)):
        raise ValueError("Adding this prerequisite would create a cycle")
    prereq = KnowledgePointPrerequisite(from_id=from_id, to_id=kp_id)
    db.add(prereq)
    await db.commit()
    await db.refresh(prereq)
    return prereq


async def remove_prerequisite(db: AsyncSession, kp_id: uuid.UUID, prereq_id: uuid.UUID) -> None:
    result = await db.execute(
        select(KnowledgePointPrerequisite).where(
            KnowledgePointPrerequisite.id == prereq_id,
            KnowledgePointPrerequisite.to_id == kp_id,
        )
    )
    prereq = result.scalar_one_or_none()
    if prereq:
        await db.delete(prereq)
        await db.commit()
```

- [ ] **Step 5: Run unit tests — confirm they pass**

```bash
cd backend
uv run pytest tests/unit/learning/test_service.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/learning/service.py backend/tests/unit/learning/
git commit -m "feat: add knowledge management service with cycle detection and tree layout"
```

---

## Task 5: Backend Router + Integration Tests

**Files:**
- Create: `backend/src/app/learning/router.py`
- Create: `backend/tests/integration/learning/test_router.py`
- Modify: `backend/src/app/main.py`

- [ ] **Step 1: Write `learning/router.py`**

```python
"""FastAPI router for knowledge management."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles
from app.auth.models import UserRole
from app.database import get_db
from app.learning import service
from app.learning.schemas import (
    DirectionCreate,
    DirectionResponse,
    FlowData,
    KnowledgePointCreate,
    KnowledgePointUpdate,
    MajorCreate,
    MajorResponse,
    PrerequisiteCreate,
)

router = APIRouter()
DB = Annotated[AsyncSession, Depends(get_db)]
WriteRoles = Annotated[None, Depends(require_roles(UserRole.ADMIN, UserRole.TEACHER))]


# --- Majors ---

@router.get("/majors", response_model=list[MajorResponse])
async def list_majors(db: DB, _user: CurrentUser) -> list[MajorResponse]:
    majors = await service.list_majors(db)
    return [MajorResponse.model_validate(m) for m in majors]


@router.get("/majors/{major_id}", response_model=MajorResponse)
async def get_major(major_id: uuid.UUID, db: DB, _user: CurrentUser) -> MajorResponse:
    major = await service.get_major(db, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    return MajorResponse.model_validate(major)


@router.post("/majors", response_model=MajorResponse, status_code=201)
async def create_major(data: MajorCreate, db: DB, _: WriteRoles) -> MajorResponse:
    major = await service.create_major(db, data)
    return MajorResponse.model_validate(major)


@router.put("/majors/{major_id}", response_model=MajorResponse)
async def update_major(major_id: uuid.UUID, data: MajorCreate, db: DB, _: WriteRoles) -> MajorResponse:
    major = await service.get_major(db, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    major = await service.update_major(db, major, data.model_dump(exclude_unset=True))
    return MajorResponse.model_validate(major)


@router.delete("/majors/{major_id}", status_code=204)
async def delete_major(major_id: uuid.UUID, db: DB, _: WriteRoles) -> None:
    major = await service.get_major(db, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="Major not found")
    await service.soft_delete_major(db, major)


# --- Directions ---

@router.get("/majors/{major_id}/directions", response_model=list[DirectionResponse])
async def list_directions(major_id: uuid.UUID, db: DB, _user: CurrentUser) -> list[DirectionResponse]:
    directions = await service.list_directions(db, major_id)
    return [DirectionResponse.model_validate(d) for d in directions]


@router.get("/directions/{direction_id}", response_model=DirectionResponse)
async def get_direction(direction_id: uuid.UUID, db: DB, _user: CurrentUser) -> DirectionResponse:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    return DirectionResponse.model_validate(direction)


@router.post("/directions", response_model=DirectionResponse, status_code=201)
async def create_direction(data: DirectionCreate, db: DB, _: WriteRoles) -> DirectionResponse:
    direction = await service.create_direction(db, data)
    return DirectionResponse.model_validate(direction)


@router.delete("/directions/{direction_id}", status_code=204)
async def delete_direction(direction_id: uuid.UUID, db: DB, _: WriteRoles) -> None:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    await service.soft_delete_direction(db, direction)


# --- Knowledge Tree ---

@router.get("/directions/{direction_id}/tree", response_model=FlowData)
async def get_tree(direction_id: uuid.UUID, db: DB, _user: CurrentUser) -> FlowData:
    direction = await service.get_direction(db, direction_id)
    if not direction:
        raise HTTPException(status_code=404, detail="Direction not found")
    try:
        data = await service.get_direction_tree(db, direction_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FlowData(**data)


# --- Knowledge Points ---

@router.post("/knowledge-points", response_model=dict, status_code=201)
async def create_kp(data: KnowledgePointCreate, db: DB, _: WriteRoles) -> dict:
    kp = await service.create_knowledge_point(db, data)
    return {"id": str(kp.id), "name": kp.name}


@router.put("/knowledge-points/{kp_id}", response_model=dict)
async def update_kp(kp_id: uuid.UUID, data: KnowledgePointUpdate, db: DB, _: WriteRoles) -> dict:
    kp = await service.get_knowledge_point(db, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    kp = await service.update_knowledge_point(db, kp, data)
    return {"id": str(kp.id), "name": kp.name}


@router.delete("/knowledge-points/{kp_id}", status_code=204)
async def delete_kp(kp_id: uuid.UUID, db: DB, _: WriteRoles) -> None:
    kp = await service.get_knowledge_point(db, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    await service.soft_delete_knowledge_point(db, kp)


# --- Prerequisites ---

@router.post("/knowledge-points/{kp_id}/prerequisites", response_model=dict, status_code=201)
async def add_prereq(kp_id: uuid.UUID, data: PrerequisiteCreate, db: DB, _: WriteRoles) -> dict:
    kp = await service.get_knowledge_point(db, kp_id)
    if not kp:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    try:
        prereq = await service.add_prerequisite(db, kp_id, data.from_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": str(prereq.id)}


@router.delete("/knowledge-points/{kp_id}/prerequisites/{prereq_id}", status_code=204)
async def remove_prereq(kp_id: uuid.UUID, prereq_id: uuid.UUID, db: DB, _: WriteRoles) -> None:
    await service.remove_prerequisite(db, kp_id, prereq_id)
```

- [ ] **Step 2: Register router in `main.py`**

Add after existing router imports:
```python
from app.learning.router import router as knowledge_router
```

Add after existing `app.include_router(...)` calls:
```python
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["knowledge"])
```

- [ ] **Step 3: Write integration tests**

```bash
mkdir -p backend/tests/integration/learning
touch backend/tests/integration/learning/__init__.py
```

```python
# backend/tests/integration/learning/test_router.py
"""Integration tests for knowledge management API."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_and_list_majors(admin_client: AsyncClient):
    resp = await admin_client.post("/api/knowledge/majors", json={"name": "Computer Science"})
    assert resp.status_code == 201
    major_id = resp.json()["id"]

    resp = await admin_client.get("/api/knowledge/majors")
    assert resp.status_code == 200
    names = [m["name"] for m in resp.json()]
    assert "Computer Science" in names


@pytest.mark.asyncio
async def test_create_direction_and_get_tree(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "Math"})).json()
    direction = (await admin_client.post(
        "/api/knowledge/directions",
        json={"major_id": major["id"], "name": "Algebra"}
    )).json()
    direction_id = direction["id"]

    # Create root knowledge point
    kp = (await admin_client.post("/api/knowledge/knowledge-points", json={
        "direction_id": direction_id,
        "name": "Linear Equations",
        "tags": ["algebra"],
        "difficulty": "入门",
    })).json()

    tree = (await admin_client.get(f"/api/knowledge/directions/{direction_id}/tree")).json()
    assert len(tree["nodes"]) == 1
    assert tree["nodes"][0]["data"]["name"] == "Linear Equations"
    assert tree["edges"] == []


@pytest.mark.asyncio
async def test_prerequisite_cycle_returns_400(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "CS2"})).json()
    direction = (await admin_client.post(
        "/api/knowledge/directions",
        json={"major_id": major["id"], "name": "Algorithms"}
    )).json()
    did = direction["id"]

    a = (await admin_client.post("/api/knowledge/knowledge-points", json={"direction_id": did, "name": "A"})).json()
    b = (await admin_client.post("/api/knowledge/knowledge-points", json={"direction_id": did, "name": "B"})).json()

    # A -> B (B requires A)
    resp = await admin_client.post(
        f"/api/knowledge/knowledge-points/{b['id']}/prerequisites",
        json={"from_id": a["id"]}
    )
    assert resp.status_code == 201

    # B -> A would create cycle
    resp = await admin_client.post(
        f"/api/knowledge/knowledge-points/{a['id']}/prerequisites",
        json={"from_id": b["id"]}
    )
    assert resp.status_code == 400
    assert "cycle" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_soft_delete_cascades_to_children(admin_client: AsyncClient):
    major = (await admin_client.post("/api/knowledge/majors", json={"name": "CS3"})).json()
    direction = (await admin_client.post(
        "/api/knowledge/directions",
        json={"major_id": major["id"], "name": "DS"}
    )).json()
    did = direction["id"]

    parent = (await admin_client.post("/api/knowledge/knowledge-points", json={"direction_id": did, "name": "Parent"})).json()
    child = (await admin_client.post("/api/knowledge/knowledge-points", json={
        "direction_id": did, "name": "Child", "parent_id": parent["id"]
    })).json()

    # Delete parent
    resp = await admin_client.delete(f"/api/knowledge/knowledge-points/{parent['id']}")
    assert resp.status_code == 204

    # Tree should be empty
    tree = (await admin_client.get(f"/api/knowledge/directions/{did}/tree")).json()
    assert tree["nodes"] == []
```

- [ ] **Step 4: Check if `admin_client` fixture exists in the test suite**

```bash
grep -r "admin_client" backend/tests/conftest.py 2>/dev/null || echo "not found"
```

If not found, add to `backend/tests/conftest.py`:
```python
@pytest.fixture
async def admin_client(async_client: AsyncClient, admin_token: str) -> AsyncClient:
    async_client.headers.update({"Authorization": f"Bearer {admin_token}"})
    return async_client
```

Look at the existing conftest for how `async_client` and auth tokens are set up, and follow that pattern.

- [ ] **Step 5: Run integration tests**

```bash
cd backend
uv run pytest tests/integration/learning/ -v
```

Expected: all 4 tests PASS

- [ ] **Step 6: Run full backend test suite to check no regressions**

```bash
cd backend
uv run pytest --tb=short -q
```

Expected: all existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/learning/router.py backend/src/app/main.py backend/tests/integration/learning/
git commit -m "feat: add knowledge management API router and integration tests"
```

---

## Task 6: Frontend — Install Dependency & Types

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/pages/knowledge/types.ts`

- [ ] **Step 1: Install `@xyflow/react`**

```bash
cd frontend
pnpm add @xyflow/react
```

- [ ] **Step 2: Extend `IKnowledgePoint` in `frontend/src/types/index.ts`**

Find the existing `IKnowledgePoint` interface and add the new fields:

```typescript
export interface IKnowledgePoint {
  id: string;
  name: string;
  parent_id: string | null;
  description: string | null;
  created_at: string;
  // New fields added by knowledge management module
  direction_id?: string | null;
  tags?: string[];
  difficulty?: string | null;
  question_count?: number;
}
```

- [ ] **Step 3: Create `frontend/src/pages/knowledge/types.ts`**

```typescript
// Types for the knowledge management tree view.
// These are richer than IKnowledgePoint and used only within this module.

export interface IKnowledgePointDetail {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  difficulty: string | null;
  parent_id: string | null;
  direction_id: string | null;
  question_count: number;
}

export interface IMajor {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface IDirection {
  id: string;
  major_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export type Difficulty = '入门' | '初级' | '中级' | '高级' | '困难';

export const DIFFICULTY_COLORS: Record<Difficulty, { bg: string; text: string }> = {
  '入门': { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400' },
  '初级': { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
  '中级': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' },
  '高级': { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  '困难': { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend
pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/types/index.ts frontend/src/pages/knowledge/types.ts
git commit -m "feat: install @xyflow/react, add knowledge management types"
```

---

## Task 7: Frontend — Custom ReactFlow Components

**Files:**
- Create: `frontend/src/pages/knowledge/KnowledgeNode.tsx`
- Create: `frontend/src/pages/knowledge/PrerequisiteEdge.tsx`
- Create: `frontend/src/pages/knowledge/NodeContextMenu.tsx`

- [ ] **Step 1: Create `KnowledgeNode.tsx`**

```tsx
// Custom ReactFlow node card for a knowledge point.
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { IKnowledgePointDetail, Difficulty } from './types';
import { DIFFICULTY_COLORS } from './types';

export const KnowledgeNode = memo(({ data }: NodeProps) => {
  const kp = data as IKnowledgePointDetail;
  const difficultyStyle = kp.difficulty
    ? DIFFICULTY_COLORS[kp.difficulty as Difficulty]
    : null;

  return (
    <div
      className="min-w-[160px] max-w-[200px] rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
      onContextMenu={(e) => {
        e.preventDefault();
        // Context menu is handled by KnowledgeTreeCanvas via onNodeContextMenu
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary" />

      <p className="font-semibold text-sm text-card-foreground leading-tight truncate">
        {kp.name}
      </p>

      {kp.description && (
        <p className="text-xs text-muted-foreground mt-1 truncate">{kp.description}</p>
      )}

      <div className="flex items-center gap-1 mt-2 flex-wrap">
        {kp.tags?.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="rounded px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary"
          >
            {tag}
          </span>
        ))}
        {difficultyStyle && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${difficultyStyle.bg} ${difficultyStyle.text}`}>
            {kp.difficulty}
          </span>
        )}
        {kp.question_count > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{kp.question_count}题</span>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </div>
  );
});

KnowledgeNode.displayName = 'KnowledgeNode';
```

- [ ] **Step 2: Create `PrerequisiteEdge.tsx`**

```tsx
// Custom ReactFlow edge for prerequisite (dashed red arrow).
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

export function PrerequisiteEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: '#ef4444', strokeDasharray: '5 3', strokeWidth: 1.5 }}
        markerEnd="url(#prereq-arrow)"
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          className="absolute text-[9px] text-red-500 bg-background px-1 rounded pointer-events-none"
        >
          前置
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
```

- [ ] **Step 3: Create `NodeContextMenu.tsx`**

```tsx
// Right-click context menu rendered via a portal.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { IKnowledgePointDetail } from './types';

export interface ContextMenuState {
  x: number;
  y: number;
  node: IKnowledgePointDetail & { id: string };
}

interface Props {
  menu: ContextMenuState;
  onClose: () => void;
  onAddChild: (parentId: string) => void;
  onSetPrerequisite: (nodeId: string) => void;
  onEdit: (nodeId: string) => void;
  onViewQuestions: (nodeId: string) => void;
  onViewAnalytics: (nodeId: string) => void;
  onDelete: (nodeId: string, name: string) => void;
}

export function NodeContextMenu({
  menu, onClose, onAddChild, onSetPrerequisite,
  onEdit, onViewQuestions, onViewAnalytics, onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const item = (icon: string, label: string, onClick: () => void, danger = false) => (
    <button
      key={label}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
        danger ? 'text-destructive' : 'text-foreground'
      }`}
      onClick={() => { onClick(); onClose(); }}
    >
      <span>{icon}</span>
      {label}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999 }}
      className="min-w-[160px] rounded-md border border-border bg-popover shadow-lg py-1"
    >
      {item('✚', '添加子知识点', () => onAddChild(menu.node.id))}
      {item('⇢', '设置前置知识点', () => onSetPrerequisite(menu.node.id))}
      {item('✎', '编辑', () => onEdit(menu.node.id))}
      {item('📋', '查看关联题目', () => onViewQuestions(menu.node.id))}
      {item('📊', '查看学习分析', () => onViewAnalytics(menu.node.id))}
      <div className="my-1 border-t border-border" />
      {item('🗑', '删除', () => onDelete(menu.node.id, menu.node.name), true)}
    </div>,
    document.body
  );
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd frontend
pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/knowledge/
git commit -m "feat: add KnowledgeNode, PrerequisiteEdge, NodeContextMenu components"
```

---

## Task 8: Frontend — Sidebar, Detail Panel, Canvas

**Files:**
- Create: `frontend/src/pages/knowledge/MajorDirectionSidebar.tsx`
- Create: `frontend/src/pages/knowledge/NodeDetailPanel.tsx`
- Create: `frontend/src/pages/knowledge/KnowledgeTreeCanvas.tsx`

- [ ] **Step 1: Create `MajorDirectionSidebar.tsx`**

```tsx
import { useState } from 'react';
import type { IMajor, IDirection } from './types';

interface Props {
  majors: IMajor[];
  selectedDirectionId: string | null;
  onSelect: (directionId: string) => void;
  getDirections: (majorId: string) => IDirection[];
}

export function MajorDirectionSidebar({ majors, selectedDirectionId, onSelect, getDirections }: Props) {
  const [expandedMajors, setExpandedMajors] = useState<Set<string>>(new Set());

  const toggleMajor = (id: string) =>
    setExpandedMajors((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="w-44 flex-shrink-0 border-r border-border bg-card overflow-y-auto p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 mb-2">专业</p>
      {majors.map((major) => {
        const expanded = expandedMajors.has(major.id);
        const directions = getDirections(major.id);
        return (
          <div key={major.id} className="mb-1">
            <button
              className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => toggleMajor(major.id)}
            >
              <span className="text-[10px] text-muted-foreground">{expanded ? '▼' : '▶'}</span>
              <span className="truncate">{major.name}</span>
            </button>
            {expanded && (
              <div className="pl-3">
                {directions.map((dir) => (
                  <button
                    key={dir.id}
                    className={`w-full text-left rounded px-2 py-1 text-xs truncate ${
                      selectedDirectionId === dir.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent'
                    }`}
                    onClick={() => onSelect(dir.id)}
                  >
                    {dir.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `NodeDetailPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { IKnowledgePointDetail, Difficulty } from './types';

interface Props {
  open: boolean;
  initial: Partial<IKnowledgePointDetail> & { directionId: string };
  onSave: (data: Partial<IKnowledgePointDetail>) => Promise<void>;
  onClose: () => void;
}

const DIFFICULTIES: Difficulty[] = ['入门', '初级', '中级', '高级', '困难'];

export function NodeDetailPanel({ open, initial, onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial.name ?? '');
      setDescription(initial.description ?? '');
      setTags((initial.tags ?? []).join(', '));
      setDifficulty((initial.difficulty as Difficulty) ?? '');
      setError(null);
    }
  }, [open, initial]);

  const handleSave = async () => {
    if (!name.trim()) { setError('名称不能为空'); return; }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        difficulty: difficulty || null,
      });
      onClose();
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-80 border-l border-border bg-background shadow-xl z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">{initial.id ? '编辑知识点' : '新建知识点'}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="text-xs font-medium">名称 *</label>
          <input
            className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium">描述</label>
          <textarea
            className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm resize-none"
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium">标签（逗号分隔）</label>
          <input
            className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm"
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="算法, 数据结构"
          />
        </div>
        <div>
          <label className="text-xs font-medium">难度</label>
          <select
            className="mt-1 w-full rounded border border-input bg-background px-3 py-1.5 text-sm"
            value={difficulty}
            onChange={e => setDifficulty(e.target.value as Difficulty | '')}
          >
            <option value="">— 不设置 —</option>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="px-4 py-3 border-t border-border flex gap-2 justify-end">
        <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-input hover:bg-accent">
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `KnowledgeTreeCanvas.tsx`**

```tsx
import { useCallback, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Node, type Edge, type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { KnowledgeNode } from './KnowledgeNode';
import { PrerequisiteEdge } from './PrerequisiteEdge';
import { NodeContextMenu, type ContextMenuState } from './NodeContextMenu';
import type { IKnowledgePointDetail } from './types';

const nodeTypes = { knowledgeNode: KnowledgeNode };
const edgeTypes = { prerequisite: PrerequisiteEdge };

interface Props {
  initialNodes: Node[];
  initialEdges: Edge[];
  onAddChild: (parentId: string) => void;
  onSetPrerequisite: (nodeId: string) => void;
  onEdit: (nodeId: string) => void;
  onViewQuestions: (nodeId: string) => void;
  onViewAnalytics: (nodeId: string) => void;
  onDelete: (nodeId: string, name: string) => void;
}

export function KnowledgeTreeCanvas({
  initialNodes, initialEdges,
  onAddChild, onSetPrerequisite, onEdit,
  onViewQuestions, onViewAnalytics, onDelete,
}: Props) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      node: { id: node.id, ...(node.data as IKnowledgePointDetail) },
    });
  }, []);

  return (
    <div className="flex-1 relative">
      {/* SVG defs for prerequisite arrow marker */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <marker id="prereq-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
          </marker>
        </defs>
      </svg>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setMenu(null)}
        fitView
        minZoom={0.3}
        maxZoom={2}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>

      {menu && (
        <NodeContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onAddChild={onAddChild}
          onSetPrerequisite={onSetPrerequisite}
          onEdit={onEdit}
          onViewQuestions={onViewQuestions}
          onViewAnalytics={onViewAnalytics}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd frontend
pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/knowledge/
git commit -m "feat: add MajorDirectionSidebar, NodeDetailPanel, KnowledgeTreeCanvas"
```

---

## Task 9: Frontend — Page Entry & Wiring

**Files:**
- Create: `frontend/src/pages/knowledge/index.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/providers/access-control.ts`
- Modify: `frontend/src/components/layout.tsx`

- [ ] **Step 1: Create `frontend/src/pages/knowledge/PrerequisiteSelectModal.tsx`**

```tsx
// Modal for selecting a prerequisite knowledge point from the same direction.
import type { IKnowledgePointDetail } from './types';

interface Props {
  open: boolean;
  targetNodeId: string;
  allNodes: Array<{ id: string; data: IKnowledgePointDetail }>;
  onSelect: (fromId: string) => Promise<void>;
  onClose: () => void;
}

export function PrerequisiteSelectModal({ open, targetNodeId, allNodes, onSelect, onClose }: Props) {
  if (!open) return null;

  const candidates = allNodes.filter((n) => n.id !== targetNodeId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-80 rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">选择前置知识点</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {candidates.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">该方向暂无其他知识点</p>
          )}
          {candidates.map((node) => (
            <button
              key={node.id}
              className="w-full text-left rounded px-3 py-2 text-sm hover:bg-accent"
              onClick={async () => {
                await onSelect(node.id);
                onClose();
              }}
            >
              {node.data.name}
              {node.data.difficulty && (
                <span className="ml-2 text-xs text-muted-foreground">{node.data.difficulty}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/pages/knowledge/index.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Node, type Edge } from '@xyflow/react';
import { MajorDirectionSidebar } from './MajorDirectionSidebar';
import { KnowledgeTreeCanvas } from './KnowledgeTreeCanvas';
import { NodeDetailPanel } from './NodeDetailPanel';
import { PrerequisiteSelectModal } from './PrerequisiteSelectModal';
import type { IMajor, IDirection, IKnowledgePointDetail } from './types';

const API = '/api/knowledge';

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = JSON.parse(localStorage.getItem('user') ?? '{}')?.access_token;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? 'Request failed');
  }
  return res.json();
}

export function KnowledgeManagementPage() {
  const navigate = useNavigate();
  const [majors, setMajors] = useState<IMajor[]>([]);
  const [directions, setDirections] = useState<IDirection[]>([]);
  const [selectedDirectionId, setSelectedDirectionId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelInitial, setPanelInitial] = useState<Partial<IKnowledgePointDetail> & { directionId: string }>({
    directionId: '',
  });

  // Prerequisite selection modal state
  const [prereqModalOpen, setPrereqModalOpen] = useState(false);
  const [prereqTargetId, setPrereqTargetId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<IMajor[]>(`${API}/majors`).then(setMajors).catch(console.error);
  }, []);

  const getDirections = useCallback(
    (majorId: string) => directions.filter((d) => d.major_id === majorId),
    [directions]
  );

  const loadDirections = useCallback(async (majorId: string) => {
    const dirs = await apiFetch<IDirection[]>(`${API}/majors/${majorId}/directions`);
    setDirections((prev) => [...prev.filter((d) => d.major_id !== majorId), ...dirs]);
  }, []);

  // Pre-load directions when majors load
  useEffect(() => {
    majors.forEach((m) => loadDirections(m.id));
  }, [majors, loadDirections]);

  const loadTree = useCallback(async (directionId: string) => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const data = await apiFetch<{ nodes: Node[]; edges: Edge[] }>(`${API}/directions/${directionId}/tree`);
      setNodes(data.nodes);
      setEdges(data.edges);
    } catch {
      setTreeError('加载失败');
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const handleSelectDirection = useCallback(
    (directionId: string) => {
      setSelectedDirectionId(directionId);
      loadTree(directionId);
    },
    [loadTree]
  );

  const handleAddChild = useCallback(
    (parentId: string) => {
      if (!selectedDirectionId) return;
      setPanelInitial({ directionId: selectedDirectionId, parent_id: parentId });
      setPanelOpen(true);
    },
    [selectedDirectionId]
  );

  const handleSetPrerequisite = useCallback((nodeId: string) => {
    setPrereqTargetId(nodeId);
    setPrereqModalOpen(true);
  }, []);

  const handlePrereqSelect = useCallback(
    async (fromId: string) => {
      if (!prereqTargetId) return;
      await apiFetch(`${API}/knowledge-points/${prereqTargetId}/prerequisites`, {
        method: 'POST',
        body: JSON.stringify({ from_id: fromId }),
      });
      if (selectedDirectionId) loadTree(selectedDirectionId);
    },
    [prereqTargetId, selectedDirectionId, loadTree]
  );

  const handleEdit = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || !selectedDirectionId) return;
      setPanelInitial({ ...(node.data as IKnowledgePointDetail), id: nodeId, directionId: selectedDirectionId });
      setPanelOpen(true);
    },
    [nodes, selectedDirectionId]
  );

  const handleDelete = useCallback(
    async (nodeId: string, name: string) => {
      const childCount = nodes.filter((n) => (n.data as IKnowledgePointDetail).parent_id === nodeId).length;
      const msg = childCount > 0
        ? `确定删除「${name}」及其 ${childCount} 个子知识点？`
        : `确定删除「${name}」？`;
      if (!confirm(msg)) return;
      try {
        await apiFetch(`${API}/knowledge-points/${nodeId}`, { method: 'DELETE' });
        if (selectedDirectionId) loadTree(selectedDirectionId);
      } catch (e: unknown) {
        alert((e as Error).message);
      }
    },
    [nodes, selectedDirectionId, loadTree]
  );

  const handleSave = useCallback(
    async (data: Partial<IKnowledgePointDetail>) => {
      if (panelInitial.id) {
        await apiFetch(`${API}/knowledge-points/${panelInitial.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
      } else {
        await apiFetch(`${API}/knowledge-points`, {
          method: 'POST',
          body: JSON.stringify({ ...data, direction_id: panelInitial.directionId, parent_id: panelInitial.parent_id ?? null }),
        });
      }
      if (selectedDirectionId) loadTree(selectedDirectionId);
    },
    [panelInitial, selectedDirectionId, loadTree]
  );

  return (
    <div className="flex h-full">
      <MajorDirectionSidebar
        majors={majors}
        selectedDirectionId={selectedDirectionId}
        onSelect={handleSelectDirection}
        getDirections={getDirections}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <h1 className="text-sm font-semibold">知识点管理</h1>
          {selectedDirectionId && (
            <button
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground"
              onClick={() => {
                setPanelInitial({ directionId: selectedDirectionId });
                setPanelOpen(true);
              }}
            >
              + 添加知识点
            </button>
          )}
        </div>

        {!selectedDirectionId && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            请在左侧选择一个方向
          </div>
        )}

        {selectedDirectionId && treeLoading && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            加载中…
          </div>
        )}

        {selectedDirectionId && treeError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <p className="text-sm text-muted-foreground">{treeError}</p>
            <button
              className="text-xs px-3 py-1.5 rounded border border-input hover:bg-accent"
              onClick={() => loadTree(selectedDirectionId)}
            >
              重试
            </button>
          </div>
        )}

        {selectedDirectionId && !treeLoading && !treeError && (
          <KnowledgeTreeCanvas
            initialNodes={nodes}
            initialEdges={edges}
            onAddChild={handleAddChild}
            onSetPrerequisite={handleSetPrerequisite}
            onEdit={handleEdit}
            onViewQuestions={(id) => navigate(`/questions?knowledge_point_id=${id}`)}
            onViewAnalytics={(id) => navigate(`/analytics?knowledge_point_id=${id}`)}
            onDelete={handleDelete}
          />
        )}
      </div>

      <NodeDetailPanel
        open={panelOpen}
        initial={panelInitial}
        onSave={handleSave}
        onClose={() => setPanelOpen(false)}
      />

      <PrerequisiteSelectModal
        open={prereqModalOpen}
        targetNodeId={prereqTargetId ?? ''}
        allNodes={nodes as Array<{ id: string; data: IKnowledgePointDetail }>}
        onSelect={handlePrereqSelect}
        onClose={() => setPrereqModalOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Add route in `App.tsx`**

Add import:
```tsx
import { KnowledgeManagementPage } from './pages/knowledge';
```

Add to Refine resources array:
```tsx
{
  name: "knowledge",
  list: "/knowledge",
  meta: { label: "知识点管理" },
},
```

Add to Routes (inside the `<Authenticated>` section, alongside other routes):
```tsx
<Route path="/knowledge" element={<KnowledgeManagementPage />} />
```

- [ ] **Step 4: Update `access-control.ts`**

In `teacherResources`, add `"knowledge"`:
```typescript
const teacherResources = ["questions", "exams", "grading", "knowledge"];
```

- [ ] **Step 5: Update `layout.tsx` navigation**

Find the existing knowledge-points nav item (around line 236):
```tsx
<NavItem href="/knowledge-points" title="知识点" icon={<Lightbulb size={14} />}>
  管理知识点树，关联题目权重
</NavItem>
```

Change to:
```tsx
<NavItem href="/knowledge-points" title="知识点关联" icon={<Lightbulb size={14} />}>
  题目知识点标签管理
</NavItem>
<NavItem href="/knowledge" title="知识点管理" icon={<Network size={14} />}>
  可视化知识树，前置依赖管理
</NavItem>
```

Also add `Network` to the lucide-react import at the top of the file.

- [ ] **Step 6: TypeScript check**

```bash
cd frontend
pnpm tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/knowledge/ frontend/src/App.tsx frontend/src/providers/access-control.ts frontend/src/components/layout.tsx
git commit -m "feat: wire up knowledge management page, routing, nav, and access control"
```

---

## Task 10: Smoke Test & Final Verification

- [ ] **Step 1: Start backend**

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

- [ ] **Step 2: Start frontend**

```bash
cd frontend
pnpm dev
```

- [ ] **Step 3: Manual smoke test**

1. Open http://localhost:5173, log in as admin
2. Navigate to 「知识点管理」in the sidebar
3. Verify the page loads without errors
4. Create a Major via API (`POST /api/knowledge/majors`) and reload — it should appear in the sidebar
5. Create a Direction under that Major
6. Click the Direction — canvas should show an empty state
7. Click 「+ 添加知识点」— panel should slide in
8. Fill in name, tags, difficulty and save — node should appear in the canvas
9. Right-click the node — context menu should appear with 6 items
10. Right-click → 「添加子知识点」— panel should open with parent pre-filled
11. Add a child node — tree should update with solid edge connecting them

- [ ] **Step 4: Run full test suite**

```bash
cd backend && uv run pytest -q
```

Expected: all tests pass, no regressions

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: knowledge management module complete — tree visualization with ReactFlow"
```

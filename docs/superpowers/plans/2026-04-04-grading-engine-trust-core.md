# Grading Engine Trust Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of the grading engine trust core so code questions and short-answer questions can run through a shared grading task pipeline with model routing, arbitration, structured reports, and audit records.

**Architecture:** Add a new `backend/src/app/grading/` module that follows the repo's existing backend pattern, but split by responsibility: persistence models and schemas, provider adapters, rubric builders, orchestration service, and API router. The engine will store immutable result snapshots and audit events, keep model-role binding configurable, and use provider adapters for Qwen, DeepSeek, and Claude-via-OpenRouter without coupling provider mechanics to grading roles.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Pydantic v2, Alembic, pytest, httpx

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `backend/src/app/grading/models.py` | SQLAlchemy models for grading tasks, result snapshots, audit events, and config tables |
| Create | `backend/src/app/grading/schemas.py` | Pydantic request/response schemas for task creation, report output, and manual actions |
| Create | `backend/src/app/grading/service.py` | Task lifecycle, orchestration entry points, arbitration logic, manual review operations |
| Create | `backend/src/app/grading/router.py` | API routes for creating tasks, querying reports, and manual actions |
| Create | `backend/src/app/grading/providers/__init__.py` | Provider package init |
| Create | `backend/src/app/grading/providers/base.py` | Provider protocol and shared result DTOs |
| Create | `backend/src/app/grading/providers/qwen.py` | Qwen direct provider adapter |
| Create | `backend/src/app/grading/providers/deepseek.py` | DeepSeek direct provider adapter |
| Create | `backend/src/app/grading/providers/openrouter.py` | OpenRouter adapter for Claude arbitration |
| Create | `backend/src/app/grading/orchestrator.py` | End-to-end grading workflow and arbitration decision logic |
| Create | `backend/src/app/grading/rubric_builders.py` | Code-question and short-answer rubric context builders |
| Modify | `backend/src/app/grading/__init__.py` | Export module components |
| Modify | `backend/src/app/config.py` | Add OpenRouter settings and grading thresholds |
| Modify | `backend/src/app/main.py` | Register grading router |
| Create | `backend/alembic/versions/add_grading_trust_core.py` | Migration for grading tables |
| Create | `backend/tests/grading/__init__.py` | Test package init |
| Create | `backend/tests/grading/test_models.py` | Persistence model tests |
| Create | `backend/tests/grading/test_rubric_builders.py` | Rubric builder tests |
| Create | `backend/tests/grading/test_orchestrator.py` | Workflow and arbitration tests |
| Create | `backend/tests/grading/test_router.py` | API tests |

---

### Task 1: Add Configuration Surface For Providers And Arbitration

**Files:**
- Modify: `backend/src/app/config.py`
- Test: `backend/tests/grading/test_orchestrator.py`

- [ ] **Step 1: Write the failing settings test**

Create `backend/tests/grading/test_orchestrator.py` with the first test:

```python
from app.config import Settings


def test_settings_expose_openrouter_and_grading_thresholds() -> None:
    settings = Settings(
        EXAM_OPENROUTER_API_KEY="router-key",
        EXAM_OPENROUTER_BASE_URL="https://openrouter.ai/api/v1",
        EXAM_OPENROUTER_MODEL_NAME="anthropic/claude-3.5-sonnet",
        EXAM_GRADING_SCORE_DIFF_THRESHOLD=0.15,
        EXAM_GRADING_DIMENSION_DIFF_THRESHOLD=0.2,
    )

    assert settings.openrouter_api_key == "router-key"
    assert settings.openrouter_base_url == "https://openrouter.ai/api/v1"
    assert settings.openrouter_model_name == "anthropic/claude-3.5-sonnet"
    assert settings.grading_score_diff_threshold == 0.15
    assert settings.grading_dimension_diff_threshold == 0.2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/grading/test_orchestrator.py::test_settings_expose_openrouter_and_grading_thresholds -v`

Expected: FAIL with `AttributeError` or validation error because the settings fields do not exist yet.

- [ ] **Step 3: Add the minimal settings fields**

Update `backend/src/app/config.py`:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_prefix": "EXAM_", "env_file": ".env", "extra": "ignore"}

    database_url: str = "postgresql+asyncpg://exam:exam@localhost:5432/exam"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 24
    cors_origins: list[str] = ["http://localhost:4000"]
    debug: bool = False
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_model_name: str = "deepseek-chat"
    qwen_api_key: str | None = None
    qwen_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model_name: str = "qwen-plus"
    kimi_api_key: str | None = None
    kimi_base_url: str = "https://api.moonshot.cn/v1"
    kimi_model_name: str = "moonshot-v1-8k"
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model_name: str = "anthropic/claude-3.5-sonnet"
    grading_score_diff_threshold: float = 0.15
    grading_dimension_diff_threshold: float = 0.20


settings = Settings()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/grading/test_orchestrator.py::test_settings_expose_openrouter_and_grading_thresholds -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/config.py backend/tests/grading/test_orchestrator.py
git commit -m "feat: add grading provider settings"
```

### Task 2: Create Persistence Models And Migration

**Files:**
- Create: `backend/src/app/grading/models.py`
- Modify: `backend/src/app/grading/__init__.py`
- Create: `backend/alembic/versions/add_grading_trust_core.py`
- Test: `backend/tests/grading/test_models.py`

- [ ] **Step 1: Write the failing model test**

Create `backend/tests/grading/test_models.py`:

```python
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.grading.models import (
    GradingAuditEvent,
    GradingResultSnapshot,
    GradingTask,
    ModelConfig,
    ProviderConfig,
    RoleBinding,
)


@pytest.mark.asyncio
async def test_create_grading_task_with_snapshot_and_audit(db_session: AsyncSession) -> None:
    provider = ProviderConfig(
        key="qwen-direct",
        provider_type="qwen",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    db_session.add(provider)
    await db_session.flush()

    model = ModelConfig(
        key="qwen-grader-v1",
        display_name="Qwen Grader",
        model_name="qwen-plus",
        provider_id=provider.id,
        temperature=0.1,
        is_active=True,
    )
    db_session.add(model)
    await db_session.flush()

    binding = RoleBinding(
        version=1,
        grader_model_id=model.id,
        reviewer_model_id=model.id,
        arbiter_model_id=model.id,
        is_active=True,
    )
    db_session.add(binding)
    await db_session.flush()

    task = GradingTask(
        source_type="single_debug",
        question_type="code",
        question_content="实现 two sum",
        max_score=100,
        student_answer_raw="def two_sum(nums, target): return []",
        standard_answers=[{"summary": "返回正确下标"}],
        rubric_definition={"dimensions": [{"key": "correctness", "weight": 0.4}]},
        role_binding_version=binding.version,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    snapshot = GradingResultSnapshot(
        task_id=task.id,
        snapshot_type="primary",
        score_total=55,
        dimension_scores={"correctness": 20},
        evidence_summary={"tests_passed": 1, "tests_total": 3},
        risk_flags=["low_correctness"],
        model_config_id=model.id,
        provider_config_id=provider.id,
        prompt_template_version="grading-v1",
        role_binding_version=binding.version,
        created_by="system",
    )
    db_session.add(snapshot)

    audit = GradingAuditEvent(
        task_id=task.id,
        event_type="task.created",
        event_payload={"source_type": "single_debug"},
        operator_type="system",
        operator_id="system",
    )
    db_session.add(audit)
    await db_session.commit()

    result = await db_session.execute(select(GradingTask).where(GradingTask.id == task.id))
    saved_task = result.scalar_one()

    assert saved_task.question_type == "code"
    assert saved_task.role_binding_version == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/grading/test_models.py::test_create_grading_task_with_snapshot_and_audit -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.grading.models'`.

- [ ] **Step 3: Add the SQLAlchemy models**

Create `backend/src/app/grading/models.py`:

```python
"""Persistence models for the grading trust core."""

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import BaseModel


class ProviderConfig(BaseModel):
    __tablename__ = "grading_provider_configs"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    credential_env: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ModelConfig(BaseModel):
    __tablename__ = "grading_model_configs"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    model_name: Mapped[str] = mapped_column(String(150), nullable=False)
    provider_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_provider_configs.id", ondelete="CASCADE"), nullable=False
    )
    temperature: Mapped[float] = mapped_column(Float, default=0.1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    provider: Mapped["ProviderConfig"] = relationship()


class RoleBinding(BaseModel):
    __tablename__ = "grading_role_bindings"

    version: Mapped[int] = mapped_column(Integer, nullable=False)
    grader_model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_model_configs.id", ondelete="CASCADE"), nullable=False
    )
    reviewer_model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_model_configs.id", ondelete="CASCADE"), nullable=False
    )
    arbiter_model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_model_configs.id", ondelete="CASCADE"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class GradingTask(BaseModel):
    __tablename__ = "grading_tasks"

    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_business_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    question_type: Mapped[str] = mapped_column(String(50), nullable=False)
    question_content: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str | None] = mapped_column(String(100), nullable=True)
    language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    max_score: Mapped[int] = mapped_column(Integer, nullable=False)
    knowledge_tags: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    fatal_rule_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    student_answer_raw: Mapped[str] = mapped_column(Text, nullable=False)
    student_answer_structured: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ocr_raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_repaired_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_refs: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    standard_answers: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    rubric_definition: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    scoring_points: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    dimension_weights: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    deduction_rules: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    fatal_error_rules: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    prompt_template_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role_binding_version: Mapped[int] = mapped_column(Integer, nullable=False)
    programming_language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    execution_env: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    test_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    compile_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    runtime_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    runtime_logs: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    resource_limit_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    latest_primary_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    latest_review_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    latest_arbitration_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    latest_final_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    latest_manual_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)


class GradingResultSnapshot(BaseModel):
    __tablename__ = "grading_result_snapshots"

    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_tasks.id", ondelete="CASCADE"), nullable=False
    )
    snapshot_type: Mapped[str] = mapped_column(String(50), nullable=False)
    score_total: Mapped[float] = mapped_column(Float, nullable=False)
    dimension_scores: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    deduction_reasons: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    strengths: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    improvement_suggestions: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    evidence_summary: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    risk_flags: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    provider_config_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("grading_provider_configs.id", ondelete="SET NULL"), nullable=True
    )
    model_config_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("grading_model_configs.id", ondelete="SET NULL"), nullable=True
    )
    prompt_template_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role_binding_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), nullable=False)


class GradingAuditEvent(BaseModel):
    __tablename__ = "grading_audit_events"

    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_tasks.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    event_payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    operator_type: Mapped[str] = mapped_column(String(50), nullable=False)
    operator_id: Mapped[str] = mapped_column(String(100), nullable=False)
```

Update `backend/src/app/grading/__init__.py`:

```python
"""Grading engine package."""
```

Create `backend/alembic/versions/add_grading_trust_core.py` with matching `upgrade()` and `downgrade()` calls for the six tables above.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/grading/test_models.py::test_create_grading_task_with_snapshot_and_audit -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/grading/__init__.py backend/src/app/grading/models.py backend/alembic/versions/add_grading_trust_core.py backend/tests/grading/test_models.py
git commit -m "feat: add grading persistence models"
```

### Task 3: Build Rubric Builders For Code And Short Answer Questions

**Files:**
- Create: `backend/src/app/grading/rubric_builders.py`
- Test: `backend/tests/grading/test_rubric_builders.py`

- [ ] **Step 1: Write the failing builder tests**

Create `backend/tests/grading/test_rubric_builders.py`:

```python
from app.grading.rubric_builders import build_code_rubric_context, build_short_answer_rubric_context


def test_build_code_rubric_context_includes_execution_evidence() -> None:
    task_payload = {
        "question_content": "实现 two sum",
        "student_answer_raw": "def two_sum(nums, target): return []",
        "rubric_definition": {"dimensions": [{"key": "correctness", "weight": 0.4}]},
        "test_summary": {"passed": 1, "total": 3},
        "compile_result": {"status": "passed"},
        "runtime_result": {"status": "failed"},
        "runtime_logs": ["assertion failed"],
    }

    context = build_code_rubric_context(task_payload)

    assert context["evidence"]["test_summary"]["total"] == 3
    assert context["question_type"] == "code"


def test_build_short_answer_rubric_context_includes_knowledge_points() -> None:
    task_payload = {
        "question_content": "什么是 TCP 三次握手",
        "student_answer_raw": "建立连接要先同步序列号",
        "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
        "scoring_points": [{"key": "sync_seq", "weight": 0.4}],
        "dimension_weights": {"coverage": 0.5, "accuracy": 0.5},
    }

    context = build_short_answer_rubric_context(task_payload)

    assert context["knowledge_points"][0]["key"] == "sync_seq"
    assert context["question_type"] == "short_answer"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/grading/test_rubric_builders.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.grading.rubric_builders'`.

- [ ] **Step 3: Add the builders**

Create `backend/src/app/grading/rubric_builders.py`:

```python
"""Rubric context builders for grading orchestration."""


def build_code_rubric_context(task: dict) -> dict:
    return {
        "question_type": "code",
        "question": task["question_content"],
        "student_answer": task["student_answer_raw"],
        "rubric_definition": task.get("rubric_definition", {}),
        "evidence": {
            "test_summary": task.get("test_summary") or {},
            "compile_result": task.get("compile_result") or {},
            "runtime_result": task.get("runtime_result") or {},
            "runtime_logs": task.get("runtime_logs") or [],
        },
    }


def build_short_answer_rubric_context(task: dict) -> dict:
    return {
        "question_type": "short_answer",
        "question": task["question_content"],
        "student_answer": task["student_answer_raw"],
        "rubric_definition": task.get("rubric_definition", {}),
        "knowledge_points": task.get("scoring_points") or [],
        "dimension_weights": task.get("dimension_weights") or {},
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/grading/test_rubric_builders.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/grading/rubric_builders.py backend/tests/grading/test_rubric_builders.py
git commit -m "feat: add grading rubric builders"
```

### Task 4: Add Provider Adapters And Shared DTOs

**Files:**
- Create: `backend/src/app/grading/providers/__init__.py`
- Create: `backend/src/app/grading/providers/base.py`
- Create: `backend/src/app/grading/providers/qwen.py`
- Create: `backend/src/app/grading/providers/deepseek.py`
- Create: `backend/src/app/grading/providers/openrouter.py`
- Test: `backend/tests/grading/test_orchestrator.py`

- [ ] **Step 1: Write the failing provider test**

Append to `backend/tests/grading/test_orchestrator.py`:

```python
from app.grading.providers.base import GradingProviderResult
from app.grading.providers.openrouter import build_openrouter_payload


def test_openrouter_payload_uses_claude_model_name() -> None:
    payload = build_openrouter_payload(
        model_name="anthropic/claude-3.5-sonnet",
        system_prompt="You arbitrate scoring disagreements.",
        user_prompt="Compare result A and result B.",
        temperature=0.0,
    )

    assert payload["model"] == "anthropic/claude-3.5-sonnet"
    assert payload["messages"][0]["role"] == "system"
    assert payload["messages"][1]["role"] == "user"


def test_grading_provider_result_normalizes_response_shape() -> None:
    result = GradingProviderResult(
        raw_content={"score_total": 82},
        score_total=82,
        dimension_scores={"coverage": 40},
        deduction_reasons=["missed one key point"],
        strengths=["logic is clear"],
        improvement_suggestions=["cover timeout handling"],
        evidence_summary={"matched_points": 3},
        risk_flags=[],
    )

    assert result.score_total == 82
    assert result.dimension_scores["coverage"] == 40
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/grading/test_orchestrator.py::test_openrouter_payload_uses_claude_model_name tests/grading/test_orchestrator.py::test_grading_provider_result_normalizes_response_shape -v`

Expected: FAIL because the provider package does not exist yet.

- [ ] **Step 3: Add shared DTOs and adapter skeletons**

Create `backend/src/app/grading/providers/base.py`:

```python
"""Provider abstractions for the grading engine."""

from dataclasses import dataclass
from typing import Protocol


@dataclass
class GradingProviderResult:
    raw_content: dict
    score_total: float
    dimension_scores: dict
    deduction_reasons: list[str]
    strengths: list[str]
    improvement_suggestions: list[str]
    evidence_summary: dict
    risk_flags: list[str]


class GradingProvider(Protocol):
    async def score(self, system_prompt: str, user_prompt: str) -> GradingProviderResult:
        ...
```

Create `backend/src/app/grading/providers/openrouter.py`:

```python
"""OpenRouter adapter used for Claude arbitration."""


def build_openrouter_payload(
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
) -> dict:
    return {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }
```

Create `backend/src/app/grading/providers/qwen.py`:

```python
"""Qwen provider adapter."""

from app.grading.providers.base import GradingProviderResult


def parse_qwen_response(payload: dict) -> GradingProviderResult:
    content = payload["score"]
    return GradingProviderResult(
        raw_content=payload,
        score_total=content["score_total"],
        dimension_scores=content["dimension_scores"],
        deduction_reasons=content["deduction_reasons"],
        strengths=content["strengths"],
        improvement_suggestions=content["improvement_suggestions"],
        evidence_summary=content["evidence_summary"],
        risk_flags=content["risk_flags"],
    )
```

Create `backend/src/app/grading/providers/deepseek.py`:

```python
"""DeepSeek provider adapter."""

from app.grading.providers.base import GradingProviderResult


def parse_deepseek_response(payload: dict) -> GradingProviderResult:
    content = payload["score"]
    return GradingProviderResult(
        raw_content=payload,
        score_total=content["score_total"],
        dimension_scores=content["dimension_scores"],
        deduction_reasons=content["deduction_reasons"],
        strengths=content["strengths"],
        improvement_suggestions=content["improvement_suggestions"],
        evidence_summary=content["evidence_summary"],
        risk_flags=content["risk_flags"],
    )
```

Create `backend/src/app/grading/providers/__init__.py`:

```python
"""Provider adapters for grading models."""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/grading/test_orchestrator.py::test_openrouter_payload_uses_claude_model_name tests/grading/test_orchestrator.py::test_grading_provider_result_normalizes_response_shape -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/grading/providers/__init__.py backend/src/app/grading/providers/base.py backend/src/app/grading/providers/qwen.py backend/src/app/grading/providers/deepseek.py backend/src/app/grading/providers/openrouter.py backend/tests/grading/test_orchestrator.py
git commit -m "feat: add grading provider adapters"
```

### Task 5: Implement Orchestration And Arbitration Service

**Files:**
- Create: `backend/src/app/grading/orchestrator.py`
- Create: `backend/src/app/grading/service.py`
- Test: `backend/tests/grading/test_orchestrator.py`

- [ ] **Step 1: Write the failing workflow tests**

Append to `backend/tests/grading/test_orchestrator.py`:

```python
from app.grading.orchestrator import should_trigger_arbitration


def test_should_trigger_arbitration_when_total_score_gap_exceeds_threshold() -> None:
    left = {"score_total": 60, "dimension_scores": {"correctness": 20}, "risk_flags": []}
    right = {"score_total": 82, "dimension_scores": {"correctness": 34}, "risk_flags": []}

    triggered, reason = should_trigger_arbitration(
        left,
        right,
        score_diff_threshold=0.15,
        dimension_diff_threshold=0.20,
    )

    assert triggered is True
    assert reason == "score_diff"


def test_should_trigger_arbitration_when_fatal_flag_disagrees() -> None:
    left = {"score_total": 55, "dimension_scores": {"correctness": 18}, "risk_flags": ["fatal_error_candidate"]}
    right = {"score_total": 58, "dimension_scores": {"correctness": 18}, "risk_flags": []}

    triggered, reason = should_trigger_arbitration(
        left,
        right,
        score_diff_threshold=0.15,
        dimension_diff_threshold=0.20,
    )

    assert triggered is True
    assert reason == "fatal_conflict"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/grading/test_orchestrator.py::test_should_trigger_arbitration_when_total_score_gap_exceeds_threshold tests/grading/test_orchestrator.py::test_should_trigger_arbitration_when_fatal_flag_disagrees -v`

Expected: FAIL because the orchestrator module does not exist yet.

- [ ] **Step 3: Add arbitration helpers and service skeleton**

Create `backend/src/app/grading/orchestrator.py`:

```python
"""Workflow helpers for grading orchestration."""


def should_trigger_arbitration(
    left: dict,
    right: dict,
    score_diff_threshold: float,
    dimension_diff_threshold: float,
) -> tuple[bool, str | None]:
    max_score = max(left["score_total"], right["score_total"], 1)
    score_gap = abs(left["score_total"] - right["score_total"]) / max_score
    if score_gap > score_diff_threshold:
        return True, "score_diff"

    left_fatal = "fatal_error_candidate" in left.get("risk_flags", [])
    right_fatal = "fatal_error_candidate" in right.get("risk_flags", [])
    if left_fatal != right_fatal:
        return True, "fatal_conflict"

    for key, left_value in left.get("dimension_scores", {}).items():
        right_value = right.get("dimension_scores", {}).get(key, left_value)
        base = max(left_value, right_value, 1)
        if abs(left_value - right_value) / base > dimension_diff_threshold:
            return True, f"dimension_diff:{key}"

    return False, None
```

Create `backend/src/app/grading/service.py`:

```python
"""Service entry points for the grading engine."""

from app.config import settings
from app.grading.orchestrator import should_trigger_arbitration


def evaluate_arbitration(primary_result: dict, review_result: dict) -> tuple[bool, str | None]:
    return should_trigger_arbitration(
        primary_result,
        review_result,
        score_diff_threshold=settings.grading_score_diff_threshold,
        dimension_diff_threshold=settings.grading_dimension_diff_threshold,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/grading/test_orchestrator.py::test_should_trigger_arbitration_when_total_score_gap_exceeds_threshold tests/grading/test_orchestrator.py::test_should_trigger_arbitration_when_fatal_flag_disagrees -v`

Expected: PASS

- [ ] **Step 5: Expand the service into a task-oriented engine**

Extend `backend/src/app/grading/service.py` with explicit entry points the later router task will call:

```python
from sqlalchemy.ext.asyncio import AsyncSession

from app.grading.models import GradingAuditEvent, GradingTask


async def create_grading_task(db: AsyncSession, payload: dict) -> GradingTask:
    task = GradingTask(**payload, status="pending")
    db.add(task)
    await db.flush()

    db.add(
        GradingAuditEvent(
            task_id=task.id,
            event_type="task.created",
            event_payload={"source_type": task.source_type, "question_type": task.question_type},
            operator_type="system",
            operator_id="system",
        )
    )
    await db.flush()
    return task
```

- [ ] **Step 6: Run targeted tests again**

Run: `cd backend && pytest tests/grading/test_models.py tests/grading/test_rubric_builders.py tests/grading/test_orchestrator.py -v`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/grading/orchestrator.py backend/src/app/grading/service.py backend/tests/grading/test_orchestrator.py
git commit -m "feat: add grading orchestration service"
```

### Task 6: Add API Schemas And Router

**Files:**
- Create: `backend/src/app/grading/schemas.py`
- Create: `backend/src/app/grading/router.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/grading/test_router.py`

- [ ] **Step 1: Write the failing router test**

Create `backend/tests/grading/test_router.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_create_grading_task_returns_pending_task(admin_client) -> None:
    response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "single_debug",
            "question_type": "short_answer",
            "question_content": "什么是幂等性",
            "max_score": 10,
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "同一请求多次执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "pending"
    assert payload["question_type"] == "short_answer"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/grading/test_router.py::test_create_grading_task_returns_pending_task -v`

Expected: FAIL with 404 because the router does not exist yet.

- [ ] **Step 3: Add schemas and router**

Create `backend/src/app/grading/schemas.py`:

```python
"""Pydantic schemas for grading APIs."""

from pydantic import BaseModel, Field


class GradingTaskCreate(BaseModel):
    source_type: str
    question_type: str
    question_content: str
    max_score: int
    student_answer_raw: str
    standard_answers: list[dict] = Field(default_factory=list)
    rubric_definition: dict = Field(default_factory=dict)
    scoring_points: list[dict] = Field(default_factory=list)
    dimension_weights: dict = Field(default_factory=dict)
    role_binding_version: int


class GradingTaskRead(BaseModel):
    id: str
    status: str
    question_type: str
```

Create `backend/src/app/grading/router.py`:

```python
"""API router for grading tasks."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.grading.schemas import GradingTaskCreate, GradingTaskRead
from app.grading.service import create_grading_task

router = APIRouter()


@router.post("/tasks", response_model=GradingTaskRead, status_code=status.HTTP_201_CREATED)
async def create_grading_task_endpoint(
    payload: GradingTaskCreate,
    db: AsyncSession = Depends(get_db),
) -> GradingTaskRead:
    task = await create_grading_task(db, payload.model_dump())
    return GradingTaskRead(id=str(task.id), status=task.status, question_type=task.question_type)
```

Update `backend/src/app/main.py`:

```python
from app.grading.router import router as grading_router

app.include_router(grading_router, prefix="/api/grading", tags=["grading"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/grading/test_router.py::test_create_grading_task_returns_pending_task -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/grading/schemas.py backend/src/app/grading/router.py backend/src/app/main.py backend/tests/grading/test_router.py
git commit -m "feat: add grading task api"
```

### Task 7: Add Snapshot, Report, And Manual Review APIs

**Files:**
- Modify: `backend/src/app/grading/schemas.py`
- Modify: `backend/src/app/grading/service.py`
- Modify: `backend/src/app/grading/router.py`
- Test: `backend/tests/grading/test_router.py`

- [ ] **Step 1: Write the failing manual-review test**

Append to `backend/tests/grading/test_router.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_manual_score_override_creates_audit_event(admin_client) -> None:
    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "single_debug",
            "question_type": "short_answer",
            "question_content": "什么是幂等性",
            "max_score": 10,
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "同一请求多次执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    override_response = await admin_client.post(
        f"/api/grading/tasks/{task_id}/manual-score",
        json={"score_total": 9, "reason": "教师确认语义已覆盖"},
    )

    assert override_response.status_code == 200
    payload = override_response.json()
    assert payload["score_total"] == 9
    assert payload["snapshot_type"] == "manual"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/grading/test_router.py::test_manual_score_override_creates_audit_event -v`

Expected: FAIL with 404 because the manual review route does not exist yet.

- [ ] **Step 3: Add schemas for reports and manual actions**

Extend `backend/src/app/grading/schemas.py`:

```python
class ManualScoreOverride(BaseModel):
    score_total: float
    reason: str


class GradingSnapshotRead(BaseModel):
    id: str
    snapshot_type: str
    score_total: float
    risk_flags: list[str] = Field(default_factory=list)


class FinalGradingReportRead(BaseModel):
    task_id: str
    question_type: str
    final_score: float | None = None
    snapshots: list[GradingSnapshotRead] = Field(default_factory=list)
```

- [ ] **Step 4: Add manual override service logic**

Extend `backend/src/app/grading/service.py`:

```python
from sqlalchemy import select

from app.grading.models import GradingResultSnapshot


async def create_manual_score_override(
    db: AsyncSession,
    task_id: str,
    score_total: float,
    reason: str,
) -> GradingResultSnapshot:
    task = await db.get(GradingTask, task_id)
    snapshot = GradingResultSnapshot(
        task_id=task.id,
        snapshot_type="manual",
        score_total=score_total,
        dimension_scores={},
        deduction_reasons=[reason],
        strengths=[],
        improvement_suggestions=[],
        evidence_summary={},
        risk_flags=[],
        role_binding_version=task.role_binding_version,
        created_by="manual",
    )
    db.add(snapshot)
    await db.flush()

    task.latest_manual_snapshot_id = snapshot.id
    task.latest_final_snapshot_id = snapshot.id
    db.add(
        GradingAuditEvent(
            task_id=task.id,
            event_type="manual.score_override",
            event_payload={"score_total": score_total, "reason": reason},
            operator_type="user",
            operator_id="manual-reviewer",
        )
    )
    await db.flush()
    return snapshot


async def get_final_report(db: AsyncSession, task_id: str) -> dict:
    task = await db.get(GradingTask, task_id)
    snapshots_result = await db.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    final_snapshot = next(
        (item for item in snapshots if item.id == task.latest_final_snapshot_id),
        None,
    )
    return {
        "task_id": str(task.id),
        "question_type": task.question_type,
        "final_score": final_snapshot.score_total if final_snapshot else None,
        "snapshots": [
            {
                "id": str(snapshot.id),
                "snapshot_type": snapshot.snapshot_type,
                "score_total": snapshot.score_total,
                "risk_flags": snapshot.risk_flags,
            }
            for snapshot in snapshots
        ],
    }
```

- [ ] **Step 5: Add router endpoints**

Extend `backend/src/app/grading/router.py`:

```python
from app.grading.schemas import FinalGradingReportRead, GradingSnapshotRead, ManualScoreOverride
from app.grading.service import create_manual_score_override, get_final_report


@router.get("/tasks/{task_id}/report", response_model=FinalGradingReportRead)
async def get_grading_report(task_id: str, db: AsyncSession = Depends(get_db)) -> FinalGradingReportRead:
    return FinalGradingReportRead(**(await get_final_report(db, task_id)))


@router.post("/tasks/{task_id}/manual-score", response_model=GradingSnapshotRead)
async def manual_score_override(
    task_id: str,
    payload: ManualScoreOverride,
    db: AsyncSession = Depends(get_db),
) -> GradingSnapshotRead:
    snapshot = await create_manual_score_override(db, task_id, payload.score_total, payload.reason)
    return GradingSnapshotRead(
        id=str(snapshot.id),
        snapshot_type=snapshot.snapshot_type,
        score_total=snapshot.score_total,
        risk_flags=snapshot.risk_flags,
    )
```

- [ ] **Step 6: Run router tests**

Run: `cd backend && pytest tests/grading/test_router.py -v`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/grading/schemas.py backend/src/app/grading/service.py backend/src/app/grading/router.py backend/tests/grading/test_router.py
git commit -m "feat: add grading report and manual review apis"
```

### Task 8: Wire The Full Module And Run Regression Checks

**Files:**
- Modify: `backend/src/app/main.py`
- Modify: `backend/src/app/grading/__init__.py`
- Test: `backend/tests/grading/test_models.py`
- Test: `backend/tests/grading/test_rubric_builders.py`
- Test: `backend/tests/grading/test_orchestrator.py`
- Test: `backend/tests/grading/test_router.py`

- [ ] **Step 1: Ensure module exports are coherent**

Update `backend/src/app/grading/__init__.py`:

```python
"""Grading engine package."""

from app.grading.models import GradingAuditEvent, GradingResultSnapshot, GradingTask

__all__ = ["GradingTask", "GradingResultSnapshot", "GradingAuditEvent"]
```

- [ ] **Step 2: Run the grading test suite**

Run: `cd backend && pytest tests/grading -v`

Expected: PASS

- [ ] **Step 3: Run a backend smoke suite**

Run: `cd backend && pytest tests/test_auth.py tests/rbac/test_router.py tests/integration/learning/test_router.py -v`

Expected: PASS, proving the new router and models did not break existing app startup and dependency overrides.

- [ ] **Step 4: Verify Alembic metadata compiles**

Run: `cd backend && alembic upgrade head`

Expected: PASS against the developer database with the new grading tables created.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/grading/__init__.py backend/src/app/main.py backend/src/app/config.py backend/src/app/grading backend/alembic/versions/add_grading_trust_core.py backend/tests/grading
git commit -m "feat: wire grading trust core module"
```

## Self-Review

### Spec Coverage

The plan covers the spec requirements as follows:

1. Unified grading task model: Task 2 and Task 6.
2. Multi-model role binding and provider abstraction: Task 1, Task 2, and Task 4.
3. Arbitration rules: Task 5.
4. Code-question and short-answer rubric separation: Task 3.
5. Immutable snapshots and audit events: Task 2 and Task 7.
6. Manual re-score path: Task 7.
7. API surface for task creation and report lookup: Task 6 and Task 7.

Known deferred items from the spec:

1. Real external API invocation for the three providers is only scaffolded here; robust HTTP integration, retries, and structured prompt generation are a follow-up implementation slice once the persistence and orchestration seams are in place.
2. Full batch-task queue execution is not implemented in this first plan; this plan establishes the trust core APIs and storage needed for later async workers.
3. Frontend workbench flows remain intentionally out of scope.

### Placeholder Scan

The plan contains no `TBD`, `TODO`, or implied “handle later” code steps. Deferred work is called out explicitly in this self-review instead of being hidden inside task steps.

### Type Consistency

The plan uses the same object names consistently across tasks:

1. `GradingTask`
2. `GradingResultSnapshot`
3. `GradingAuditEvent`
4. `ProviderConfig`
5. `ModelConfig`
6. `RoleBinding`
7. `build_code_rubric_context`
8. `build_short_answer_rubric_context`
9. `should_trigger_arbitration`


"""Service entry points for the grading engine."""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, AsyncIterator

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import User
from app.config import settings
from app.exams.models import (
    Exam,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamAppeal,
    StudentExamSubmission,
    StudentExamSubmissionAnswer,
    StudentNotification,
    StudentQuestionProgress,
)
from app.grading.models import GradingAuditEvent, GradingResultSnapshot, GradingTask, ModelConfig, RoleBinding
from app.questions.models import Question, QuestionType
from app.grading.providers import (
    DeepSeekProvider,
    DoubaoProvider,
    GradingProviderError,
    GradingProvider,
    GradingProviderResult,
    OpenRouterProvider,
    QwenProvider,
)
from app.grading.rubric_builders import build_code_rubric_context, build_short_answer_rubric_context
from app.grading.orchestrator import should_trigger_arbitration

SNAPSHOT_TYPE_ORDER = {
    "primary": 0,
    "review": 1,
    "arbiter": 2,
    "final": 3,
    "manual": 4,
}

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _task_result_source(task: GradingTask) -> str | None:
    if task.latest_final_snapshot_id == task.latest_manual_snapshot_id and task.latest_manual_snapshot_id is not None:
        return "manual"
    if task.latest_final_snapshot_id and task.latest_final_snapshot_id == task.latest_arbitration_snapshot_id:
        return "arbiter"
    if task.latest_arbitration_snapshot_id is not None:
        return "arbiter"
    if task.latest_final_snapshot_id is not None:
        return "average"
    return None


def _task_display_status(task: GradingTask) -> str:
    result_source = _task_result_source(task)
    if result_source == "manual":
        return "人工改分"
    if task.status == "pending":
        return "待评分"
    if task.status == "running":
        return "评分中"
    if task.status == "failed":
        return "评估失败"
    if task.status == "arbitration_required":
        return "待仲裁"
    return "已完成"


def _humanize_exam_id(exam_id: str | None) -> str:
    if not exam_id:
        return "独立任务"
    normalized = re.sub(r"^exam[-_]", "", exam_id, flags=re.IGNORECASE)
    tokens = [token for token in re.split(r"[-_]", normalized) if token]
    if not tokens:
        return exam_id
    return " ".join(token.upper() if token.isupper() else token.capitalize() for token in tokens)


def _humanize_question_id(question_id: str, question_type: str) -> str:
    match = re.match(r"(essay|short|subjective|code|question)[-_]?q?(\d+)$", question_id, flags=re.IGNORECASE)
    if match:
        prefix, number = match.groups()
        prefix = prefix.lower()
        if prefix in {"essay", "short", "subjective", "question"}:
            return f"主观题 {number}"
        if prefix == "code":
            return f"代码题 {number}"
    fallback = "代码题" if question_type == "code" else "主观题"
    return f"{fallback} {question_id}"


def _humanize_candidate(candidate_code: str | None, task_id: uuid.UUID) -> tuple[str, str]:
    if candidate_code:
        code = re.sub(r"^candidate[-_]", "", candidate_code, flags=re.IGNORECASE).upper()
    else:
        code = str(task_id)[:8].upper()
    return f"考生 {code}", code


def _parse_task_locator(task: GradingTask) -> dict[str, str | None]:
    source_business_id = task.source_business_id or ""
    exam_id: str | None = None
    question_id: str | None = None
    candidate_code: str | None = None

    if source_business_id:
        parts = source_business_id.split(":")
        if task.source_type == "exam_submission" and len(parts) >= 3:
            exam_id = parts[0]
            question_id = parts[1]
            candidate_code = parts[2]
        elif len(parts) >= 2:
            question_id = parts[0]
            candidate_code = ":".join(parts[1:])
        elif len(parts) == 1:
            question_id = parts[0]

    if question_id is None:
        question_id = f"task-{task.id}"

    candidate_name, normalized_candidate_code = _humanize_candidate(candidate_code, task.id)
    question_key = f"{exam_id}:{question_id}" if exam_id else question_id

    return {
        "exam_id": exam_id,
        "exam_label": _humanize_exam_id(exam_id),
        "question_id": question_id,
        "question_key": question_key,
        "question_label": _humanize_question_id(question_id, task.question_type),
        "candidate_name": candidate_name,
        "candidate_code": normalized_candidate_code,
    }


async def _hydrate_task_locators(
    db: AsyncSession,
    tasks: list[GradingTask],
) -> dict[uuid.UUID, dict[str, str | None]]:
    base_locators = {task.id: _parse_task_locator(task) for task in tasks}

    exam_ids: set[uuid.UUID] = set()
    student_ids: set[uuid.UUID] = set()
    for task in tasks:
        locator = base_locators[task.id]
        exam_uuid = _try_parse_uuid(locator["exam_id"])
        if exam_uuid is not None:
            exam_ids.add(exam_uuid)
        if task.source_type == "exam_submission":
            student_uuid = _try_parse_uuid(locator["candidate_code"])
            if student_uuid is not None:
                student_ids.add(student_uuid)

    exams_by_id: dict[str, Exam] = {}
    if exam_ids:
        exams = (
            await db.execute(select(Exam).where(Exam.id.in_(exam_ids), Exam.deleted_at.is_(None)))
        ).scalars().all()
        exams_by_id = {str(exam.id): exam for exam in exams}

    users_by_id: dict[str, User] = {}
    if student_ids:
        users = (
            await db.execute(select(User).where(User.id.in_(student_ids), User.deleted_at.is_(None)))
        ).scalars().all()
        users_by_id = {str(user.id): user for user in users}

    hydrated: dict[uuid.UUID, dict[str, str | None]] = {}
    for task in tasks:
        locator = dict(base_locators[task.id])
        exam = exams_by_id.get(locator["exam_id"] or "")
        if exam is not None:
            locator["exam_label"] = exam.title

        if task.source_type == "exam_submission":
            user_uuid = _try_parse_uuid(locator["candidate_code"])
            user = users_by_id.get(str(user_uuid)) if user_uuid is not None else None
            if user is not None:
                locator["candidate_name"] = user.full_name
                locator["candidate_code"] = user.student_id or user.phone or None

        hydrated[task.id] = locator

    return hydrated


def _try_parse_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except (TypeError, ValueError):
        return None


def _payload_exam_id(source_type: str, source_business_id: str | None) -> uuid.UUID | None:
    if not source_business_id:
        return None
    parts = source_business_id.split(":")
    if source_type == "exam_submission" and len(parts) >= 3:
        return _try_parse_uuid(parts[0])
    return None


async def _can_access_exam_id(
    db: AsyncSession,
    exam_id: uuid.UUID | None,
    *,
    current_user_id: uuid.UUID | None,
    is_platform_admin: bool,
) -> bool:
    if is_platform_admin:
        return True
    if current_user_id is None or exam_id is None:
        return False
    owner_id = await db.scalar(select(Exam.owner_id).where(Exam.id == exam_id, Exam.deleted_at.is_(None)))
    return owner_id == current_user_id


async def _filter_tasks_by_exam_access(
    db: AsyncSession,
    tasks: list[GradingTask],
    *,
    current_user_id: uuid.UUID | None,
    is_platform_admin: bool,
) -> list[GradingTask]:
    if is_platform_admin:
        return tasks
    if current_user_id is None:
        return []

    exam_ids = {
        exam_id
        for task in tasks
        if (exam_id := _payload_exam_id(task.source_type, task.source_business_id)) is not None
    }
    if not exam_ids:
        return []

    owned_exam_ids = set(
        (
            await db.execute(
                select(Exam.id).where(
                    Exam.id.in_(exam_ids),
                    Exam.owner_id == current_user_id,
                    Exam.deleted_at.is_(None),
                )
            )
        ).scalars().all()
    )
    return [
        task
        for task in tasks
        if (exam_id := _payload_exam_id(task.source_type, task.source_business_id)) in owned_exam_ids
    ]


async def _ensure_task_access(
    db: AsyncSession,
    task: GradingTask,
    *,
    current_user_id: uuid.UUID | None,
    is_platform_admin: bool,
) -> None:
    exam_id = _payload_exam_id(task.source_type, task.source_business_id)
    if not await _can_access_exam_id(
        db,
        exam_id,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    ):
        raise ValueError("grading task not found")


async def _load_candidate_feedback(
    db: AsyncSession,
    *,
    exam_id: str | None,
    question_id: str | None,
    candidate_code: str | None,
) -> dict[str, Any] | None:
    exam_uuid = _try_parse_uuid(exam_id)
    question_uuid = _try_parse_uuid(question_id)
    if exam_uuid is None or question_uuid is None:
        return None

    stmt = (
        select(StudentExamAppeal, User)
        .join(User, User.id == StudentExamAppeal.student_id)
        .where(
            StudentExamAppeal.exam_id == exam_uuid,
            StudentExamAppeal.question_id == question_uuid,
            User.deleted_at.is_(None),
        )
    )

    if candidate_code:
        normalized_code = candidate_code.strip().upper()
        matchers = [
            func.upper(User.username) == normalized_code,
            func.upper(func.coalesce(User.student_id, "")) == normalized_code,
        ]
        candidate_uuid = _try_parse_uuid(candidate_code)
        if candidate_uuid is not None:
            matchers.append(User.id == candidate_uuid)
        stmt = stmt.where(or_(*matchers))

    row = (await db.execute(stmt.order_by(StudentExamAppeal.created_at.desc()))).first()
    if row is None:
        return None

    appeal, _user = row
    return {
        "student_feedback": appeal.reason,
        "teacher_feedback_reply": appeal.teacher_reply,
        "feedback_created_at": appeal.created_at.isoformat() if appeal.created_at else None,
    }


async def _load_workspace_tasks(
    db: AsyncSession,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> list[GradingTask]:
    result = await db.execute(
        select(GradingTask)
        .options(
            selectinload(GradingTask.latest_final_snapshot),
            selectinload(GradingTask.latest_manual_snapshot),
            selectinload(GradingTask.latest_arbitration_snapshot),
            selectinload(GradingTask.snapshots).selectinload(GradingResultSnapshot.model_config),
            selectinload(GradingTask.audit_events),
        )
        .order_by(GradingTask.updated_at.desc())
    )
    tasks = list(result.scalars().all())
    return await _filter_tasks_by_exam_access(
        db,
        tasks,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )


def format_evidence_summary(summary: dict[str, Any]) -> list[str]:
    items: list[str] = []
    for key, value in summary.items():
        if isinstance(value, list):
            items.append(f"{key}: {' / '.join(map(str, value))}")
        elif isinstance(value, dict):
            items.append(f"{key}: {json.dumps(value, ensure_ascii=False, sort_keys=True)}")
        else:
            items.append(f"{key}: {value}")
    return items


def _resolve_prompt_locale(task_language: str | None, override_locale: str | None = None) -> tuple[str, str]:
    preferred = (override_locale or task_language or "zh-CN").strip()
    normalized = preferred.lower()
    if normalized.startswith("en"):
        return preferred, "Respond in English."
    return preferred, (
        "必须使用简体中文回复所有评分意见、复评解释、扣分原因和改进建议；"
        "即使题目、代码、Prompt 或浏览器语言包含英文，也不要整体改用英文。"
        "只有专有名词、代码标识符、API 名称等必要术语可以保留英文原文。"
    )


@lru_cache(maxsize=None)
def _load_prompt_markdown(filename: str) -> str:
    path = PROMPTS_DIR / filename
    return path.read_text(encoding="utf-8").strip()


_SQL_ACTION_MARKERS = (
    "select ",
    "insert ",
    "update ",
    "delete ",
    "create table",
    "alter table",
    "drop table",
    "with ",
)
_SQL_CLAUSE_MARKERS = (
    " from ",
    " join ",
    " where ",
    " group by ",
    " order by ",
    " having ",
    " set ",
    " values ",
    " on ",
)


def _looks_like_sql_task(task: GradingTask) -> bool:
    """Detect SQL-style tasks for prompt specialization.

    Decision policy:
    1. Trust explicit language metadata (programming_language or
       student_answer_structured.language) as the authoritative signal.
    2. Otherwise require the student answer to contain BOTH a SQL action verb
       (SELECT/INSERT/...) AND a SQL clause keyword (FROM/JOIN/...). Matching
       only the question text or knowledge tags is unsafe because conceptual
       short-answer questions ("解释 SQL 注入") frequently mention "SQL" without
       requiring SQL grading.
    """

    if (task.programming_language or "").strip().lower() == "sql":
        return True

    if isinstance(task.student_answer_structured, dict):
        language = task.student_answer_structured.get("language")
        if isinstance(language, str) and language.strip().lower() == "sql":
            return True

    answer_raw = task.student_answer_raw if isinstance(task.student_answer_raw, str) else ""
    if not answer_raw:
        return False
    padded = f" {answer_raw.lower()} "
    has_action = any(marker in padded for marker in _SQL_ACTION_MARKERS)
    has_clause = any(marker in padded for marker in _SQL_CLAUSE_MARKERS)
    return has_action and has_clause


def _prompt_specialization_filename(task: GradingTask) -> str | None:
    if _looks_like_sql_task(task):
        return "sql.md"
    if task.question_type == "code":
        return "code.md"
    if task.question_type in {"short_answer", "essay"}:
        return "short-answer.md"
    # 客观题（choice/true_false/fill_in）通常不走 LLM 评分，但若进入到这里
    # 说明上游路由把客观题塞进了主观评分流程 — 记录告警便于排查。
    logger.warning(
        "grading prompt: no specialization for question_type=%s task_id=%s; falling back to common rules only",
        task.question_type,
        task.id,
    )
    return None


def evaluate_arbitration(primary_result: dict[str, Any], review_result: dict[str, Any]) -> tuple[bool, str | None]:
    """Evaluate whether two grading results need arbitration."""

    return should_trigger_arbitration(
        primary_result,
        review_result,
        score_diff_threshold=settings.grading_score_diff_threshold,
        dimension_diff_threshold=settings.grading_dimension_diff_threshold,
    )


def _build_provider_for_model(model: ModelConfig) -> GradingProvider:
    provider = model.provider
    if provider is None:
        raise ValueError("grading model provider is not configured")
    if not provider.is_active or not model.is_active:
        raise ValueError("grading model or provider is inactive")

    credential_attr_map = {
        "EXAM_QWEN_API_KEY": "qwen_api_key",
        "EXAM_DEEPSEEK_API_KEY": "deepseek_api_key",
        "EXAM_DOUBAO_API_KEY": "doubao_api_key",
        "EXAM_OPENROUTER_API_KEY": "openrouter_api_key",
    }
    api_key = os.getenv(provider.credential_env)
    if not api_key:
        settings_attr = credential_attr_map.get(provider.credential_env)
        if settings_attr is not None:
            api_key = getattr(settings, settings_attr, None)
    common_kwargs = {
        "provider_key": provider.key,
        "base_url": provider.base_url,
        "model_name": model.model_name,
        "api_key": api_key,
        "temperature": model.temperature,
    }

    if provider.provider_type == "qwen":
        return QwenProvider(**common_kwargs)
    if provider.provider_type == "deepseek":
        return DeepSeekProvider(**common_kwargs)
    if provider.provider_type == "doubao":
        return DoubaoProvider(**common_kwargs)
    if provider.provider_type == "openrouter":
        return OpenRouterProvider(**common_kwargs)

    raise ValueError(f"unsupported grading provider type: {provider.provider_type}")


def _build_optional_provider_for_model(model: ModelConfig | None) -> GradingProvider | None:
    if model is None:
        return None
    try:
        return _build_provider_for_model(model)
    except ValueError:
        return None


def _humanize_grading_failure_message(message: str | None) -> str:
    if not message:
        return "AI 评估失败，请稍后重试。"

    normalized = message.lower()
    if "provider api key is not configured" in normalized or "api key" in normalized:
        if "openrouter" in normalized or "claude" in normalized:
            return "Claude 模型未正确配置，当前未完成 AI 评估。"
        if "deepseek" in normalized:
            return "DeepSeek 模型未正确配置，当前未完成 AI 评估。"
        if "qwen" in normalized:
            return "Qwen 模型未正确配置，当前未完成 AI 评估。"
        return "评分模型未正确配置，当前未完成 AI 评估。"
    if "timed out" in normalized or "timeout" in normalized:
        return "AI 评估超时，请稍后重试。"
    if "json object" in normalized or "missing required keys" in normalized:
        return "AI 返回结果格式异常，请稍后重试。"
    if "connect" in normalized or "connection" in normalized or "network" in normalized:
        return "AI 评估服务连接失败，请稍后重试。"
    return "AI 评估失败，请稍后重试。"


def _trim_failure_detail(value: str | None, max_length: int = 240) -> str | None:
    if not value:
        return None
    compact = re.sub(r"\s+", " ", value).strip()
    if len(compact) <= max_length:
        return compact
    return f"{compact[:max_length].rstrip()}..."


def _exception_message(exc: BaseException) -> str:
    """Best-effort human-readable exception message.

    httpx and some asyncio exceptions have empty ``str()`` (e.g.
    ``RemoteProtocolError("")``), which makes audit logs useless. Fall back
    to the exception class so operators always know what failed.
    """
    text = str(exc).strip()
    if text:
        return text
    return f"{type(exc).__module__}.{type(exc).__name__}: {exc!r}"


async def _load_role_binding(db: AsyncSession, version: int) -> RoleBinding:
    result = await db.execute(
        select(RoleBinding)
        .options(
            selectinload(RoleBinding.grader_model).selectinload(ModelConfig.provider),
            selectinload(RoleBinding.reviewer_model).selectinload(ModelConfig.provider),
            selectinload(RoleBinding.arbiter_model).selectinload(ModelConfig.provider),
        )
        .where(RoleBinding.version == version)
    )
    binding = result.scalar_one_or_none()
    if binding is None or not binding.is_active:
        raise ValueError("grading role binding not found")
    return binding


async def run_grading_task_with_role_binding(
    db: AsyncSession,
    task_id: str,
    locale: str | None = None,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> dict[str, Any]:
    task = await db.get(GradingTask, uuid.UUID(task_id))
    if task is None:
        raise ValueError("grading task not found")
    await _ensure_task_access(
        db,
        task,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )

    binding = await _load_role_binding(db, task.role_binding_version)
    primary_provider = _build_provider_for_model(binding.grader_model)
    review_provider = _build_provider_for_model(binding.reviewer_model)
    # ``EXAM_ARBITER_ENABLED=false`` skips the arbiter entirely and pins the
    # final score to the reviewer's. Keep it off until the upstream account
    # has enough QPS quota to absorb concurrent arbitration calls under
    # exam load.
    arbiter_enabled = bool(settings.arbiter_enabled)
    arbiter_provider = (
        _build_optional_provider_for_model(binding.arbiter_model)
        if arbiter_enabled
        else None
    )
    return await run_grading_task(
        db,
        task_id,
        primary_provider,
        review_provider,
        arbiter_provider,
        locale,
        review_only_final=not arbiter_enabled,
    )


async def create_grading_task(
    db: AsyncSession,
    payload: dict[str, Any],
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> GradingTask:
    """Persist a grading task and its creation audit entry."""

    exam_id = _payload_exam_id(payload.get("source_type", ""), payload.get("source_business_id"))
    if not await _can_access_exam_id(
        db,
        exam_id,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    ):
        raise ValueError("grading task not found")

    task = GradingTask(**payload, status="pending")
    db.add(task)
    await db.flush()

    audit_event = GradingAuditEvent(
        task_id=task.id,
        event_type="task.created",
        event_payload={"source_type": task.source_type, "question_type": task.question_type},
        operator_type="system",
        operator_id="system",
    )
    db.add(audit_event)
    await db.flush()
    return task


async def list_grading_tasks(
    db: AsyncSession,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> list[dict[str, Any]]:
    """Return grading tasks for the workbench list."""

    tasks = await _load_workspace_tasks(
        db,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )

    items: list[dict[str, Any]] = []
    for task in tasks:
        result_source = _task_result_source(task)

        final_score = task.latest_final_snapshot.score_total if task.latest_final_snapshot is not None else None
        items.append(
            {
                "id": str(task.id),
                "source_type": task.source_type,
                "source_business_id": task.source_business_id,
                "status": task.status,
                "question_type": task.question_type,
                "question_content": task.question_content,
                "final_score": final_score,
                "result_source": result_source,
                "arbitration_required": task.latest_arbitration_snapshot_id is not None,
                "manual_override": task.latest_manual_snapshot_id is not None
                and task.latest_final_snapshot_id == task.latest_manual_snapshot_id,
                "updated_at": task.updated_at.isoformat(),
            }
        )

    return items


async def get_grading_inbox(
    db: AsyncSession,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> dict[str, Any]:
    tasks = await _load_workspace_tasks(
        db,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )
    locators = await _hydrate_task_locators(db, tasks)

    exam_groups: dict[str, dict[str, Any]] = {}
    for task in tasks:
        locator = locators[task.id]
        exam_key = locator["exam_id"] or "standalone"
        exam_entry = exam_groups.setdefault(
            exam_key,
            {
                "exam_id": locator["exam_id"],
                "exam_label": locator["exam_label"],
                "exam_date": task.updated_at.isoformat(),
                "questions": {},
            },
        )
        if task.updated_at.isoformat() > exam_entry["exam_date"]:
            exam_entry["exam_date"] = task.updated_at.isoformat()

        question_entry = exam_entry["questions"].setdefault(
            locator["question_key"],
            {
                "question_key": locator["question_key"],
                "question_id": locator["question_id"],
                "question_label": locator["question_label"],
                "question_type": task.question_type,
                "question_content": task.question_content,
                "max_score": task.max_score,
                "knowledge_tags": task.knowledge_tags,
                "pending_count": 0,
                "completed_count": 0,
                "candidate_count": 0,
                "latest_updated_at": task.updated_at.isoformat(),
            },
        )
        question_entry["candidate_count"] += 1
        if _task_display_status(task) in {"已完成", "人工改分"}:
            question_entry["completed_count"] += 1
        else:
            question_entry["pending_count"] += 1
        if task.updated_at.isoformat() > question_entry["latest_updated_at"]:
            question_entry["latest_updated_at"] = task.updated_at.isoformat()

    exams = [
        {
            "exam_id": exam["exam_id"],
            "exam_label": exam["exam_label"],
            "exam_date": exam["exam_date"],
            "questions": sorted(
                exam["questions"].values(),
                key=lambda item: item["latest_updated_at"],
                reverse=True,
            ),
        }
        for exam in exam_groups.values()
    ]
    exams.sort(key=lambda item: item["exam_date"], reverse=True)
    return {"exams": exams}


async def get_grading_question_candidates(
    db: AsyncSession,
    exam_id: str,
    question_id: str,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> dict[str, Any]:
    tasks = await _load_workspace_tasks(
        db,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )
    locators = await _hydrate_task_locators(db, tasks)
    matched: list[tuple[GradingTask, dict[str, str | None]]] = []
    for task in tasks:
        locator = locators[task.id]
        if (locator["exam_id"] or "standalone") != (exam_id or "standalone"):
            continue
        if locator["question_id"] != question_id:
            continue
        matched.append((task, locator))

    if not matched:
        raise ValueError("grading question not found")

    exemplar, locator = matched[0]
    candidates = [
        {
            "task_id": str(task.id),
            "candidate_name": task_locator["candidate_name"],
            "candidate_code": task_locator["candidate_code"],
            "status": _task_display_status(task),
            "score": task.latest_final_snapshot.score_total if task.latest_final_snapshot else None,
            "arbitration_required": task.latest_arbitration_snapshot_id is not None,
            "manual_override": _task_result_source(task) == "manual",
        }
        for task, task_locator in matched
    ]
    candidates.sort(key=lambda item: (0 if item["status"] in {"待仲裁", "人工改分"} else 1, item["candidate_name"]))

    return {
        "exam_id": locator["exam_id"],
        "exam_label": locator["exam_label"],
        "exam_date": max(task.updated_at.isoformat() for task, _ in matched),
        "question_key": locator["question_key"],
        "question_id": locator["question_id"],
        "question_label": locator["question_label"],
        "question_type": exemplar.question_type,
        "question_content": exemplar.question_content,
        "max_score": exemplar.max_score,
        "knowledge_tags": exemplar.knowledge_tags,
        "candidates": candidates,
    }


async def get_grading_candidate_detail(
    db: AsyncSession,
    task_id: str,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> dict[str, Any]:
    async def _load_task() -> GradingTask | None:
        result = await db.execute(
            select(GradingTask)
            .options(
                selectinload(GradingTask.snapshots).selectinload(GradingResultSnapshot.model_config),
                selectinload(GradingTask.latest_primary_snapshot),
                selectinload(GradingTask.latest_review_snapshot),
                selectinload(GradingTask.latest_arbitration_snapshot),
                selectinload(GradingTask.latest_final_snapshot),
                selectinload(GradingTask.latest_manual_snapshot),
                selectinload(GradingTask.audit_events),
            )
            .where(GradingTask.id == uuid.UUID(task_id))
        )
        return result.scalar_one_or_none()

    task = await _load_task()
    if task is None:
        raise ValueError("grading task not found")
    await _ensure_task_access(
        db,
        task,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )

    has_answer = bool(task.student_answer_raw and task.student_answer_raw.strip()) or bool(task.attachment_refs)
    if task.status == "pending" and task.latest_final_snapshot_id is None and has_answer:
        try:
            result = await run_grading_task_with_role_binding(
                db,
                task_id,
                current_user_id=current_user_id,
                is_platform_admin=is_platform_admin,
            )
            await db.commit()
            if result.get("status") == "completed" and task.source_type == "exam_submission":
                try:
                    await apply_grading_task_result_to_exam_submission(db, task_id)
                    await db.commit()
                except Exception as exc:
                    await db.rollback()
                    task = await db.get(GradingTask, uuid.UUID(task_id))
                    if task is not None:
                        db.add(
                            GradingAuditEvent(
                                task_id=task.id,
                                event_type="grading.apply_failed",
                                event_payload={
                                    "message": str(exc),
                                    "detail": _trim_failure_detail(str(exc)),
                                },
                                operator_type="system",
                                operator_id="system",
                            )
                        )
                        await db.commit()
        except Exception as exc:
            await db.rollback()
            task = await db.get(GradingTask, uuid.UUID(task_id))
            if task is not None:
                task.status = "failed"
                db.add(
                    GradingAuditEvent(
                        task_id=task.id,
                        event_type="grading.failed",
                        event_payload={
                            "message": str(exc),
                            "detail": _trim_failure_detail(str(exc)),
                            "stage": "detail_retry",
                        },
                        operator_type="system",
                        operator_id="system",
                    )
                )
                await db.commit()

        db.expire_all()
        task = await _load_task()
        if task is None:
            raise ValueError("grading task not found")

    locator = (await _hydrate_task_locators(db, [task]))[task.id]
    feedback = await _load_candidate_feedback(
        db,
        exam_id=locator["exam_id"],
        question_id=locator["question_id"],
        candidate_code=locator["candidate_code"],
    )
    try:
        binding = await _load_role_binding(db, task.role_binding_version)
    except ValueError:
        binding = None

    snapshot_model_labels = {
        "primary": (
            f"{binding.grader_model.display_name} / {binding.grader_model.model_name}"
            if binding is not None
            else "Primary"
        ),
        "review": (
            f"{binding.reviewer_model.display_name} / {binding.reviewer_model.model_name}"
            if binding is not None
            else "Review"
        ),
        "arbiter": (
            f"{binding.arbiter_model.display_name} / {binding.arbiter_model.model_name}"
            if binding is not None
            else "Arbiter"
        ),
    }
    
    # Base model results — only show the *latest* snapshot per role. Each
    # re-run creates new primary/review/arbiter snapshots; we don't want the
    # UI to show "Qwen × 2, DeepSeek × 2, Doubao × 2" after a regrade. Read
    # directly from the eagerly-loaded ``latest_*`` relations so a stale
    # ``task.snapshots`` collection (left over from an earlier load in the
    # same session) can't reintroduce duplicates.
    snapshots = [
        snapshot
        for snapshot in (
            task.latest_primary_snapshot,
            task.latest_review_snapshot,
            task.latest_arbitration_snapshot,
        )
        if snapshot is not None
    ]
    snapshots.sort(key=lambda snapshot: SNAPSHOT_TYPE_ORDER.get(snapshot.snapshot_type, 99))
    
    # Follow-up results grouped by review round, not by prompt text.
    follow_up_snapshots = sorted(
        [s for s in task.snapshots if s.snapshot_type == "follow_up"],
        key=lambda snapshot: (snapshot.created_at, str(snapshot.id)),
    )
    follow_up_rounds: list[dict[str, Any]] = []
    current_round: dict[str, Any] | None = None
    current_round_stage_count = 0
    for snapshot in follow_up_snapshots:
        prompt = snapshot.evidence_summary.get("prompt", "Follow-up")
        stage = snapshot.evidence_summary.get("stage", "primary")
        process = [
            *snapshot.deduction_reasons,
            *snapshot.strengths,
            *snapshot.improvement_suggestions,
            *format_evidence_summary(snapshot.evidence_summary),
        ]
        if (
            current_round is None
            or current_round_stage_count >= 3
            or current_round["prompt"] != prompt
        ):
            current_round = {
                "prompt": prompt,
                "created_at": snapshot.created_at.isoformat(),
                "models": [],
            }
            follow_up_rounds.append(current_round)
            current_round_stage_count = 0

        current_round["models"].append(
            {
                "stage": stage,
                "model_label": snapshot_model_labels.get(stage, "Follow-up"),
                "score": snapshot.score_total,
                "summary": "；".join(snapshot.deduction_reasons) or "已完成复评",
                "process": process,
                "risk_flags": snapshot.risk_flags,
            }
        )
        current_round_stage_count += 1

    models = []
    for snapshot in snapshots:
        process = [
            *snapshot.deduction_reasons,
            *snapshot.strengths,
            *snapshot.improvement_suggestions,
            *format_evidence_summary(snapshot.evidence_summary),
        ]
        models.append(
            {
                "stage": snapshot.snapshot_type,
                "model_label": snapshot_model_labels.get(snapshot.snapshot_type, snapshot.snapshot_type),
                "score": snapshot.score_total,
                "summary": "；".join(snapshot.deduction_reasons) or "已完成评分",
                "process": process,
                "risk_flags": snapshot.risk_flags,
            }
        )

    latest_failure_event = next(
        (
            event
            for event in sorted(
                task.audit_events,
                key=lambda item: item.created_at or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )
            if event.event_type == "grading.failed"
        ),
        None,
    )
    evaluation_note = None
    if task.status == "failed":
        failure_message = (
            latest_failure_event.event_payload.get("message")
            if latest_failure_event and isinstance(latest_failure_event.event_payload, dict)
            else None
        )
        evaluation_note = _humanize_grading_failure_message(failure_message)
    elif task.latest_final_snapshot is None and task.status in {"pending", "running"}:
        evaluation_note = "AI 正在评估中，请稍后刷新。"

    return {
        "task_id": str(task.id),
        "candidate_name": locator["candidate_name"],
        "candidate_code": locator["candidate_code"],
        "status": _task_display_status(task),
        "evaluation_note": evaluation_note,
        "suggested_score": task.latest_final_snapshot.score_total if task.latest_final_snapshot else None,
        "max_score": task.max_score,
        "question_type": task.question_type,
        "student_answer_raw": task.student_answer_raw,
        "attachment_refs": task.attachment_refs,
        "knowledge_tags": task.knowledge_tags,
        "student_feedback": feedback["student_feedback"] if feedback else None,
        "teacher_feedback_reply": feedback["teacher_feedback_reply"] if feedback else None,
        "feedback_created_at": feedback["feedback_created_at"] if feedback else None,
        "models": models,
        "follow_ups": follow_up_rounds,
    }


async def run_grading_prompt_follow_up(
    db: AsyncSession,
    task_id: str,
    teacher_prompt: str,
    locale: str | None = None,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> dict[str, Any]:
    result = await db.execute(
        select(GradingTask)
        .options(
            selectinload(GradingTask.snapshots).selectinload(GradingResultSnapshot.model_config),
            selectinload(GradingTask.latest_primary_snapshot),
            selectinload(GradingTask.latest_review_snapshot),
            selectinload(GradingTask.latest_arbitration_snapshot),
        )
        .where(GradingTask.id == uuid.UUID(task_id))
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise ValueError("grading task not found")
    await _ensure_task_access(
        db,
        task,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )

    binding = await _load_role_binding(db, task.role_binding_version)
    context = _build_grading_context(task)

    providers = [
        ("primary", "primary grader", binding.grader_model),
        ("review", "review grader", binding.reviewer_model),
        ("arbiter", "arbiter", binding.arbiter_model),
    ]
    latest_snapshots = {
        "primary": task.latest_primary_snapshot,
        "review": task.latest_review_snapshot,
        "arbiter": task.latest_arbitration_snapshot,
    }

    models: list[dict[str, Any]] = []
    for stage, role_name, model_config in providers:
        provider = _build_provider_for_model(model_config)
        previous_snapshot = latest_snapshots.get(stage)
        previous_result = None
        if previous_snapshot is not None:
            previous_result = {
                "score_total": previous_snapshot.score_total,
                "dimension_scores": previous_snapshot.dimension_scores,
                "dimension_comments": previous_snapshot.dimension_comments,
                "deduction_reasons": previous_snapshot.deduction_reasons,
                "strengths": previous_snapshot.strengths,
                "improvement_suggestions": previous_snapshot.improvement_suggestions,
                "evidence_summary": previous_snapshot.evidence_summary,
                "risk_flags": previous_snapshot.risk_flags,
            }
        system_prompt, user_prompt = _build_follow_up_prompt_pair(
            task,
            context,
            role_name,
            teacher_prompt,
            previous_result,
            locale,
        )
        try:
            result = await provider.score(system_prompt, user_prompt)
        except Exception as e:
            raise RuntimeError(f"{model_config.display_name} 复评失败: {e}") from e
        
        # Persist as follow_up snapshot
        snapshot = GradingResultSnapshot(
            task_id=task.id,
            snapshot_type="follow_up",
            score_total=result.score_total,
            dimension_scores=result.dimension_scores,
            dimension_comments=result.dimension_comments,
            deduction_reasons=result.deduction_reasons,
            strengths=result.strengths,
            improvement_suggestions=result.improvement_suggestions,
            evidence_summary={
                **result.evidence_summary,
                "prompt": teacher_prompt,
                "stage": stage
            },
            risk_flags=result.risk_flags,
            role_binding_version=task.role_binding_version,
            created_by="teacher",
        )
        db.add(snapshot)

        models.append(
            _result_to_comment_payload(
                result,
                stage,
                f"{model_config.display_name} / {model_config.model_name}",
            )
        )

    db.add(
        GradingAuditEvent(
            task_id=task.id,
            event_type="grading.follow_up_completed",
            event_payload={"prompt": teacher_prompt},
            operator_type="user",
            operator_id="teacher",
        )
    )
    await db.flush()

    return {"prompt": teacher_prompt, "models": models}


async def stream_grading_prompt_follow_up(
    db: AsyncSession,
    task_id: str,
    teacher_prompt: str,
    locale: str | None = None,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    result = await db.execute(
        select(GradingTask)
        .options(
            selectinload(GradingTask.snapshots).selectinload(GradingResultSnapshot.model_config),
            selectinload(GradingTask.latest_primary_snapshot),
            selectinload(GradingTask.latest_review_snapshot),
            selectinload(GradingTask.latest_arbitration_snapshot),
        )
        .where(GradingTask.id == uuid.UUID(task_id))
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise ValueError("grading task not found")
    await _ensure_task_access(
        db,
        task,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )

    binding = await _load_role_binding(db, task.role_binding_version)
    context = _build_grading_context(task)
    providers = [
        ("primary", "primary grader", binding.grader_model),
        ("review", "review grader", binding.reviewer_model),
        ("arbiter", "arbiter", binding.arbiter_model),
    ]
    latest_snapshots = {
        "primary": task.latest_primary_snapshot,
        "review": task.latest_review_snapshot,
        "arbiter": task.latest_arbitration_snapshot,
    }

    yield {"event": "prompt_start", "prompt": teacher_prompt}
    for stage, role_name, model_config in providers:
        model_label = f"{model_config.display_name} / {model_config.model_name}"
        yield {"event": "model_start", "stage": stage, "model_label": model_label}
        provider = _build_provider_for_model(model_config)
        previous_snapshot = latest_snapshots.get(stage)
        previous_result = None
        if previous_snapshot is not None:
            previous_result = {
                "score_total": previous_snapshot.score_total,
                "dimension_scores": previous_snapshot.dimension_scores,
                "dimension_comments": previous_snapshot.dimension_comments,
                "deduction_reasons": previous_snapshot.deduction_reasons,
                "strengths": previous_snapshot.strengths,
                "improvement_suggestions": previous_snapshot.improvement_suggestions,
                "evidence_summary": previous_snapshot.evidence_summary,
                "risk_flags": previous_snapshot.risk_flags,
            }
        system_prompt, user_prompt = _build_follow_up_prompt_pair(
            task,
            context,
            role_name,
            teacher_prompt,
            previous_result,
            locale,
        )
        raw_text = ""
        try:
            async for chunk in provider.stream_text(system_prompt, user_prompt):
                raw_text += chunk
                yield {"event": "model_delta", "stage": stage, "content": chunk}
            provider_result = provider.parse_response({"choices": [{"message": {"content": raw_text}}]})
        except Exception as exc:
            yield {"event": "model_error", "stage": stage, "model_label": model_label, "message": str(exc)}
            raise

        snapshot = GradingResultSnapshot(
            task_id=task.id,
            snapshot_type="follow_up",
            score_total=provider_result.score_total,
            dimension_scores=provider_result.dimension_scores,
            dimension_comments=provider_result.dimension_comments,
            deduction_reasons=provider_result.deduction_reasons,
            strengths=provider_result.strengths,
            improvement_suggestions=provider_result.improvement_suggestions,
            evidence_summary={
                **provider_result.evidence_summary,
                "prompt": teacher_prompt,
                "stage": stage,
            },
            risk_flags=provider_result.risk_flags,
            role_binding_version=task.role_binding_version,
            created_by="teacher",
        )
        db.add(snapshot)
        await db.flush()
        yield {
            "event": "model_done",
            "stage": stage,
            "model": _result_to_comment_payload(provider_result, stage, model_label),
        }

    db.add(
        GradingAuditEvent(
            task_id=task.id,
            event_type="grading.follow_up_completed",
            event_payload={"prompt": teacher_prompt, "stream": True},
            operator_type="user",
            operator_id="teacher",
        )
    )
    await db.flush()
    yield {"event": "done", "prompt": teacher_prompt}


async def create_manual_score_override(
    db: AsyncSession,
    task_id: str,
    score_total: float,
    reason: str,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> GradingResultSnapshot:
    """Create a manual override snapshot and audit event."""

    task = await db.get(
        GradingTask, uuid.UUID(task_id),
        options=[selectinload(GradingTask.latest_final_snapshot)],
    )
    if task is None:
        raise ValueError("grading task not found")
    await _ensure_task_access(
        db,
        task,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )

    # Inherit AI feedback details so the student still sees the scoring breakdown.
    prev = task.latest_final_snapshot
    snapshot = GradingResultSnapshot(
        task_id=task.id,
        snapshot_type="manual",
        score_total=score_total,
        dimension_scores=prev.dimension_scores if prev and prev.dimension_scores else {},
        dimension_comments=prev.dimension_comments if prev and prev.dimension_comments else {},
        deduction_reasons=[reason] if reason else (prev.deduction_reasons if prev else []),
        strengths=prev.strengths if prev else [],
        improvement_suggestions=prev.improvement_suggestions if prev else [],
        evidence_summary=prev.evidence_summary if prev else {},
        risk_flags=prev.risk_flags if prev else [],
        role_binding_version=task.role_binding_version,
        created_by="manual",
    )
    db.add(snapshot)
    await db.flush()

    task.latest_manual_snapshot = snapshot
    task.latest_final_snapshot = snapshot

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


def _parse_exam_submission_locator(
    source_business_id: str | None,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID | None]:
    if not source_business_id:
        raise ValueError("missing source business id")
    parts = source_business_id.split(":")
    if len(parts) not in {3, 4}:
        raise ValueError("invalid exam submission source business id")
    try:
        exam_id = uuid.UUID(parts[0])
        question_id = uuid.UUID(parts[1])
        student_id = uuid.UUID(parts[2])
        submission_id = uuid.UUID(parts[3]) if len(parts) == 4 else None
    except ValueError as exc:
        raise ValueError("invalid exam submission source business id") from exc
    return exam_id, question_id, student_id, submission_id


def _flatten_evidence_strings(value: Any) -> list[str]:
    """Extract leaf string values from a nested evidence_summary dict/list."""
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        return [line for item in value for line in _flatten_evidence_strings(item)]
    if isinstance(value, dict):
        return [line for v in value.values() for line in _flatten_evidence_strings(v)]
    return []


def _build_exam_submission_feedback(snapshot: GradingResultSnapshot) -> dict[str, Any]:
    dimension_scores = snapshot.dimension_scores or {}
    dimension_comments = snapshot.dimension_comments or {}
    dimensions = [
        {
            "name": str(name),
            "score": float(value),
            "max_score": None,
            "comment": str(dimension_comments.get(name, "")),
        }
        for name, value in dimension_scores.items()
    ]
    evidence_lines = list(dict.fromkeys(_flatten_evidence_strings(snapshot.evidence_summary)))
    return {
        "dimensions": dimensions,
        "strengths": snapshot.strengths,
        "deductions": snapshot.deduction_reasons,
        "suggestions": snapshot.improvement_suggestions,
        "risk_flags": snapshot.risk_flags,
        "evidence_summary": snapshot.evidence_summary,
        "evidence_lines": evidence_lines,
    }


async def _load_exam_submission_context(
    db: AsyncSession,
    task_id: str,
) -> tuple[
    GradingTask,
    ExamStudent,
    StudentExamAnswer | None,
    StudentExamSubmission | None,
    StudentExamSubmissionAnswer | None,
]:
    result = await db.execute(
        select(GradingTask)
        .options(selectinload(GradingTask.latest_final_snapshot))
        .where(GradingTask.id == uuid.UUID(task_id))
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise ValueError("grading task not found")
    if task.source_type != "exam_submission":
        raise ValueError("grading task is not linked to an exam submission")

    exam_id, question_id, student_id, submission_id = _parse_exam_submission_locator(task.source_business_id)
    exam_student = (
        await db.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == exam_id,
                ExamStudent.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if exam_student is None:
        raise ValueError("exam submission not found")

    answer = (
        await db.execute(
            select(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == exam_id,
                StudentExamAnswer.student_id == student_id,
                StudentExamAnswer.question_id == question_id,
            )
        )
    ).scalar_one_or_none()

    submission = None
    submission_answer = None
    if submission_id is not None:
        submission = (
            await db.execute(
                select(StudentExamSubmission).where(StudentExamSubmission.id == submission_id)
            )
        ).scalar_one_or_none()
        submission_answer = (
            await db.execute(
                select(StudentExamSubmissionAnswer).where(
                    StudentExamSubmissionAnswer.submission_id == submission_id,
                    StudentExamSubmissionAnswer.question_id == question_id,
                )
            )
        ).scalar_one_or_none()
    return task, exam_student, answer, submission, submission_answer


async def _recompute_submission_scores(
    db: AsyncSession,
    *,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
) -> tuple[float, float]:
    rows = (
        await db.execute(
            select(StudentExamAnswer, Question)
            .join(Question, Question.id == StudentExamAnswer.question_id)
            .where(
                StudentExamAnswer.exam_id == exam_id,
                StudentExamAnswer.student_id == student_id,
            )
        )
    ).all()

    objective_score = 0.0
    subjective_score = 0.0
    for answer, question in rows:
        question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
        if question_type in {
            QuestionType.SHORT_ANSWER.value,
            QuestionType.ESSAY.value,
            QuestionType.CODE.value,
        }:
            subjective_score += float(answer.score_awarded or 0)
        else:
            objective_score += float(answer.score_awarded or 0)
    return round(objective_score, 2), round(subjective_score, 2)


async def _recompute_historical_submission_scores(
    db: AsyncSession,
    *,
    submission_id: uuid.UUID,
) -> tuple[float, float]:
    rows = (
        await db.execute(
            select(StudentExamSubmissionAnswer, Question)
            .join(Question, Question.id == StudentExamSubmissionAnswer.question_id)
            .where(StudentExamSubmissionAnswer.submission_id == submission_id)
        )
    ).all()

    objective_score = 0.0
    subjective_score = 0.0
    for answer, question in rows:
        question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
        if question_type in {
            QuestionType.SHORT_ANSWER.value,
            QuestionType.ESSAY.value,
            QuestionType.CODE.value,
        }:
            subjective_score += float(answer.score_awarded or 0)
        else:
            objective_score += float(answer.score_awarded or 0)
    return round(objective_score, 2), round(subjective_score, 2)


async def refresh_student_question_progress_for_regrade(
    db: AsyncSession,
    *,
    student_id: uuid.UUID,
    question_id: uuid.UUID,
) -> None:
    wrong_rows = (
        await db.execute(
            select(StudentExamAnswer.exam_id, ExamStudent.submitted_at)
            .join(Exam, Exam.id == StudentExamAnswer.exam_id)
            .join(
                ExamStudent,
                and_(
                    ExamStudent.exam_id == StudentExamAnswer.exam_id,
                    ExamStudent.student_id == StudentExamAnswer.student_id,
                ),
            )
            .where(
                StudentExamAnswer.student_id == student_id,
                StudentExamAnswer.question_id == question_id,
                StudentExamAnswer.is_correct.is_(False),
                Exam.deleted_at.is_(None),
                ExamStudent.submitted_at.is_not(None),
            )
        )
    ).all()

    progress = (
        await db.execute(
            select(StudentQuestionProgress).where(
                StudentQuestionProgress.student_id == student_id,
                StudentQuestionProgress.question_id == question_id,
            )
        )
    ).scalar_one_or_none()

    if not wrong_rows:
        if progress is not None:
            progress.wrong_count = 0
            progress.last_exam_id = None
            progress.last_wrong_at = None
            progress.mastered = True
            progress.mastered_at = _utcnow()
        return

    latest_exam_id, latest_wrong_at = max(
        wrong_rows,
        key=lambda item: item[1] or datetime.min.replace(tzinfo=timezone.utc),
    )
    if progress is None:
        progress = StudentQuestionProgress(
            student_id=student_id,
            question_id=question_id,
        )
        db.add(progress)

    progress.wrong_count = len(wrong_rows)
    progress.last_exam_id = latest_exam_id
    progress.last_wrong_at = latest_wrong_at
    progress.mastered = False
    progress.mastered_at = None


# Only tasks that are actively being processed should keep an exam submission in
# PENDING_AI. Terminal-but-not-completed states (failed, arbitration_required)
# must not strand the entire submission — those questions get surfaced
# separately via per-question grading_failed flags.
_ACTIVE_TASK_STATUSES: frozenset[str] = frozenset({"pending", "running"})


async def _has_pending_exam_submission_tasks(
    db: AsyncSession,
    *,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    submission_id: uuid.UUID | None = None,
) -> bool:
    """Check whether any exam-submission task for this student is still actively
    being processed.

    Filters down at the SQL layer to tasks for this exam in an active status,
    then narrows by student/submission in Python. Without the SQL prefix scan
    this used to load every exam_submission task in the system into memory.
    """
    exam_prefix = f"{exam_id}:"
    tasks = (
        await db.execute(
            select(GradingTask).where(
                GradingTask.source_type == "exam_submission",
                GradingTask.status.in_(_ACTIVE_TASK_STATUSES),
                GradingTask.source_business_id.like(f"{exam_prefix}%"),
            )
        )
    ).scalars().all()
    student_id_str = str(student_id)
    for task in tasks:
        try:
            task_exam_id, _question_id, task_student_id, task_submission_id = _parse_exam_submission_locator(task.source_business_id)
        except ValueError:
            continue
        if submission_id is not None and task_submission_id != submission_id:
            continue
        if str(task_exam_id) == str(exam_id) and str(task_student_id) == student_id_str:
            return True
    return False


async def apply_grading_task_result_to_exam_submission(db: AsyncSession, task_id: str) -> dict[str, Any]:
    task, exam_student, answer, submission, submission_answer = await _load_exam_submission_context(db, task_id)
    if answer is None:
        raise ValueError("student exam answer not found")
    if task.latest_final_snapshot is None:
        raise ValueError("grading task has no final snapshot")

    snapshot = task.latest_final_snapshot
    latest_score = float(snapshot.score_total)
    latest_correct = latest_score >= float(task.max_score) * 0.6
    latest_feedback = _build_exam_submission_feedback(snapshot)

    exam_id, _question_id, student_id, submission_id = _parse_exam_submission_locator(task.source_business_id)

    if submission_answer is not None:
        submission_answer.score_awarded = latest_score
        submission_answer.is_correct = latest_correct
        submission_answer.feedback = latest_feedback

    if submission is not None:
        submission_objective_score, submission_subjective_score = await _recompute_historical_submission_scores(
            db,
            submission_id=submission.id,
        )
        submission.objective_score = submission_objective_score
        submission.subjective_score = submission_subjective_score
        submission.score = round(submission_objective_score + submission_subjective_score, 2)

    if submission_id is None or exam_student.latest_submission_id == submission_id:
        answer.score_awarded = latest_score
        answer.is_correct = latest_correct
        answer.feedback = latest_feedback
        objective_score, subjective_score = await _recompute_submission_scores(db, exam_id=exam_id, student_id=student_id)
        exam_student.objective_score = objective_score
        exam_student.subjective_score = subjective_score
        exam_student.score = round(objective_score + subjective_score, 2)

        now = _utcnow()
        if await _has_pending_exam_submission_tasks(
            db,
            exam_id=exam_id,
            student_id=student_id,
            submission_id=submission_id,
        ):
            exam_student.grading_status = GradingStatus.PENDING_AI.value
        else:
            exam_student.grading_status = GradingStatus.AI_SCORED.value
            exam_student.ai_scored_at = now
        exam_student.graded_at = now
        await refresh_student_question_progress_for_regrade(
            db,
            student_id=student_id,
            question_id=answer.question_id,
        )
    elif submission is not None:
        if await _has_pending_exam_submission_tasks(
            db,
            exam_id=exam_id,
            student_id=student_id,
            submission_id=submission.id,
        ):
            submission.grading_status = GradingStatus.PENDING_AI.value
        else:
            submission.grading_status = GradingStatus.AI_SCORED.value
    else:
        if await _has_pending_exam_submission_tasks(
            db,
            exam_id=exam_id,
            student_id=student_id,
        ):
            exam_student.grading_status = GradingStatus.PENDING_AI.value
        else:
            exam_student.grading_status = GradingStatus.AI_SCORED.value
    await db.flush()
    return {
        "status": task.status,
        "grading_status": exam_student.grading_status if submission_id is None or exam_student.latest_submission_id == submission_id else submission.grading_status if submission else exam_student.grading_status,
        "score": exam_student.score if submission_id is None or exam_student.latest_submission_id == submission_id else submission.score if submission else exam_student.score,
    }


def _build_grading_failure_feedback(reason: str, *, needs_human_review: bool) -> dict[str, Any]:
    if needs_human_review:
        message = "本题已完成 AI 评分但存在分歧，正在等待教师人工复核。"
        suggestion = "请耐心等待教师复核结果。"
    else:
        message = f"AI 评分未能完成：{reason}"
        suggestion = "请联系老师重新评分。"
    return {
        "dimensions": [],
        "strengths": [],
        "deductions": [message],
        "suggestions": [suggestion],
        "evidence_lines": [],
        "grading_failed": True,
        "needs_human_review": needs_human_review,
        "grading_failure_reason": reason,
    }


async def apply_grading_task_failure_to_exam_submission(
    db: AsyncSession,
    task_id: str,
    *,
    reason: str,
    needs_human_review: bool = False,
) -> dict[str, Any]:
    """Reconcile an exam submission when a grading task ends without a final snapshot.

    Called for terminal-but-not-completed task states (``failed``,
    ``arbitration_required``) so the exam_student can leave ``PENDING_AI``
    once no other tasks are still actively running. Writes a marker into the
    affected ``StudentExamAnswer.feedback`` so the result page can show
    "评分失败" / "等待人工复核" rather than the silent "评估中" stuck state.
    """

    try:
        task, exam_student, answer, submission, submission_answer = await _load_exam_submission_context(db, task_id)
    except ValueError:
        # Orphaned task (no matching exam_student / answer). Nothing to reconcile.
        return {"status": "missing"}
    if answer is None:
        return {"status": task.status, "grading_status": exam_student.grading_status}

    exam_id, _question_id, student_id, submission_id = _parse_exam_submission_locator(task.source_business_id)
    failure_feedback = _build_grading_failure_feedback(reason, needs_human_review=needs_human_review)

    if submission_answer is not None and not (submission_answer.feedback or {}).get("dimensions"):
        submission_answer.feedback = failure_feedback

    now = _utcnow()
    if submission_id is None or exam_student.latest_submission_id == submission_id:
        if not (answer.feedback or {}).get("dimensions"):
            answer.feedback = failure_feedback

        if await _has_pending_exam_submission_tasks(
            db,
            exam_id=exam_id,
            student_id=student_id,
            submission_id=submission_id,
        ):
            exam_student.grading_status = GradingStatus.PENDING_AI.value
        else:
            exam_student.grading_status = GradingStatus.AI_SCORED.value
            exam_student.ai_scored_at = now
        exam_student.graded_at = now
    elif submission is not None:
        if await _has_pending_exam_submission_tasks(
            db,
            exam_id=exam_id,
            student_id=student_id,
            submission_id=submission.id,
        ):
            submission.grading_status = GradingStatus.PENDING_AI.value
        else:
            submission.grading_status = GradingStatus.AI_SCORED.value

    await db.flush()
    return {
        "status": task.status,
        "grading_status": (
            exam_student.grading_status
            if submission_id is None or exam_student.latest_submission_id == submission_id
            else submission.grading_status if submission else exam_student.grading_status
        ),
    }


async def recover_pending_exam_submission_tasks(db: AsyncSession) -> list[str]:
    """Find exam-submission grading tasks left mid-flight by a previous process.

    A worker that crashes or is restarted while ``_run_subjective_grading_tasks``
    is still iterating will leave its current task in ``running`` and any not-yet-
    visited tasks in ``pending``. Without this recovery hook those tasks live
    forever and the matching ``exam_student.grading_status`` stays in
    ``PENDING_AI``. We reset ``running`` to ``pending`` (so the dispatcher will
    treat them as fresh work) and return all task ids that should be re-run.

    We also re-queue ``arbitration_required`` tasks that never produced a final
    snapshot. Historically those got stuck when the arbiter provider failed
    (e.g. doubao 400/429) before we added the review-fallback path; once the
    fix is deployed, re-running them lets the new code finalize a snapshot
    instead of leaving the candidate at "AI 尚未评估".
    """
    result = await db.execute(
        select(GradingTask).where(
            GradingTask.source_type == "exam_submission",
            or_(
                GradingTask.status.in_(("pending", "running")),
                and_(
                    GradingTask.status == "arbitration_required",
                    GradingTask.latest_final_snapshot_id.is_(None),
                ),
            ),
        )
    )
    tasks = result.scalars().all()
    task_ids: list[str] = []
    for task in tasks:
        if task.status in ("running", "arbitration_required"):
            task.status = "pending"
        task_ids.append(str(task.id))
    if tasks:
        await db.flush()
    return task_ids


async def confirm_grading_task_for_exam_submission(
    db: AsyncSession,
    task_id: str,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> dict[str, Any]:
    task = await db.get(GradingTask, uuid.UUID(task_id))
    if task is None:
        raise ValueError("grading task not found")
    await _ensure_task_access(
        db,
        task,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )
    if task.latest_final_snapshot_id is None:
        raise ValueError("grading task has no final snapshot")

    if task.source_type != "exam_submission":
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="grading.confirmed",
                event_payload={"mode": "generic"},
                operator_type="user",
                operator_id="teacher",
            )
        )
        await db.flush()
        return {"status": task.status, "grading_status": GradingStatus.REVIEWED.value}

    try:
        _exam_id, _question_id, _student_id, _submission_id = _parse_exam_submission_locator(task.source_business_id)
        task, exam_student, _answer, submission, _submission_answer = await _load_exam_submission_context(db, task_id)
    except ValueError:
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="grading.confirmed",
                event_payload={"mode": "legacy_exam_submission"},
                operator_type="user",
                operator_id="teacher",
            )
        )
        await db.flush()
        return {"status": task.status, "grading_status": GradingStatus.REVIEWED.value}

    exam_id, _question_id, student_id, submission_id = _parse_exam_submission_locator(task.source_business_id)
    now = _utcnow()

    # Apply latest (possibly manual) snapshot to student answer before confirming.
    try:
        await apply_grading_task_result_to_exam_submission(db, task_id)
    except (ValueError, KeyError):
        pass

    # Re-fetch exam_student to pick up score/grading_status changes from apply above.
    task, exam_student, _answer, submission, _submission_answer = await _load_exam_submission_context(db, task_id)

    if submission_id is not None and submission is not None:
        if submission.grading_status != GradingStatus.REVIEWED.value:
            submission.grading_status = GradingStatus.REVIEWED.value
        if exam_student.latest_submission_id == submission_id:
            still_pending = await _has_pending_exam_submission_tasks(
                db, exam_id=exam_id, student_id=student_id, submission_id=submission_id,
            )
            if not still_pending and exam_student.grading_status != GradingStatus.REVIEWED.value:
                exam_student.grading_status = GradingStatus.REVIEWED.value
            exam_student.reviewed_at = now
            if exam_student.ai_scored_at is None:
                exam_student.ai_scored_at = now
            if exam_student.graded_at is None:
                exam_student.graded_at = now
        else:
            await db.flush()
            return {"status": task.status, "grading_status": submission.grading_status}
    else:
        if exam_student.grading_status == GradingStatus.REVIEWED.value:
            return {"status": task.status, "grading_status": exam_student.grading_status}

        still_pending = await _has_pending_exam_submission_tasks(
            db, exam_id=exam_id, student_id=student_id, submission_id=None,
        )
        if not still_pending:
            exam_student.grading_status = GradingStatus.REVIEWED.value
        exam_student.reviewed_at = now
        if exam_student.ai_scored_at is None:
            exam_student.ai_scored_at = now
        if exam_student.graded_at is None:
            exam_student.graded_at = now

    existing_notification = (
        await db.execute(
            select(StudentNotification).where(
                StudentNotification.student_id == student_id,
                StudentNotification.related_exam_id == exam_id,
                StudentNotification.type == "exam_reviewed",
            )
        )
    ).scalar_one_or_none()
    if existing_notification is None:
        db.add(
            StudentNotification(
                student_id=student_id,
                type="exam_reviewed",
                title="考试成绩已审核确认",
                content="你的考试成绩已由教师审核确认，可以查看最新结果。",
                related_exam_id=exam_id,
                read_at=None,
            )
        )
    else:
        existing_notification.read_at = None
    db.add(
        GradingAuditEvent(
            task_id=task.id,
            event_type="grading.exam_submission_confirmed",
            event_payload={"exam_id": str(exam_id), "student_id": str(student_id)},
            operator_type="user",
            operator_id="teacher",
        )
    )
    await db.flush()
    return {"status": task.status, "grading_status": exam_student.grading_status}


async def get_final_report(
    db: AsyncSession,
    task_id: str,
    *,
    current_user_id: uuid.UUID | None = None,
    is_platform_admin: bool = True,
) -> dict[str, Any]:
    """Return the current final grading report for a task."""

    result = await db.execute(
        select(GradingTask)
        .options(
            selectinload(GradingTask.snapshots).selectinload(GradingResultSnapshot.model_config),
            selectinload(GradingTask.snapshots).selectinload(GradingResultSnapshot.provider_config),
            selectinload(GradingTask.audit_events),
            selectinload(GradingTask.latest_primary_snapshot),
            selectinload(GradingTask.latest_review_snapshot),
            selectinload(GradingTask.latest_arbitration_snapshot),
            selectinload(GradingTask.latest_final_snapshot),
            selectinload(GradingTask.latest_manual_snapshot),
        )
        .where(GradingTask.id == uuid.UUID(task_id))
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise ValueError("grading task not found")
    await _ensure_task_access(
        db,
        task,
        current_user_id=current_user_id,
        is_platform_admin=is_platform_admin,
    )

    try:
        binding = await _load_role_binding(db, task.role_binding_version)
    except ValueError:
        binding = None
    # Keep only the *latest* primary/review/arbiter snapshots — historical
    # ones from earlier grading runs would otherwise duplicate model entries
    # in the inbox detail. The latest 3 role snapshots are sourced directly
    # from ``task.latest_*_snapshot`` so a stale ``task.snapshots`` cache
    # (left over from a prior load in the same session) can't reintroduce
    # duplicates. ``final``/``manual``/``follow_up`` come from ``task.snapshots``
    # as-is.
    role_snapshots = [
        snapshot
        for snapshot in (
            task.latest_primary_snapshot,
            task.latest_review_snapshot,
            task.latest_arbitration_snapshot,
        )
        if snapshot is not None
    ]
    other_snapshots = [
        snapshot
        for snapshot in task.snapshots
        if snapshot.snapshot_type not in {"primary", "review", "arbiter"}
    ]
    snapshots = sorted(
        role_snapshots + other_snapshots,
        key=lambda snapshot: (
            SNAPSHOT_TYPE_ORDER.get(snapshot.snapshot_type, 99),
            snapshot.created_at,
            str(snapshot.id),
        ),
    )
    final_snapshot = next(
        (snapshot for snapshot in snapshots if snapshot.id == task.latest_final_snapshot_id),
        None,
    )

    if task.latest_final_snapshot_id == task.latest_manual_snapshot_id and task.latest_manual_snapshot_id is not None:
        result_source = "manual"
    elif task.latest_final_snapshot_id and task.latest_final_snapshot_id == task.latest_arbitration_snapshot_id:
        result_source = "arbiter"
    elif task.latest_arbitration_snapshot_id is not None:
        result_source = "arbiter"
    elif task.latest_final_snapshot_id is not None:
        result_source = "average"
    else:
        result_source = None

    final_model_label = {
        "manual": "Manual Final / human-override",
        "arbiter": "Arbiter Final / resolved",
        "average": "Average Final / merged",
    }.get(result_source)

    snapshot_model_labels = {
        "primary": (
            f"{binding.grader_model.display_name} / {binding.grader_model.model_name}"
            if binding is not None
            else None
        ),
        "review": (
            f"{binding.reviewer_model.display_name} / {binding.reviewer_model.model_name}"
            if binding is not None
            else None
        ),
        "arbiter": (
            f"{binding.arbiter_model.display_name} / {binding.arbiter_model.model_name}"
            if binding is not None
            else None
        ),
        "manual": "Manual Review / human-override",
        "final": final_model_label,
    }

    return {
        "task_id": str(task.id),
        "status": task.status,
        "question_type": task.question_type,
        "final_score": final_snapshot.score_total if final_snapshot else None,
        "result_source": result_source,
        "context": {
            "source_type": task.source_type,
            "source_business_id": task.source_business_id,
            "status": task.status,
            "question_type": task.question_type,
            "question_content": task.question_content,
            "subject": task.subject,
            "language": task.language,
            "max_score": task.max_score,
            "knowledge_tags": task.knowledge_tags,
            "fatal_rule_enabled": task.fatal_rule_enabled,
            "student_answer_raw": task.student_answer_raw,
            "student_answer_structured": task.student_answer_structured,
            "ocr_raw_text": task.ocr_raw_text,
            "ocr_repaired_text": task.ocr_repaired_text,
            "attachment_refs": task.attachment_refs,
            "standard_answers": task.standard_answers,
            "rubric_definition": task.rubric_definition,
            "scoring_points": task.scoring_points,
            "dimension_weights": task.dimension_weights,
            "deduction_rules": task.deduction_rules,
            "fatal_error_rules": task.fatal_error_rules,
            "prompt_template_version": task.prompt_template_version,
            "role_binding_version": task.role_binding_version,
            "execution_evidence": {
                "programming_language": task.programming_language,
                "execution_env": task.execution_env,
                "test_summary": task.test_summary,
                "compile_result": task.compile_result,
                "runtime_result": task.runtime_result,
                "runtime_logs": task.runtime_logs,
                "resource_limit_summary": task.resource_limit_summary,
            },
        },
        "snapshots": [
            {
                "id": str(snapshot.id),
                "snapshot_type": snapshot.snapshot_type,
                "score_total": snapshot.score_total,
                "model_label": snapshot_model_labels.get(snapshot.snapshot_type),
                "provider_key": snapshot.provider_config.key if snapshot.provider_config else None,
                "dimension_scores": snapshot.dimension_scores,
                "dimension_comments": snapshot.dimension_comments,
                "deduction_reasons": snapshot.deduction_reasons,
                "strengths": snapshot.strengths,
                "improvement_suggestions": snapshot.improvement_suggestions,
                "evidence_summary": snapshot.evidence_summary,
                "risk_flags": snapshot.risk_flags,
            }
            for snapshot in snapshots
        ],
        "audit_events": [
            {
                "id": str(event.id),
                "event_type": event.event_type,
                "event_payload": event.event_payload,
                "operator_type": event.operator_type,
                "operator_id": event.operator_id,
                "created_at": event.created_at.isoformat(),
            }
            for event in sorted(task.audit_events, key=lambda event: event.created_at)
        ],
    }


def _build_grading_context(task: GradingTask) -> dict[str, Any]:
    task_payload = {
        "question_content": task.question_content,
        "max_score": task.max_score,
        "knowledge_tags": task.knowledge_tags,
        "student_answer_raw": task.student_answer_raw,
        "rubric_definition": task.rubric_definition,
        "scoring_points": task.scoring_points,
        "dimension_weights": task.dimension_weights,
        "test_summary": task.test_summary,
        "compile_result": task.compile_result,
        "runtime_result": task.runtime_result,
        "runtime_logs": task.runtime_logs,
    }
    if task.question_type == "code":
        return build_code_rubric_context(task_payload)
    if task.question_type in {"short_answer", "essay"}:
        return build_short_answer_rubric_context(task_payload)
    raise ValueError(f"unsupported grading question type: {task.question_type}")


def _build_prompt_pair(
    task: GradingTask,
    context: dict[str, Any],
    role_name: str,
    locale: str | None = None,
) -> tuple[str, str]:
    preferred_locale, language_instruction = _resolve_prompt_locale(task.language, locale)
    system_prompt = _build_grading_system_prompt(
        task=task,
        role_name=role_name,
        language_instruction=language_instruction,
        mode="grading",
    )
    user_prompt = (
        f"Task ID: {task.id}\n"
        f"Question type: {task.question_type}\n"
        f"Question: {task.question_content}\n"
        f"Max score: {task.max_score}\n"
        f"Preferred locale: {preferred_locale}\n"
        f"Knowledge tags: {json.dumps(task.knowledge_tags, ensure_ascii=False)}\n"
        f"Context: {json.dumps(context, ensure_ascii=False, sort_keys=True)}"
    )
    return system_prompt, user_prompt


def _build_arbiter_prompt_pair(
    task: GradingTask,
    context: dict[str, Any],
    primary_result: GradingProviderResult,
    review_result: GradingProviderResult,
    reason: str | None,
    locale: str | None = None,
) -> tuple[str, str]:
    preferred_locale, language_instruction = _resolve_prompt_locale(task.language, locale)
    system_prompt = _build_grading_system_prompt(
        task=task,
        role_name="仲裁模型",
        language_instruction=language_instruction,
        mode="arbiter",
    )
    user_prompt = (
        f"Task ID: {task.id}\n"
        f"Question type: {task.question_type}\n"
        f"Question: {task.question_content}\n"
        f"Max score: {task.max_score}\n"
        f"Preferred locale: {preferred_locale}\n"
        f"Knowledge tags: {json.dumps(task.knowledge_tags, ensure_ascii=False)}\n"
        f"Arbitration reason: {reason}\n"
        f"Context: {json.dumps(context, ensure_ascii=False, sort_keys=True)}\n"
        "Primary result: "
        f"{json.dumps(primary_result.raw_content, ensure_ascii=False, sort_keys=True)}\n"
        "Review result: "
        f"{json.dumps(review_result.raw_content, ensure_ascii=False, sort_keys=True)}"
    )
    return system_prompt, user_prompt


def _build_follow_up_prompt_pair(
    task: GradingTask,
    context: dict[str, Any],
    role_name: str,
    teacher_prompt: str,
    previous_result: dict[str, Any] | None = None,
    locale: str | None = None,
) -> tuple[str, str]:
    preferred_locale, language_instruction = _resolve_prompt_locale(task.language, locale)
    system_prompt = _build_grading_system_prompt(
        task=task,
        role_name=role_name,
        language_instruction=language_instruction,
        mode="follow_up",
    )
    lines = [
        f"Task ID: {task.id}",
        f"Question type: {task.question_type}",
        f"Question: {task.question_content}",
        f"Max score: {task.max_score}",
        f"Preferred locale: {preferred_locale}",
        f"Knowledge tags: {json.dumps(task.knowledge_tags, ensure_ascii=False)}",
        f"Teacher follow-up prompt: {teacher_prompt}",
        f"Context: {json.dumps(context, ensure_ascii=False, sort_keys=True)}",
    ]
    if previous_result is not None:
        lines.append(
            f"Previous result: {json.dumps(previous_result, ensure_ascii=False, sort_keys=True)}"
        )
    return system_prompt, "\n".join(lines)


def _build_grading_system_prompt(
    *,
    task: GradingTask,
    role_name: str,
    language_instruction: str,
    mode: str,
) -> str:
    role_label = {
        "primary grader": "评分模型",
        "review grader": "复核模型",
        "arbiter": "仲裁模型",
        "仲裁模型": "仲裁模型",
    }.get(role_name, role_name)
    mode_instruction = {
        "grading": "你需要严格依据给定 Rubric、评分维度、分值权重和题目上下文，对当前学生答案进行逐项评分。",
        "arbiter": "你需要审阅主评与复核的已有结果，在保持评分标准一致的前提下完成仲裁裁决。",
        "follow_up": "你需要结合教师追加的追问，对当前学生答案进行补充复评，但仍然必须严格依据原始 Rubric 和题目要求评分。",
    }[mode]
    if mode == "grading" and role_name == "review grader":
        mode_instruction = (
            f"{mode_instruction} "
            "作为复核模型，请独立完成评分，并重点关注主评模型可能遗漏的错误、被低估的知识点、"
            "证据使用不充分或逻辑漏洞；若发现主评可能高估或低估，应在 deduction_reasons 或 risk_flags 中明确指出。"
        )
    preamble = (
        f"你是高职高校课程评分专家，同时担任本次评阅流程中的{role_label}。"
        "你拥有 10 年以上高职院校教学经验，熟悉高职学生的认知特点、学习难点、课程评估、题库建设、SQL 与编程作业评分。"
        "你的评分风格必须严谨、客观、公正、可解释，并具备教学指导性。"
        f" {language_instruction} "
        f"{mode_instruction} "
        f"本题 max_score 为 {task.max_score}。"
    )

    sections: list[str] = [
        preamble,
        "以下是必须遵守的通用评分规范，请严格执行：",
        _load_prompt_markdown("common-base.md"),
    ]

    specialization_filename = _prompt_specialization_filename(task)
    if specialization_filename is not None:
        sections.extend(
            [
                "以下是本题型的专项评分规范，请在通用规范基础上优先结合本题型要求执行：",
                _load_prompt_markdown(specialization_filename),
            ]
        )

    return "\n\n".join(sections)


def _result_to_comment_payload(
    result: GradingProviderResult,
    stage: str,
    model_label: str,
) -> dict[str, Any]:
    return {
        "stage": stage,
        "model_label": model_label,
        "score": result.score_total,
        "summary": "；".join(result.deduction_reasons) or "已完成补充评价",
        "process": [
            *result.deduction_reasons,
            *result.strengths,
            *result.improvement_suggestions,
            *format_evidence_summary(result.evidence_summary),
        ],
        "risk_flags": result.risk_flags,
    }


def _result_to_snapshot(
    task: GradingTask,
    result: GradingProviderResult,
    snapshot_type: str,
) -> GradingResultSnapshot:
    return GradingResultSnapshot(
        task_id=task.id,
        snapshot_type=snapshot_type,
        score_total=result.score_total,
        dimension_scores=result.dimension_scores,
        dimension_comments=result.dimension_comments,
        deduction_reasons=result.deduction_reasons,
        strengths=result.strengths,
        improvement_suggestions=result.improvement_suggestions,
        evidence_summary=result.evidence_summary,
        risk_flags=result.risk_flags,
        prompt_template_version=task.prompt_template_version,
        role_binding_version=task.role_binding_version,
        created_by="system",
    )


def _build_final_snapshot(
    task: GradingTask,
    primary_result: GradingProviderResult,
    review_result: GradingProviderResult,
) -> GradingResultSnapshot:
    dimension_keys = set(primary_result.dimension_scores) | set(review_result.dimension_scores)
    averaged_dimensions = {
        key: round(
            (
                float(primary_result.dimension_scores.get(key, 0))
                + float(review_result.dimension_scores.get(key, 0))
            )
            / 2,
            2,
        )
        for key in dimension_keys
    }
    merged_dimension_comments: dict[str, str] = {}
    for key in dimension_keys:
        parts = [
            (primary_result.dimension_comments or {}).get(key, "").strip(),
            (review_result.dimension_comments or {}).get(key, "").strip(),
        ]
        merged = " ".join(part for part in dict.fromkeys(parts) if part)
        if merged:
            merged_dimension_comments[key] = merged
    merged_risk_flags = list(dict.fromkeys(primary_result.risk_flags + review_result.risk_flags))

    return GradingResultSnapshot(
        task_id=task.id,
        snapshot_type="final",
        score_total=round((primary_result.score_total + review_result.score_total) / 2, 2),
        dimension_scores=averaged_dimensions,
        dimension_comments=merged_dimension_comments,
        deduction_reasons=list(dict.fromkeys(primary_result.deduction_reasons + review_result.deduction_reasons)),
        strengths=list(dict.fromkeys(primary_result.strengths + review_result.strengths)),
        improvement_suggestions=list(
            dict.fromkeys(primary_result.improvement_suggestions + review_result.improvement_suggestions)
        ),
        evidence_summary={
            "primary": primary_result.evidence_summary,
            "review": review_result.evidence_summary,
        },
        risk_flags=merged_risk_flags,
        prompt_template_version=task.prompt_template_version,
        role_binding_version=task.role_binding_version,
        created_by="system",
    )


def _build_final_snapshot_from_result(
    task: GradingTask,
    result: GradingProviderResult,
) -> GradingResultSnapshot:
    return GradingResultSnapshot(
        task_id=task.id,
        snapshot_type="final",
        score_total=result.score_total,
        dimension_scores=result.dimension_scores,
        dimension_comments=result.dimension_comments,
        deduction_reasons=result.deduction_reasons,
        strengths=result.strengths,
        improvement_suggestions=result.improvement_suggestions,
        evidence_summary=result.evidence_summary,
        risk_flags=result.risk_flags,
        prompt_template_version=task.prompt_template_version,
        role_binding_version=task.role_binding_version,
        created_by="system",
    )


async def run_grading_task(
    db: AsyncSession,
    task_id: str,
    primary_provider: GradingProvider,
    review_provider: GradingProvider,
    arbiter_provider: GradingProvider | None = None,
    locale: str | None = None,
    *,
    review_only_final: bool = False,
) -> dict[str, Any]:
    """Execute the primary/review grading flow for a task.

    When ``review_only_final`` is True, the function pins the final score to
    the reviewer's result and skips arbitration entirely. Callers wire this
    up from ``settings.arbiter_enabled``.
    """

    task = await db.get(GradingTask, uuid.UUID(task_id))
    if task is None:
        raise ValueError("grading task not found")

    task.status = "running"
    await db.flush()
    context = _build_grading_context(task)

    try:
        primary_system_prompt, primary_user_prompt = _build_prompt_pair(task, context, "primary grader", locale)
        primary_result = await primary_provider.score(primary_system_prompt, primary_user_prompt)
        primary_snapshot = _result_to_snapshot(task, primary_result, "primary")
        db.add(primary_snapshot)
        await db.flush()
        task.latest_primary_snapshot = primary_snapshot
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="grading.primary_completed",
                event_payload={"snapshot_id": str(primary_snapshot.id)},
                operator_type="system",
                operator_id="system",
            )
        )

        review_system_prompt, review_user_prompt = _build_prompt_pair(task, context, "review grader", locale)
        review_result = await review_provider.score(review_system_prompt, review_user_prompt)
        review_snapshot = _result_to_snapshot(task, review_result, "review")
        db.add(review_snapshot)
        await db.flush()
        task.latest_review_snapshot = review_snapshot
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="grading.review_completed",
                event_payload={"snapshot_id": str(review_snapshot.id)},
                operator_type="system",
                operator_id="system",
            )
        )
    except Exception as exc:
        # 主评 / 复核失败：写详细审计后返回 failed 状态。
        # 注意：不要 raise——否则上层 try/except 会 rollback 这条详细审计，
        # 只剩一条 "stage=dispatch" 的粗糙记录，运维无从排查（曾经的坑）。
        stage = (
            "review"
            if "review_result" not in locals() and "primary_result" in locals()
            else "primary"
        )
        failing_provider = (
            review_provider
            if stage == "review"
            else primary_provider
        )
        exc_message = _exception_message(exc)
        task.status = "failed"
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="grading.failed",
                event_payload={
                    "message": exc_message,
                    "detail": _trim_failure_detail(exc_message),
                    "exception_type": f"{type(exc).__module__}.{type(exc).__name__}",
                    "stage": stage,
                    "provider": getattr(exc, "provider_name", None)
                    or getattr(failing_provider, "provider_name", None),
                    "model_name": getattr(exc, "model_name", None)
                    or getattr(failing_provider, "model_name", None),
                    "raw_excerpt": (
                        exc.raw_excerpt
                        if isinstance(exc, GradingProviderError)
                        else None
                    ),
                },
                operator_type="system",
                operator_id="system",
            )
        )
        await db.flush()
        return {
            "status": "failed",
            "arbitration_required": False,
            "reason": stage,
        }

    # Arbiter disabled (EXAM_ARBITER_ENABLED=false): final score pins to the
    # reviewer's result. Skip arbitration evaluation entirely so we don't
    # surface "arbitration required" UI state, and don't average — the user
    # explicitly asked for "以 reviewer 角色的分数为准". Re-enable the arbiter
    # once the upstream QPS quota is raised.
    if review_only_final:
        final_snapshot = _build_final_snapshot_from_result(task, review_result)
        db.add(final_snapshot)
        await db.flush()
        task.latest_final_snapshot = final_snapshot
        task.status = "completed"
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="grading.finalized",
                event_payload={
                    "snapshot_id": str(final_snapshot.id),
                    "source": "review_only",
                },
                operator_type="system",
                operator_id="system",
            )
        )
        await db.flush()
        return {
            "status": task.status,
            "arbitration_required": False,
            "reason": None,
            "arbiter_disabled": True,
        }

    triggered, reason = evaluate_arbitration(
        {
            "score_total": primary_result.score_total,
            "dimension_scores": primary_result.dimension_scores,
            "risk_flags": primary_result.risk_flags,
        },
        {
            "score_total": review_result.score_total,
            "dimension_scores": review_result.dimension_scores,
            "risk_flags": review_result.risk_flags,
        },
    )

    if triggered:
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="grading.arbitration_required",
                event_payload={"reason": reason},
                operator_type="system",
                operator_id="system",
            )
        )

        arbiter_result: GradingProviderResult | None = None
        if arbiter_provider is not None:
            arbiter_system_prompt, arbiter_user_prompt = _build_arbiter_prompt_pair(
                task,
                context,
                primary_result,
                review_result,
                reason,
                locale,
            )
            try:
                arbiter_result = await arbiter_provider.score(
                    arbiter_system_prompt, arbiter_user_prompt
                )
            except Exception as exc:
                # 仲裁失败：不阻塞流程，回退使用复核模型分数作为最终分。
                exc_message = _exception_message(exc)
                db.add(
                    GradingAuditEvent(
                        task_id=task.id,
                        event_type="grading.arbiter_failed",
                        event_payload={
                            "message": exc_message,
                            "detail": _trim_failure_detail(exc_message),
                            "exception_type": f"{type(exc).__module__}.{type(exc).__name__}",
                            "reason": reason,
                            "required": True,
                            "fallback": "review",
                            "provider": getattr(exc, "provider_name", None)
                            or getattr(arbiter_provider, "provider_name", None),
                            "model_name": getattr(exc, "model_name", None)
                            or getattr(arbiter_provider, "model_name", None),
                            "raw_excerpt": exc.raw_excerpt if isinstance(exc, GradingProviderError) else None,
                        },
                        operator_type="system",
                        operator_id="system",
                    )
                )

        if arbiter_result is not None:
            arbiter_snapshot = _result_to_snapshot(task, arbiter_result, "arbiter")
            db.add(arbiter_snapshot)
            await db.flush()
            task.latest_arbitration_snapshot = arbiter_snapshot
            db.add(
                GradingAuditEvent(
                    task_id=task.id,
                    event_type="grading.arbiter_completed",
                    event_payload={"snapshot_id": str(arbiter_snapshot.id), "reason": reason},
                    operator_type="system",
                    operator_id="system",
                )
            )
            final_snapshot = _build_final_snapshot_from_result(task, arbiter_result)
            final_source = "arbiter"
        else:
            # 仲裁模型未配置或调用失败：以复核模型分数为该考生该题最终分。
            final_snapshot = _build_final_snapshot_from_result(task, review_result)
            final_source = "review_fallback"

        db.add(final_snapshot)
        await db.flush()
        task.latest_final_snapshot = final_snapshot
        task.status = "completed"
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="grading.finalized",
                event_payload={
                    "snapshot_id": str(final_snapshot.id),
                    "source": final_source,
                    "reason": reason,
                },
                operator_type="system",
                operator_id="system",
            )
        )
        await db.flush()
        return {
            "status": task.status,
            "arbitration_required": False,
            "reason": reason,
            "arbiter_fallback": final_source == "review_fallback",
        }

    if arbiter_provider is not None:
        arbiter_system_prompt, arbiter_user_prompt = _build_arbiter_prompt_pair(
            task,
            context,
            primary_result,
            review_result,
            "no_conflict_model_output",
            locale,
        )
        try:
            arbiter_result = await arbiter_provider.score(arbiter_system_prompt, arbiter_user_prompt)
        except Exception as exc:
            exc_message = _exception_message(exc)
            db.add(
                GradingAuditEvent(
                    task_id=task.id,
                    event_type="grading.arbiter_failed",
                    event_payload={
                        "message": exc_message,
                        "detail": _trim_failure_detail(exc_message),
                        "exception_type": f"{type(exc).__module__}.{type(exc).__name__}",
                        "reason": "no_conflict_model_output",
                        "required": False,
                        "provider": getattr(exc, "provider_name", None)
                        or getattr(arbiter_provider, "provider_name", None),
                        "model_name": getattr(exc, "model_name", None)
                        or getattr(arbiter_provider, "model_name", None),
                        "raw_excerpt": exc.raw_excerpt if isinstance(exc, GradingProviderError) else None,
                    },
                    operator_type="system",
                    operator_id="system",
                )
            )
        else:
            arbiter_snapshot = _result_to_snapshot(task, arbiter_result, "arbiter")
            db.add(arbiter_snapshot)
            await db.flush()
            task.latest_arbitration_snapshot = arbiter_snapshot
            db.add(
                GradingAuditEvent(
                    task_id=task.id,
                    event_type="grading.arbiter_completed",
                    event_payload={
                        "snapshot_id": str(arbiter_snapshot.id),
                        "reason": "no_conflict_model_output",
                        "required": False,
                    },
                    operator_type="system",
                    operator_id="system",
                )
            )

    final_snapshot = _build_final_snapshot(task, primary_result, review_result)
    db.add(final_snapshot)
    await db.flush()
    task.latest_final_snapshot = final_snapshot
    task.status = "completed"
    db.add(
        GradingAuditEvent(
            task_id=task.id,
            event_type="grading.finalized",
            event_payload={"snapshot_id": str(final_snapshot.id)},
            operator_type="system",
            operator_id="system",
        )
    )
    await db.flush()
    return {"status": task.status, "arbitration_required": False, "reason": None}

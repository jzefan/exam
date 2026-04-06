import uuid

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
from app.grading.providers.base import GradingProviderResult
from app.grading.providers.deepseek import DeepSeekProvider
from app.grading.providers.openrouter import OpenRouterProvider
from app.grading.providers.qwen import QwenProvider
from app.grading.service import _build_provider_for_model, run_grading_task


class FakeProvider:
    def __init__(self, result: GradingProviderResult) -> None:
        self.result = result
        self.calls: list[tuple[str, str]] = []

    async def score(self, system_prompt: str, user_prompt: str) -> GradingProviderResult:
        self.calls.append((system_prompt, user_prompt))
        return self.result


async def _create_role_binding_stack(db_session: AsyncSession) -> tuple[ProviderConfig, ModelConfig, RoleBinding]:
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
    return provider, model, binding


@pytest.mark.asyncio
async def test_run_grading_task_creates_primary_review_and_final_snapshots(db_session: AsyncSession) -> None:
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="什么是幂等性",
        max_score=10,
        knowledge_tags=["接口设计", "幂等性"],
        student_answer_raw="重复执行结果一致",
        standard_answers=[{"summary": "同一请求多次执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 0.5}]},
        scoring_points=[{"key": "same_result", "weight": 0.5}],
        dimension_weights={"coverage": 0.5, "accuracy": 0.5},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=8.0,
            dimension_scores={"coverage": 4.0, "accuracy": 4.0},
            deduction_reasons=["缺少一个边界案例"],
            strengths=["概念正确"],
            improvement_suggestions=["补充副作用说明"],
            evidence_summary={"matched_points": 2},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=8.5,
            dimension_scores={"coverage": 4.0, "accuracy": 4.5},
            deduction_reasons=["表达略简略"],
            strengths=["结构清晰"],
            improvement_suggestions=["增加一个例子"],
            evidence_summary={"matched_points": 2},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-chat",
            metadata={},
        )
    )

    result = await run_grading_task(db_session, str(task.id), primary_provider, review_provider)
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False
    assert primary_provider.calls
    assert review_provider.calls
    assert '"question_type": "short_answer"' in primary_provider.calls[0][1]
    assert '"max_score": 10' in primary_provider.calls[0][1]
    assert '"knowledge_tags": ["接口设计", "幂等性"]' in primary_provider.calls[0][1]
    assert "0 to max_score" in primary_provider.calls[0][0]

    refreshed_task = await db_session.get(GradingTask, task.id)
    assert refreshed_task is not None
    assert refreshed_task.latest_primary_snapshot_id is not None
    assert refreshed_task.latest_review_snapshot_id is not None
    assert refreshed_task.latest_final_snapshot_id is not None

    snapshots_result = await db_session.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    assert {snapshot.snapshot_type for snapshot in snapshots} == {"primary", "review", "final"}

    final_snapshot = next(snapshot for snapshot in snapshots if snapshot.snapshot_type == "final")
    assert final_snapshot.score_total == 8.25
    assert final_snapshot.dimension_scores["accuracy"] == 4.25

    audit_result = await db_session.execute(
        select(GradingAuditEvent).where(GradingAuditEvent.task_id == task.id)
    )
    audit_events = list(audit_result.scalars().all())
    assert {event.event_type for event in audit_events} >= {
        "grading.primary_completed",
        "grading.review_completed",
        "grading.finalized",
    }


@pytest.mark.asyncio
async def test_run_grading_task_marks_arbitration_required_on_conflict(db_session: AsyncSession) -> None:
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="code",
        question_content="实现 two sum",
        max_score=100,
        student_answer_raw="def two_sum(nums, target): return []",
        standard_answers=[{"summary": "返回正确下标"}],
        rubric_definition={"dimensions": [{"key": "correctness", "weight": 0.4}]},
        test_summary={"passed": 1, "total": 3},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=60,
            dimension_scores={"correctness": 20},
            deduction_reasons=["功能未完成"],
            strengths=["结构还行"],
            improvement_suggestions=["补齐主逻辑"],
            evidence_summary={"tests_passed": 1},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=82,
            dimension_scores={"correctness": 34},
            deduction_reasons=["只有小问题"],
            strengths=["功能大致可用"],
            improvement_suggestions=["补充异常处理"],
            evidence_summary={"tests_passed": 2},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-chat",
            metadata={},
        )
    )
    arbiter_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "arbiter"},
            score_total=76,
            dimension_scores={"correctness": 30},
            deduction_reasons=["关键分支未覆盖"],
            strengths=["思路基本正确"],
            improvement_suggestions=["补齐返回路径并覆盖边界输入"],
            evidence_summary={"resolved_reason": "score_diff", "winner": "arbiter"},
            risk_flags=["arbiter_resolved"],
            provider_key="openrouter-arbiter",
            provider_name="openrouter",
            model_name="anthropic/claude-sonnet-4.6",
            metadata={},
        )
    )

    result = await run_grading_task(db_session, str(task.id), primary_provider, review_provider, arbiter_provider)
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False
    assert result["reason"] == "score_diff"
    assert arbiter_provider.calls
    assert "Arbitration reason: score_diff" in arbiter_provider.calls[0][1]
    assert '"provider": "primary"' in arbiter_provider.calls[0][1]
    assert '"provider": "review"' in arbiter_provider.calls[0][1]

    refreshed_task = await db_session.get(GradingTask, task.id)
    assert refreshed_task is not None
    assert refreshed_task.latest_primary_snapshot_id is not None
    assert refreshed_task.latest_review_snapshot_id is not None
    assert refreshed_task.latest_final_snapshot_id is not None

    snapshots_result = await db_session.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    assert {snapshot.snapshot_type for snapshot in snapshots} == {"primary", "review", "arbiter", "final"}

    final_snapshot = next(snapshot for snapshot in snapshots if snapshot.snapshot_type == "final")
    arbiter_snapshot = next(snapshot for snapshot in snapshots if snapshot.snapshot_type == "arbiter")
    assert arbiter_snapshot.score_total == 76
    assert final_snapshot.score_total == 76
    assert final_snapshot.risk_flags == ["arbiter_resolved"]

    audit_result = await db_session.execute(
        select(GradingAuditEvent).where(GradingAuditEvent.task_id == task.id)
    )
    audit_events = list(audit_result.scalars().all())
    assert {event.event_type for event in audit_events} >= {
        "grading.arbitration_required",
        "grading.arbiter_completed",
        "grading.finalized",
    }


@pytest.mark.asyncio
async def test_build_provider_for_model_reads_api_key_from_environment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    qwen_provider = ProviderConfig(
        key="qwen-direct",
        provider_type="qwen",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    deepseek_provider = ProviderConfig(
        key="deepseek-direct",
        provider_type="deepseek",
        base_url="https://api.deepseek.com/v1",
        credential_env="EXAM_DEEPSEEK_API_KEY",
        is_active=True,
    )
    openrouter_provider = ProviderConfig(
        key="openrouter-arbiter",
        provider_type="openrouter",
        base_url="https://openrouter.ai/api/v1",
        credential_env="EXAM_OPENROUTER_API_KEY",
        is_active=True,
    )
    db_session.add_all([qwen_provider, deepseek_provider, openrouter_provider])
    await db_session.flush()

    qwen_model = ModelConfig(
        key="qwen-grader-v1",
        display_name="Qwen Grader",
        model_name="qwen-plus",
        provider_id=qwen_provider.id,
        temperature=0.1,
        is_active=True,
    )
    deepseek_model = ModelConfig(
        key="deepseek-review-v1",
        display_name="DeepSeek Reviewer",
        model_name="deepseek-chat",
        provider_id=deepseek_provider.id,
        temperature=0.2,
        is_active=True,
    )
    openrouter_model = ModelConfig(
        key="claude-arbiter-v1",
        display_name="Claude Sonnet 4.6",
        model_name="anthropic/claude-sonnet-4.6",
        provider_id=openrouter_provider.id,
        temperature=0.0,
        is_active=True,
    )
    db_session.add_all([qwen_model, deepseek_model, openrouter_model])
    await db_session.flush()

    monkeypatch.setenv("EXAM_QWEN_API_KEY", "qwen-secret")
    monkeypatch.setenv("EXAM_DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("EXAM_OPENROUTER_API_KEY", "openrouter-secret")

    await db_session.refresh(qwen_model, ["provider"])
    await db_session.refresh(deepseek_model, ["provider"])
    await db_session.refresh(openrouter_model, ["provider"])

    qwen_client = _build_provider_for_model(qwen_model)
    deepseek_client = _build_provider_for_model(deepseek_model)
    openrouter_client = _build_provider_for_model(openrouter_model)

    assert isinstance(qwen_client, QwenProvider)
    assert isinstance(deepseek_client, DeepSeekProvider)
    assert isinstance(openrouter_client, OpenRouterProvider)
    assert qwen_client.api_key == "qwen-secret"
    assert deepseek_client.api_key == "deepseek-secret"
    assert openrouter_client.api_key == "openrouter-secret"


@pytest.mark.asyncio
async def test_build_provider_for_model_falls_back_to_settings_loaded_env_file(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
    await db_session.refresh(model, ["provider"])

    monkeypatch.delenv("EXAM_QWEN_API_KEY", raising=False)

    from app.grading import service as grading_service

    original_key = grading_service.settings.qwen_api_key
    grading_service.settings.qwen_api_key = "settings-loaded-qwen-key"
    try:
        qwen_client = _build_provider_for_model(model)
    finally:
        grading_service.settings.qwen_api_key = original_key

    assert isinstance(qwen_client, QwenProvider)
    assert qwen_client.api_key == "settings-loaded-qwen-key"

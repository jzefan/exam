"""Tests for grading config bootstrap behavior."""

import importlib
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.config as config_module
from app.grading.models import GradingAuditEvent
from app.grading.orchestrator import should_trigger_arbitration
from app.grading.providers.base import GradingProvider, GradingProviderResult
from app.grading.providers.deepseek import DeepSeekProvider, parse_deepseek_response
from app.grading.providers.openrouter import OpenRouterProvider, build_openrouter_payload
from app.grading.providers.qwen import QwenProvider, parse_qwen_response
from app.grading.service import create_grading_task, evaluate_arbitration


def test_grading_config_bootstrap_exposes_openrouter_and_thresholds(monkeypatch):
    monkeypatch.setenv("EXAM_OPENROUTER_API_KEY", "router-key")
    monkeypatch.setenv("EXAM_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("EXAM_OPENROUTER_MODEL_NAME", "anthropic/claude-sonnet-4.6")
    monkeypatch.setenv("EXAM_GRADING_SCORE_DIFF_THRESHOLD", "0.15")
    monkeypatch.setenv("EXAM_GRADING_DIMENSION_DIFF_THRESHOLD", "0.2")

    try:
        # Reload the module so the singleton reflects env-driven bootstrap behavior.
        importlib.reload(config_module)

        assert config_module.settings.openrouter_api_key == "router-key"
        assert config_module.settings.openrouter_base_url == "https://openrouter.ai/api/v1"
        assert config_module.settings.openrouter_model_name == "anthropic/claude-sonnet-4.6"
        assert config_module.settings.grading_score_diff_threshold == 0.15
        assert config_module.settings.grading_dimension_diff_threshold == 0.2
    finally:
        # Restore the singleton after the monkeypatched env vars have been cleaned up.
        monkeypatch.undo()
        importlib.reload(config_module)


def test_openrouter_payload_uses_claude_model_name() -> None:
    payload = build_openrouter_payload(
        model_name="anthropic/claude-sonnet-4.6",
        system_prompt="You arbitrate scoring disagreements.",
        user_prompt="Compare result A and result B.",
        temperature=0.0,
    )

    assert payload["model"] == "anthropic/claude-sonnet-4.6"
    assert payload["messages"][0]["role"] == "system"
    assert payload["messages"][1]["role"] == "user"
    assert payload["response_format"] == {"type": "json_object"}


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
        provider_key="qwen-direct",
        provider_name="Qwen",
        model_name="qwen-plus",
        metadata={"request_id": "req-1"},
    )

    assert result.score_total == 82
    assert result.dimension_scores["coverage"] == 40
    assert result.provider_key == "qwen-direct"
    assert result.provider_name == "Qwen"
    assert result.model_name == "qwen-plus"
    assert result.metadata["request_id"] == "req-1"


def test_qwen_response_parses_choice_envelope() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"score_total": 82, "dimension_scores": {"coverage": 40}, '
                        '"deduction_reasons": ["missed one key point"], '
                        '"strengths": ["logic is clear"], '
                        '"improvement_suggestions": ["cover timeout handling"], '
                        '"evidence_summary": {"matched_points": 3}, "risk_flags": []}'
                    )
                }
            }
        ]
    }

    result = parse_qwen_response(payload, provider_key="qwen-direct", model_name="qwen-plus")

    assert result.score_total == 82
    assert result.dimension_scores["coverage"] == 40
    assert result.provider_key == "qwen-direct"
    assert result.model_name == "qwen-plus"


def test_qwen_response_parses_fenced_json_content() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        "```json\n"
                        '{"score_total": 82, "dimension_scores": {"coverage": 40}, '
                        '"deduction_reasons": ["missed one key point"], '
                        '"strengths": ["logic is clear"], '
                        '"improvement_suggestions": ["cover timeout handling"], '
                        '"evidence_summary": {"matched_points": 3}, "risk_flags": []}'
                        "\n```"
                    )
                }
            }
        ]
    }

    result = parse_qwen_response(payload, provider_key="qwen-direct", model_name="qwen-plus")

    assert result.score_total == 82
    assert result.evidence_summary["matched_points"] == 3


def test_qwen_response_coerces_list_evidence_summary_to_dict() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"score_total": 1.0, "dimension_scores": {"coverage": 1.0, "accuracy": 1.0}, '
                        '"deduction_reasons": [], '
                        '"strengths": ["答案抓住核心"], '
                        '"improvement_suggestions": [], '
                        '"evidence_summary": ["命中 same_result", "命中 repeatable"], '
                        '"risk_flags": []}'
                    )
                }
            }
        ]
    }

    result = parse_qwen_response(payload, provider_key="qwen-direct", model_name="qwen-plus")

    assert result.score_total == 1.0
    assert result.evidence_summary == {"items": ["命中 same_result", "命中 repeatable"]}


def test_qwen_response_coerces_string_evidence_summary_to_dict() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"score_total": 1.0, "dimension_scores": {"coverage": 1.0, "accuracy": 1.0}, '
                        '"deduction_reasons": [], '
                        '"strengths": ["答案抓住核心"], '
                        '"improvement_suggestions": [], '
                        '"evidence_summary": "学生答案完整命中两个评分点", '
                        '"risk_flags": []}'
                    )
                }
            }
        ]
    }

    result = parse_qwen_response(payload, provider_key="qwen-direct", model_name="qwen-plus")

    assert result.score_total == 1.0
    assert result.evidence_summary == {"summary": "学生答案完整命中两个评分点"}


def test_deepseek_response_parses_choice_envelope() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"score_total": 76, "dimension_scores": {"reasoning": 38}, '
                        '"deduction_reasons": ["missed nuance"], '
                        '"strengths": ["clear structure"], '
                        '"improvement_suggestions": ["tighten evidence references"], '
                        '"evidence_summary": {"matched_points": 2}, "risk_flags": ["needs_review"]}'
                    )
                }
            }
        ]
    }

    result = parse_deepseek_response(payload, provider_key="deepseek-direct", model_name="deepseek-chat")

    assert result.score_total == 76
    assert result.dimension_scores["reasoning"] == 38
    assert result.provider_key == "deepseek-direct"
    assert result.model_name == "deepseek-chat"


@pytest.mark.parametrize(
    ("payload", "expected_message"),
    [
        (
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"score_total": "82", "dimension_scores": {"coverage": 40}, '
                                '"deduction_reasons": ["missed one key point"], '
                                '"strengths": ["logic is clear"], '
                                '"improvement_suggestions": ["cover timeout handling"], '
                                '"evidence_summary": {"matched_points": 3}, "risk_flags": []}'
                            )
                        }
                    }
                ]
            },
            "score_total",
        ),
        (
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"score_total": 82, "dimension_scores": [], '
                                '"deduction_reasons": ["missed one key point"], '
                                '"strengths": ["logic is clear"], '
                                '"improvement_suggestions": ["cover timeout handling"], '
                                '"evidence_summary": {"matched_points": 3}, "risk_flags": []}'
                            )
                        }
                    }
                ]
            },
            "dimension_scores",
        ),
        (
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"score_total": 82, "dimension_scores": {"coverage": 40}, '
                                '"deduction_reasons": "missed one key point", '
                                '"strengths": ["logic is clear"], '
                                '"improvement_suggestions": ["cover timeout handling"], '
                                '"evidence_summary": {"matched_points": 3}, "risk_flags": []}'
                            )
                        }
                    }
                ]
            },
            "deduction_reasons",
        ),
    ],
)
def test_malformed_provider_payload_field_types_are_rejected(payload: dict[str, object], expected_message: str) -> None:
    with pytest.raises(ValueError, match=expected_message):
        parse_qwen_response(payload, provider_key="qwen-direct", model_name="qwen-plus")


def test_openrouter_parse_response_parses_choice_envelope() -> None:
    provider = OpenRouterProvider(
        provider_key="openrouter-arbiter",
        base_url="https://example.invalid",
        model_name="anthropic/claude-sonnet-4.6",
    )
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"score_total": 91, "dimension_scores": {"reasoning": 45}, '
                        '"deduction_reasons": ["minor omission"], '
                        '"strengths": ["strong evidence use"], '
                        '"improvement_suggestions": ["tighten conclusion"], '
                        '"evidence_summary": {"matched_points": 4}, "risk_flags": []}'
                    )
                }
            }
        ]
    }

    result = provider.parse_response(payload)

    assert result.score_total == 91
    assert result.dimension_scores["reasoning"] == 45
    assert result.provider_key == "openrouter-arbiter"
    assert result.model_name == "anthropic/claude-sonnet-4.6"
    assert result.metadata == {
        "provider": "openrouter",
        "provider_key": "openrouter-arbiter",
        "base_url": "https://example.invalid",
        "model_name": "anthropic/claude-sonnet-4.6",
    }


def test_openrouter_parse_response_extracts_json_from_prefixed_text() -> None:
    provider = OpenRouterProvider(
        provider_key="openrouter-arbiter",
        base_url="https://example.invalid",
        model_name="anthropic/claude-sonnet-4.6",
    )
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        "Here is the structured grading result:\n"
                        '{"score_total": 8.5, "dimension_scores": {"reasoning": 4.5}, '
                        '"deduction_reasons": ["术语略弱"], '
                        '"strengths": ["概念正确"], '
                        '"improvement_suggestions": ["补充例子"], '
                        '"evidence_summary": {"matched_points": 3}, "risk_flags": []}'
                    )
                }
            }
        ]
    }

    result = provider.parse_response(payload)

    assert result.score_total == 8.5
    assert result.dimension_scores["reasoning"] == 4.5


def test_incomplete_provider_payload_is_rejected() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"score_total": 50, "dimension_scores": {"coverage": 10}, '
                        '"deduction_reasons": ["missing rubric detail"], '
                        '"strengths": ["clear answer"]}'
                    )
                }
            }
        ]
    }

    with pytest.raises(ValueError, match="missing required keys"):
        parse_qwen_response(payload, provider_key="qwen-direct", model_name="qwen-plus")


def test_metadata_contract_is_stable_between_helper_and_instance_paths() -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"score_total": 88, "dimension_scores": {"coverage": 44}, '
                        '"deduction_reasons": ["minor detail missing"], '
                        '"strengths": ["clear structure"], '
                        '"improvement_suggestions": ["add one example"], '
                        '"evidence_summary": {"matched_points": 5}, "risk_flags": []}'
                    )
                }
            }
        ]
    }

    helper_result = parse_qwen_response(payload, provider_key="qwen-direct", model_name="qwen-plus")
    instance_result = QwenProvider(
        provider_key="qwen-direct",
        base_url="https://example.invalid",
        model_name="qwen-plus",
    ).parse_response(payload)

    assert set(helper_result.metadata) == {"provider", "provider_key", "base_url", "model_name"}
    assert set(instance_result.metadata) == {"provider", "provider_key", "base_url", "model_name"}
    assert helper_result.metadata["provider"] == instance_result.metadata["provider"] == "qwen"
    assert helper_result.metadata["provider_key"] == instance_result.metadata["provider_key"] == "qwen-direct"
    assert helper_result.metadata["model_name"] == instance_result.metadata["model_name"] == "qwen-plus"
    assert helper_result.metadata["base_url"] is None
    assert instance_result.metadata["base_url"] == "https://example.invalid"


def test_provider_adapters_match_protocol_boundary() -> None:
    qwen = QwenProvider(provider_key="qwen-direct", base_url="https://example.invalid", model_name="qwen-plus")
    deepseek = DeepSeekProvider(
        provider_key="deepseek-direct",
        base_url="https://example.invalid",
        model_name="deepseek-chat",
    )
    openrouter = OpenRouterProvider(
        provider_key="openrouter-arbiter",
        base_url="https://example.invalid",
        model_name="anthropic/claude-sonnet-4.6",
    )

    assert isinstance(qwen, GradingProvider)
    assert isinstance(deepseek, GradingProvider)
    assert isinstance(openrouter, GradingProvider)
    assert qwen.provider_key == "qwen-direct"
    assert deepseek.provider_key == "deepseek-direct"
    assert openrouter.model_name == "anthropic/claude-sonnet-4.6"


@pytest.mark.asyncio
async def test_provider_score_posts_chat_completion_request_with_auth_header() -> None:
    provider = QwenProvider(
        provider_key="qwen-direct",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        model_name="qwen-plus",
        api_key="secret-key",
        temperature=0.1,
    )
    response_payload = {
        "choices": [
            {
                "message": {
                    "content": (
                        '{"score_total": 88, "dimension_scores": {"coverage": 44}, '
                        '"deduction_reasons": [], "strengths": ["clear"], '
                        '"improvement_suggestions": ["add example"], '
                        '"evidence_summary": {"matched_points": 2}, "risk_flags": []}'
                    )
                }
            }
        ]
    }

    mock_response = MagicMock()
    mock_response.json.return_value = response_payload
    mock_response.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client_instance = AsyncMock()
        mock_client_instance.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await provider.score("system prompt", "user prompt")

    assert result.score_total == 88
    mock_client_instance.post.assert_awaited_once()
    post_args, post_kwargs = mock_client_instance.post.await_args
    assert post_args[0] == "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    assert post_kwargs["headers"]["Authorization"] == "Bearer secret-key"
    assert post_kwargs["headers"]["Content-Type"] == "application/json"
    assert post_kwargs["json"]["model"] == "qwen-plus"


@pytest.mark.asyncio
async def test_provider_score_requires_api_key_before_http_request() -> None:
    provider = DeepSeekProvider(
        provider_key="deepseek-direct",
        base_url="https://api.deepseek.com/v1",
        model_name="deepseek-chat",
        api_key=None,
    )

    with patch("httpx.AsyncClient") as mock_client_cls:
        with pytest.raises(ValueError, match="API key"):
            await provider.score("system prompt", "user prompt")

    mock_client_cls.assert_not_called()


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


def test_evaluate_arbitration_uses_settings_thresholds() -> None:
    triggered, reason = evaluate_arbitration(
        {"score_total": 80, "dimension_scores": {"coverage": 40}, "risk_flags": []},
        {"score_total": 72, "dimension_scores": {"coverage": 35}, "risk_flags": []},
    )

    assert triggered is False
    assert reason is None


@pytest.mark.asyncio
async def test_create_grading_task_creates_pending_task_and_audit(db_session: AsyncSession) -> None:
    task = await create_grading_task(
        db_session,
        {
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

    audit_result = await db_session.execute(
        select(GradingAuditEvent).where(GradingAuditEvent.task_id == task.id)
    )
    audit_event = audit_result.scalar_one()

    assert task.status == "pending"
    assert task.question_type == "short_answer"
    assert audit_event.event_type == "task.created"
    assert audit_event.event_payload == {
        "source_type": "single_debug",
        "question_type": "short_answer",
    }

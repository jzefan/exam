"""导入草稿「完善」模式的单元测试（含只完善解析的 analysis 模式）。"""

import pytest

from app.questions import service as question_service
from app.questions.models import QuestionType
from app.questions.schemas import (
    EnhanceDraftInput,
    QuestionImportEnhanceDraftsRequest,
)


def _draft(**overrides) -> EnhanceDraftInput:
    data: dict = {
        "draft_id": "draft-1",
        "type": QuestionType.CHOICE,
        "content_text": "下列哪项是 TCP/IP 模型的传输层协议？",
        "options": {"A": "IP", "B": "TCP", "C": "ICMP", "D": "ARP"},
        "answer_text": "B",
        "analysis": "",
    }
    data.update(overrides)
    return EnhanceDraftInput(**data)


def test_analysis_mode_does_not_require_root_knowledge_point() -> None:
    request = QuestionImportEnhanceDraftsRequest(
        drafts=[_draft()],
        mode="analysis",
    )

    assert request.mode == "analysis"
    assert request.root_knowledge_point_id is None


def test_knowledge_mode_still_requires_root_knowledge_point() -> None:
    with pytest.raises(ValueError):
        QuestionImportEnhanceDraftsRequest(drafts=[_draft()], mode="knowledge")


async def test_enhance_single_draft_analysis_mode_only_fills_analysis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prompts: list[str] = []

    async def fake_request(prompt: str) -> dict:
        prompts.append(prompt)
        # 即使模型越权返回答案、存疑与知识点，analysis 模式也必须忽略它们。
        return {
            "answer_text": "A",
            "analysis": "TCP 工作在传输层，因此选 B。",
            "doubt": True,
            "doubt_reason": "答案可能有误",
            "matched_kp_ids": ["00000000-0000-0000-0000-000000000001"],
        }

    monkeypatch.setattr(question_service, "_request_deepseek_json", fake_request)

    result = await question_service._enhance_single_draft(
        _draft(),
        [],
        {},
        mode="analysis",
    )

    assert result.analysis == "TCP 工作在传输层，因此选 B。"
    assert result.answer_text is None
    assert result.doubt is False
    assert result.doubt_reason is None
    assert result.suggested_knowledge_points == []
    # 提示词只要求解析，不带候选知识点。
    assert "不要改动答案" in prompts[0]
    assert "候选知识点" not in prompts[0]


async def test_enhance_single_draft_answers_mode_keeps_answer_and_doubt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_request(_prompt: str) -> dict:
        return {
            "answer_text": "B",
            "analysis": "TCP 属于传输层。",
            "doubt": True,
            "doubt_reason": "题干缺少必要条件",
            "matched_kp_ids": [],
        }

    monkeypatch.setattr(question_service, "_request_deepseek_json", fake_request)

    result = await question_service._enhance_single_draft(
        _draft(),
        [],
        {},
        mode="answers",
    )

    assert result.answer_text == "B"
    assert result.analysis == "TCP 属于传输层。"
    assert result.doubt is True
    assert result.doubt_reason == "题干缺少必要条件"
    assert result.suggested_knowledge_points == []

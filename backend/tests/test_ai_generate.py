import json
from typing import Any
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.models import User
from app.learning.models import KnowledgePoint
from app.questions.ai_generate import (
    AIGenerateRequest,
    generate_questions_stream,
    list_user_frequent_knowledge_points,
    record_user_knowledge_point_usage,
)
from app.questions.ai_generate_prompt import build_ai_generate_system_prompt
from app.questions.models import UserKnowledgePointUsage


class _FakeStreamResponse:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    async def __aenter__(self) -> "_FakeStreamResponse":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _FakeAsyncClient:
    def __init__(self, lines: list[str], *args, **kwargs) -> None:
        self._lines = lines

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def stream(self, *args, **kwargs) -> _FakeStreamResponse:
        return _FakeStreamResponse(self._lines)


@pytest.mark.asyncio
async def test_ai_generate_endpoint_rejects_mismatched_type_distribution(
    admin_client: AsyncClient,
) -> None:
    response = await admin_client.post(
        "/api/questions/ai-generate/stream",
        json={
            "total_count": 20,
            "difficulty": 3,
            "type_distribution": {"choice": 10, "short_answer": 5},
            "model": "qwen",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "题型数量之和必须与题目总数一致"


@pytest.mark.asyncio
async def test_generate_questions_stream_never_yields_more_than_total_count(
    db_session,
    admin_token: str,
) -> None:
    stream_lines = [
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"choice\\",\\"title\\":\\"Q1\\",\\"content\\":{\\"text\\":\\"C1\\"},\\"options\\":null,\\"answer\\":{\\"text\\":\\"A1\\"},\\"analysis\\":\\"解析1\\",\\"difficulty\\":3}"}}]}',
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"choice\\",\\"title\\":\\"Q2\\",\\"content\\":{\\"text\\":\\"C2\\"},\\"options\\":null,\\"answer\\":{\\"text\\":\\"A2\\"},\\"analysis\\":\\"解析2\\",\\"difficulty\\":3}"}}]}',
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"choice\\",\\"title\\":\\"Q3\\",\\"content\\":{\\"text\\":\\"C3\\"},\\"options\\":null,\\"answer\\":{\\"text\\":\\"A3\\"},\\"analysis\\":\\"解析3\\",\\"difficulty\\":3}"}}]}',
        "data: [DONE]",
    ]

    with patch("app.questions.ai_generate._get_model_config", return_value=("qwen", "test-key", "https://api.example.com", "test-model")):
        with patch("httpx.AsyncClient", side_effect=lambda *args, **kwargs: _FakeAsyncClient(stream_lines, *args, **kwargs)):
            events = [
                event
                async for event in generate_questions_stream(
                    db_session,
                    AIGenerateRequest(total_count=2, difficulty=3, model="qwen"),
                    user_id=(await db_session.execute(select(User.id).where(User.username == "admin"))).scalar_one(),
                )
            ]

    question_events = [event for event in events if event["type"] == "question"]
    done_event = next(event for event in events if event["type"] == "done")

    assert len(question_events) == 2
    assert [event["index"] for event in question_events] == [1, 2]
    assert done_event["total"] == 2


@pytest.mark.asyncio
async def test_ai_generate_frequent_knowledge_points_returns_recent_and_frequent(
    admin_client: AsyncClient,
    db_session,
) -> None:
    admin = (await db_session.execute(select(User).where(User.username == "admin"))).scalar_one()
    kp1 = KnowledgePoint(name="数组", owner_id=admin.id, visibility="private")
    kp2 = KnowledgePoint(name="二叉树", owner_id=admin.id, visibility="private")
    db_session.add_all([kp1, kp2])
    await db_session.flush()

    await record_user_knowledge_point_usage(db_session, admin.id, [kp1.id, kp2.id])
    await record_user_knowledge_point_usage(db_session, admin.id, [kp1.id])
    await db_session.commit()

    response = await admin_client.get("/api/questions/ai-generate/frequent-knowledge-points")

    assert response.status_code == 200
    data = response.json()
    assert data["frequent"][0]["name"] == "数组"
    assert data["frequent"][0]["use_count"] == 2
    assert {item["name"] for item in data["recent"]} == {"数组", "二叉树"}

    usage_rows = (
        await db_session.execute(
            select(UserKnowledgePointUsage).where(UserKnowledgePointUsage.user_id == admin.id)
        )
    ).scalars().all()
    assert len(usage_rows) == 2


@pytest.mark.asyncio
async def test_generate_questions_stream_ignores_missing_usage_table(
    db_session,
    admin_token: str,
) -> None:
    stream_lines = [
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"choice\\",\\"title\\":\\"Q1\\",\\"content\\":{\\"text\\":\\"C1\\"},\\"options\\":null,\\"answer\\":{\\"text\\":\\"A1\\"},\\"analysis\\":\\"解析1\\",\\"difficulty\\":3}"}}]}',
        "data: [DONE]",
    ]
    admin = (await db_session.execute(select(User).where(User.username == "admin"))).scalar_one()
    kp = KnowledgePoint(name="哈希表", owner_id=admin.id, visibility="private")
    db_session.add(kp)
    await db_session.commit()

    with patch("app.questions.ai_generate.record_user_knowledge_point_usage", side_effect=RuntimeError('relation "user_knowledge_point_usage" does not exist')):
        with patch("app.questions.ai_generate._get_model_config", return_value=("qwen", "test-key", "https://api.example.com", "test-model")):
            with patch("httpx.AsyncClient", side_effect=lambda *args, **kwargs: _FakeAsyncClient(stream_lines, *args, **kwargs)):
                events = [
                    event
                    async for event in generate_questions_stream(
                        db_session,
                        AIGenerateRequest(total_count=1, difficulty=3, model="qwen", knowledge_point_ids=[kp.id]),
                        user_id=admin.id,
                    )
                ]

    assert [event["type"] for event in events] == ["question", "done"]


@pytest.mark.asyncio
async def test_list_user_frequent_knowledge_points_returns_empty_when_usage_table_missing(
    db_session,
    admin_token: str,
) -> None:
    admin = (await db_session.execute(select(User).where(User.username == "admin"))).scalar_one()

    with patch.object(
        db_session,
        "execute",
        side_effect=RuntimeError('relation "user_knowledge_point_usage" does not exist'),
    ):
        result = await list_user_frequent_knowledge_points(db_session, admin.id)

    assert result.recent == []
    assert result.frequent == []


def test_build_system_prompt_includes_weighted_knowledge_context() -> None:
    request = AIGenerateRequest(
        total_count=6,
        difficulty=3,
        type_distribution={"choice": 4, "short_answer": 2},
        knowledge_keywords="事务, 并发控制",
        prompt="结合教学案例命题",
        model="qwen",
    )

    prompt = build_ai_generate_system_prompt(
        total_count=request.total_count,
        difficulty=request.difficulty,
        type_distribution=request.type_distribution,
        knowledge_keywords=request.knowledge_keywords,
        user_prompt=request.prompt,
        knowledge_contexts=[
            {
                "selected_name": "事务隔离级别",
                "selected_path": "数据库技术 > 事务管理 > 事务隔离级别",
                "major_name": "软件工程",
                "direction_name": "软件开发",
                "course_name": "数据库技术",
                "ancestor_names": ["数据库技术", "事务管理"],
                "child_names": ["脏读", "不可重复读", "幻读"],
            }
        ],
    )

    assert "专业：软件工程" in prompt
    assert "方向：软件开发" in prompt
    assert "主知识点（课程语境）：数据库技术" in prompt
    assert "当前重点知识点：事务隔离级别" in prompt
    assert "上层知识链路：数据库技术 > 事务管理 > 事务隔离级别" in prompt
    assert "可参考的下级知识点：脏读、不可重复读、幻读" in prompt
    assert "主知识点用于确定课程语境，是命题的核心范围，权重高于子知识点" in prompt
    assert "若存在同名或近义知识点，优先采用当前专业/方向/主知识点链路下的含义" in prompt
    assert "补充参考关键词：事务、并发控制。" in prompt
    assert "额外要求：结合教学案例命题" in prompt

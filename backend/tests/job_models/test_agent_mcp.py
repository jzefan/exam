"""Tests for the job-model MCP adapter helpers."""

import pytest

from app.job_models import agent_mcp


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def json(self):
        return self.payload

    @property
    def text(self):
        return "# Markdown"


class FakeClient:
    def __init__(self):
        self.calls = []
        self.responses = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        payload = self.responses.pop(0) if self.responses else {"ok": True, "url": url, "method": method}
        return FakeResponse(payload)


@pytest.mark.asyncio
async def test_agent_mcp_request_adds_auth_and_org_headers(monkeypatch):
    fake_client = FakeClient()

    monkeypatch.setenv("EXAM_AGENT_BASE_URL", "http://exam.local")
    monkeypatch.setenv("EXAM_AGENT_TOKEN", "token-123")
    monkeypatch.setenv("EXAM_AGENT_ORG_ID", "org-123")
    monkeypatch.setenv("EXAM_AGENT_MCP_TRANSPORT", "stdio")
    monkeypatch.delenv("ARKLOOP_OIDC_ISSUER", raising=False)
    monkeypatch.setattr(agent_mcp.httpx, "AsyncClient", lambda timeout: fake_client)

    body = await agent_mcp.request_agent_api("GET", "/api/agent/job-models", ctx=None, params={"q": "AI"})

    assert body["ok"] is True
    method, url, kwargs = fake_client.calls[0]
    assert method == "GET"
    assert url == "http://exam.local/api/agent/job-models"
    assert kwargs["headers"]["Authorization"] == "Bearer token-123"
    assert kwargs["headers"]["X-Org-Id"] == "org-123"
    assert kwargs["params"] == {"q": "AI"}


@pytest.mark.asyncio
async def test_agent_mcp_requires_per_request_token_for_http(monkeypatch):
    monkeypatch.delenv("EXAM_AGENT_TOKEN", raising=False)
    monkeypatch.delenv("ARKLOOP_OIDC_ISSUER", raising=False)
    monkeypatch.setenv("EXAM_AGENT_MCP_TRANSPORT", "streamable-http")

    with pytest.raises(RuntimeError, match="Missing per-request Authorization"):
        await agent_mcp.agent_api_headers(None)


def test_normalize_agent_question_payload_accepts_arkloop_contract_shape():
    normalized = agent_mcp.normalize_exam_question_payload(
        {
            "knowledge_point_id": "kp-1",
            "type": "multi_choice",
            "difficulty": "hard",
            "stem": "以下哪些属于数据库索引结构？",
            "options": [
                {"key": "A", "text": "B+Tree"},
                {"key": "B", "text": "Hash"},
                {"key": "C", "text": "HTTP"},
            ],
            "answer": "A,B",
            "explanation": "B+Tree 和 Hash 都可用于索引。",
        },
        question_bank_id="bank-1",
    )

    assert normalized == {
        "type": "choice",
        "title": "以下哪些属于数据库索引结构？",
        "content": {"text": "以下哪些属于数据库索引结构？"},
        "options": {"A": "B+Tree", "B": "Hash", "C": "HTTP"},
        "answer": {"correct": ["A", "B"]},
        "analysis": "B+Tree 和 Hash 都可用于索引。",
        "difficulty": 5,
        "score": 10.0,
        "tag_ids": [],
        "knowledge_point_ids": ["kp-1"],
        "question_bank_id": "bank-1",
    }


def test_normalize_agent_question_payload_forces_mcp_question_bank():
    normalized = agent_mcp.normalize_exam_question_payload(
        {
            "knowledge_point_id": "kp-1",
            "question_bank_id": "malicious-reference-bank",
            "type": "single_choice",
            "stem": "测试题",
            "answer": "A",
        },
        question_bank_id="teacher-course-bank",
    )

    assert normalized["question_bank_id"] == "teacher-course-bank"


@pytest.mark.asyncio
async def test_exam_mcp_tools_call_existing_exam_rest_endpoints(monkeypatch):
    fake_client = FakeClient()
    fake_client.responses = [
        [{"id": "kp-1", "name": "数据库索引"}],
        {"id": "course-bank-1", "name": "课程题库"},
        {"created": 1, "existing": 0, "failed": 0},
        {"id": "paper-1", "title": "数据库测验", "question_count": 1},
    ]

    monkeypatch.setenv("EXAM_AGENT_BASE_URL", "http://exam.local")
    monkeypatch.setenv("EXAM_AGENT_TOKEN", "token-123")
    monkeypatch.setenv("EXAM_AGENT_MCP_TRANSPORT", "stdio")
    monkeypatch.delenv("ARKLOOP_OIDC_ISSUER", raising=False)
    monkeypatch.setattr(agent_mcp.httpx, "AsyncClient", lambda timeout: fake_client)

    knowledge_points = await agent_mcp.exam_list_knowledge_points(exam_scope_id="scope-1", limit=20, offset=5)
    save_result = await agent_mcp.exam_save_questions(
        [
            {
                "knowledge_point_id": "kp-1",
                "question_bank_id": "reference-bank",
                "type": "single_choice",
                "difficulty": "medium",
                "stem": "B+Tree 常用于什么？",
                "options": {"A": "索引", "B": "缓存"},
                "answer": "A",
            }
        ],
    )
    paper = await agent_mcp.exam_create_paper(
        name="数据库测验",
        exam_scope_id="kp-root",
        question_ids=["q-1"],
        spec={"total_count": 1},
    )

    assert knowledge_points == {"items": [{"id": "kp-1", "name": "数据库索引"}], "total": 1}
    assert save_result["created"] == 1
    assert paper["id"] == "paper-1"

    assert fake_client.calls[0][0:2] == ("GET", "http://exam.local/api/knowledge-points")
    assert fake_client.calls[0][2]["params"] == {"exam_scope_id": "scope-1", "limit": 20, "offset": 5}
    assert fake_client.calls[1][0:2] == ("POST", "http://exam.local/api/question-banks/ensure-course-bank")
    assert fake_client.calls[2][0:2] == ("POST", "http://exam.local/api/questions/bulk")
    assert fake_client.calls[2][2]["json"]["questions"][0]["type"] == "choice"
    assert fake_client.calls[2][2]["json"]["questions"][0]["question_bank_id"] == "course-bank-1"
    assert fake_client.calls[3][0:2] == ("POST", "http://exam.local/api/papers")
    assert fake_client.calls[3][2]["json"] == {
        "title": "数据库测验",
        "description": None,
        "source_type": "ai_generated",
        "root_knowledge_point_id": "kp-root",
        "question_items": [{"question_id": "q-1", "order": 0, "score_override": None}],
    }

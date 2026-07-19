"""Tests for the job-model MCP adapter helpers."""

from types import SimpleNamespace

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


def native_context(token="exam-token", expires_at="2099-07-14T08:00:00Z"):
    return SimpleNamespace(
        request_context=SimpleNamespace(
            request=SimpleNamespace(
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Exam-Auth-Mode": "native",
                    "X-Exam-Session-Expires-At": expires_at,
                }
            )
        )
    )


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


@pytest.mark.asyncio
async def test_native_exam_session_skips_arkloop_oidc_verification(monkeypatch):
    monkeypatch.setenv("ARKLOOP_OIDC_ISSUER", "http://arkloop.local")

    token, claims = await agent_mcp.verify_request_token(native_context(), scopes=agent_mcp.READ_SCOPES)

    assert token == "exam-token"
    assert claims is None


@pytest.mark.asyncio
async def test_native_exam_session_rejects_expired_boundary(monkeypatch):
    monkeypatch.setenv("ARKLOOP_OIDC_ISSUER", "http://arkloop.local")

    with pytest.raises(RuntimeError, match="session has expired"):
        await agent_mcp.verify_request_token(
            native_context(expires_at="2020-01-01T00:00:00Z"),
            scopes=agent_mcp.READ_SCOPES,
        )


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
        {"created": 1, "existing": 0, "failed": 0},
        [],
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
    assert fake_client.calls[1][0:2] == (
        "POST",
        "http://exam.local/api/questions/save-generated-to-course-bank",
    )
    assert fake_client.calls[1][2]["json"]["questions"][0]["type"] == "choice"
    assert fake_client.calls[1][2]["json"]["questions"][0]["knowledge_point_ids"] == []
    assert fake_client.calls[2][0:2] == ("GET", "http://exam.local/api/papers")
    assert fake_client.calls[3][0:2] == ("POST", "http://exam.local/api/papers")
    assert fake_client.calls[3][2]["json"] == {
        "title": "数据库测验",
        "description": None,
        "source_type": "ai_generated",
        "root_knowledge_point_id": "kp-root",
        "question_items": [{"question_id": "q-1", "order": 0, "score_override": None}],
    }


@pytest.mark.asyncio
async def test_grading_tools_use_pregraded_exam_data_and_confirm_override(monkeypatch):
    fake_client = FakeClient()
    fake_client.responses = [
        # Initial candidate review.
        {
            "title": "期末考试",
            "submitted_at": "2026-07-13T01:00:00Z",
            "grading_status": "ai_scored",
            "objective_score": 40,
            "subjective_score": 8,
            "score": 48,
            "total_score": 100,
            "can_view": True,
            "questions": [
                {
                    "question_id": "q-1",
                    "order": 1,
                    "type": "short_answer",
                    "total_score": 10,
                    "score_awarded": 8,
                    "feedback": {"summary": "要点基本完整"},
                }
            ],
        },
        {"exams": [{"exam_id": "exam-1", "exam_label": "期末考试", "questions": [
            {"question_id": "q-1", "question_label": "第1题", "question_type": "short_answer", "max_score": 10}
        ]}]},
        {"question_id": "q-1", "question_label": "第1题", "question_type": "short_answer", "max_score": 10,
         "candidates": [{"task_id": "task-1", "student_id": "student-1", "status": "待确认", "score": 8}]},
        {"models": [{"stage": "primary", "model_label": "Qwen / qwen-plus", "score": 8, "summary": "要点基本完整", "process": [], "risk_flags": []}],
         "feedback": {"dimensions": [{"name": "准确性", "score": 8, "max_score": 10, "comment": "基本准确"}], "strengths": [], "deductions": [], "suggestions": [], "risk_flags": [], "evidence_lines": []}},
        # Manual score and confirm writes.
        {"id": "snapshot-1", "snapshot_type": "manual", "score_total": 9},
        {"status": "completed", "grading_status": "reviewed"},
        # Refreshed candidate review.
        {
            "title": "期末考试",
            "submitted_at": "2026-07-13T01:00:00Z",
            "grading_status": "reviewed",
            "objective_score": 40,
            "subjective_score": 9,
            "score": 49,
            "total_score": 100,
            "can_view": True,
            "questions": [
                {"question_id": "q-1", "order": 1, "type": "short_answer", "total_score": 10, "score_awarded": 9}
            ],
        },
        {"exams": [{"exam_id": "exam-1", "exam_label": "期末考试", "questions": [
            {"question_id": "q-1", "question_label": "第1题", "question_type": "short_answer", "max_score": 10}
        ]}]},
        {"question_id": "q-1", "question_label": "第1题", "question_type": "short_answer", "max_score": 10,
         "candidates": [{"task_id": "task-1", "student_id": "student-1", "status": "已确认", "score": 9}]},
        {"models": [{"stage": "primary", "model_label": "Qwen / qwen-plus", "score": 9, "summary": "已确认", "process": [], "risk_flags": []}], "feedback": None},
    ]

    monkeypatch.setenv("EXAM_AGENT_BASE_URL", "http://exam.local")
    monkeypatch.setattr(agent_mcp.httpx, "AsyncClient", lambda timeout: fake_client)

    result = await agent_mcp.exam_confirm_grading_question(
        exam_id="exam-1",
        student_id="student-1",
        question_id="q-1",
        task_id="task-1",
        score=9,
        reason=None,
        ctx=native_context(),
    )

    assert result["ok"] is True
    assert result["score_changed"] is True
    assert result["review"]["completed"] is True
    assert result["review"]["subjective_questions"][0]["ai_models"][0]["model_label"] == "Qwen / qwen-plus"
    assert fake_client.calls[4][0:2] == ("POST", "http://exam.local/api/grading/tasks/task-1/manual-score")
    assert fake_client.calls[4][2]["json"] == {
        "score_total": 9.0,
        "reason": "阅卷智能体人工改分",
    }
    assert fake_client.calls[5][0:2] == ("POST", "http://exam.local/api/grading/tasks/task-1/confirm")


@pytest.mark.asyncio
async def test_candidate_review_uses_candidate_identity_fallback_when_task_lacks_student_id(monkeypatch):
    fake_client = FakeClient()
    fake_client.responses = [
        {
            "title": "期末考试",
            "submitted_at": "2026-07-13T01:00:00Z",
            "objective_score": 2,
            "subjective_score": 6,
            "score": 8,
            "total_score": 24,
            "questions": [
                {
                    "question_id": "q-3",
                    "order": 3,
                    "type": "short_answer",
                    "total_score": 3,
                    "score_awarded": 2,
                }
            ],
        },
        {"exams": [{"exam_id": "exam-1", "exam_label": "期末考试", "questions": [
            {"question_id": "q-3", "question_label": "第3题", "question_type": "short_answer", "max_score": 3}
        ]}]},
        {"question_id": "q-3", "question_label": "第3题", "question_type": "short_answer", "max_score": 3,
         "candidates": [{"task_id": "task-3", "candidate_code": "13585116509", "candidate_name": "stud-2", "status": "待确认", "score": 2}]},
        {"students": [{"student_id": "student-2", "username": "13585116509"}]},
        {"models": [], "feedback": None},
    ]

    monkeypatch.setenv("EXAM_AGENT_BASE_URL", "http://exam.local")
    monkeypatch.setattr(agent_mcp.httpx, "AsyncClient", lambda timeout: fake_client)

    result = await agent_mcp.exam_get_candidate_review(
        exam_id="exam-1",
        student_id="student-2",
        ctx=native_context(),
    )

    assert result["pending_count"] == 1
    assert result["next_pending_question"]["question_id"] == "q-3"
    assert result["next_pending_question"]["task_id"] == "task-3"
    assert fake_client.calls[3][0:2] == ("GET", "http://exam.local/api/exams/exam-1/analysis")


@pytest.mark.asyncio
async def test_candidate_review_keeps_inbox_task_when_result_has_no_subjective_question(monkeypatch):
    fake_client = FakeClient()
    fake_client.responses = [
        {
            "title": "期末考试",
            "submitted_at": "2026-07-13T01:00:00Z",
            "objective_score": 2,
            "subjective_score": 6,
            "score": 8,
            "total_score": 24,
            "questions": [{"question_id": "objective-1", "order": 1, "type": "choice", "total_score": 2}],
        },
        {"exams": [{"exam_id": "exam-1", "exam_label": "期末考试", "questions": [
            {"question_id": "q-3", "question_label": "第3题", "question_type": "short_answer", "max_score": 3}
        ]}]},
        {"question_id": "q-3", "question_label": "第3题", "question_type": "short_answer", "max_score": 3,
         "question_content": "请说明答案", "candidates": [{"task_id": "task-3", "student_id": "student-2", "status": "待确认", "score": 2}]},
        {"models": [], "feedback": None},
    ]

    monkeypatch.setenv("EXAM_AGENT_BASE_URL", "http://exam.local")
    monkeypatch.setattr(agent_mcp.httpx, "AsyncClient", lambda timeout: fake_client)

    result = await agent_mcp.exam_get_candidate_review(
        exam_id="exam-1",
        student_id="student-2",
        ctx=native_context(),
    )

    assert result["pending_count"] == 1
    assert result["next_pending_question"]["question_id"] == "q-3"
    assert result["next_pending_question"]["task_id"] == "task-3"
    assert result["next_pending_question"]["content"] == "请说明答案"


def test_score_shape_is_cautious_for_small_samples_and_descriptive_for_larger_sets():
    small = agent_mcp._score_shape([55, 65, 75])
    symmetric = agent_mcp._score_shape([55, 60, 65, 70, 75, 80, 85, 90])

    assert small["assessment"] == "insufficient_sample"
    assert small["approximately_normal"] is None
    assert symmetric["sample_size"] == 8
    assert "method_note" in symmetric

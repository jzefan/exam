"""MCP adapter for Exam platform agent APIs.

Run with:
    EXAM_AGENT_BASE_URL=http://localhost:8000 \
    ARKLOOP_OIDC_ISSUER=http://localhost:19000 \
    EXAM_MCP_EXPECTED_AUD=exam-web \
    EXAM_AGENT_MCP_TRANSPORT=streamable-http \
    python -m app.job_models.agent_mcp

For local single-user stdio development only, EXAM_AGENT_TOKEN can still be
used as a static fallback token.
"""

from __future__ import annotations

import os
from typing import Any, Literal

import httpx
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from app.auth.oidc_client import OIDCClient, OIDCError


# When host is 127.0.0.1/localhost, FastMCP auto-enables DNS-rebinding protection
# with an allowlist that only covers 127.0.0.1/localhost/::1. The ArkLoop worker runs
# inside Docker and reaches this server via host.docker.internal, whose Host header is
# then rejected with "Invalid Host header" — so the worker can't discover the exam
# tools and silently falls back to local storage. Keep the protection on but extend
# the allowlist with the docker-host alias (configurable via env).
_extra_hosts = [
    h.strip()
    for h in os.environ.get("EXAM_AGENT_MCP_EXTRA_HOSTS", "host.docker.internal").split(",")
    if h.strip()
]
_transport_security = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"] + [f"{h}:*" for h in _extra_hosts],
    allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]
    + [f"http://{h}:*" for h in _extra_hosts],
)

mcp = FastMCP(
    "exam-agent",
    instructions=(
        "Use the Exam platform through stable backend APIs. Supports job competency "
        "models and ArkLoop smart paper/question workflows without direct database access."
    ),
    host=os.environ.get("EXAM_AGENT_MCP_HOST", "127.0.0.1"),
    port=int(os.environ.get("EXAM_AGENT_MCP_PORT", "8001")),
    streamable_http_path=os.environ.get("EXAM_AGENT_MCP_PATH", "/mcp"),
    transport_security=_transport_security,
)


QUESTION_TYPE_ALIASES = {
    "choice": "choice",
    "single_choice": "choice",
    "single": "choice",
    "multi_choice": "choice",
    "multiple_choice": "choice",
    "multiple": "choice",
    "true_false": "true_false",
    "judge": "true_false",
    "judgement": "true_false",
    "judgment": "true_false",
    "fill_in": "fill_in",
    "blank": "fill_in",
    "short_answer": "short_answer",
    "essay": "essay",
    "code": "code",
}
DIFFICULTY_ALIASES = {
    "easy": 1,
    "simple": 1,
    "low": 1,
    "简单": 1,
    "medium": 3,
    "normal": 3,
    "middle": 3,
    "中等": 3,
    "中级": 3,
    "hard": 5,
    "difficult": 5,
    "high": 5,
    "困难": 5,
    "高级": 5,
}
OBJECTIVE_SPLIT_CHARS = ",，;；、"
READ_SCOPES = ("exam:read", "exam:read:questions", "exam:read:knowledge-points")
WRITE_SCOPES = ("exam:write", "exam:write:questions", "exam:write:papers")

_oidc_client: OIDCClient | None = None


class MCPAuthError(RuntimeError):
    """Raised when an MCP request lacks a valid acting-user Bearer token."""


def agent_base_url() -> str:
    return os.environ.get("EXAM_AGENT_BASE_URL", "http://localhost:8000").rstrip("/")


def reference_question_bank_id() -> str | None:
    value = os.environ.get("EXAM_REFERENCE_QUESTION_BANK_ID", "").strip()
    return value or None


def reference_admin_token() -> str | None:
    value = os.environ.get("EXAM_REFERENCE_ADMIN_TOKEN", "").strip()
    return value or None


def mcp_transport() -> str:
    return os.environ.get("EXAM_AGENT_MCP_TRANSPORT", "streamable-http").strip().replace("_", "-")


def _request_authorization(ctx: Context | None) -> str | None:
    if ctx is None:
        return None
    try:
        request = ctx.request_context.request
    except ValueError:
        return None
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    authorization = headers.get("authorization") or headers.get("Authorization")
    return authorization.strip() if isinstance(authorization, str) and authorization.strip() else None


def _static_agent_token_allowed() -> bool:
    if os.environ.get("EXAM_MCP_ALLOW_STATIC_TOKEN", "").strip().lower() in {"1", "true", "yes"}:
        return True
    # stdio has no per-request HTTP headers, so keep the old static-token path
    # only for local single-user development.
    return mcp_transport() == "stdio"


def _request_bearer_token(ctx: Context | None) -> str:
    authorization = _request_authorization(ctx)
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise MCPAuthError("MCP request Authorization header must be 'Bearer <token>'.")
        return token.strip()

    if _static_agent_token_allowed():
        token = os.environ.get("EXAM_AGENT_TOKEN", "").strip()
        if token:
            return token

    raise MCPAuthError("Missing per-request Authorization Bearer token for Exam MCP access.")


def _scope_set(claims: dict[str, Any]) -> set[str]:
    raw_scope = claims.get("scope")
    if isinstance(raw_scope, str):
        return {item for item in raw_scope.split() if item}
    if isinstance(raw_scope, list):
        return {str(item) for item in raw_scope if item}
    return set()


def _ensure_any_scope(claims: dict[str, Any], allowed_scopes: tuple[str, ...]) -> None:
    scopes = _scope_set(claims)
    if scopes and not scopes.intersection(allowed_scopes):
        raise MCPAuthError(
            "OIDC token is missing required scope: one of "
            + ", ".join(allowed_scopes)
        )


def _mcp_oidc_client() -> OIDCClient | None:
    global _oidc_client
    issuer = os.environ.get("ARKLOOP_OIDC_ISSUER", "").strip().rstrip("/")
    if not issuer:
        return None
    expected_aud = os.environ.get("EXAM_MCP_EXPECTED_AUD", "exam-web").strip()
    if _oidc_client is None or _oidc_client.issuer != issuer or _oidc_client.client_id != expected_aud:
        _oidc_client = OIDCClient(
            issuer=issuer,
            client_id=expected_aud,
            client_secret="",
            redirect_uri="",
            jwks_ttl_seconds=int(os.environ.get("EXAM_MCP_JWKS_CACHE_TTL_SECONDS", "3600")),
        )
    return _oidc_client


async def verify_request_token(ctx: Context | None, *, scopes: tuple[str, ...]) -> tuple[str, dict[str, Any] | None]:
    """Return the acting-user Bearer token after optional ArkLoop OIDC verification.

    When ARKLOOP_OIDC_ISSUER is configured, MCP itself verifies the RS256 token
    and audience before forwarding it to the exam REST boundary. The REST layer
    still performs its own token resolution, user provisioning, permission checks,
    organization isolation, and activity logging.
    """
    token = _request_bearer_token(ctx)
    oidc = _mcp_oidc_client()
    if oidc is None:
        return token, None
    expected_aud = os.environ.get("EXAM_MCP_EXPECTED_AUD", "exam-web").strip()
    try:
        claims = await oidc.verify_token(token, audience=expected_aud)
    except OIDCError as exc:
        raise MCPAuthError(f"Invalid ArkLoop OIDC token: {exc}") from exc
    _ensure_any_scope(claims, scopes)
    return token, claims


async def agent_api_headers(ctx: Context | None, *, scopes: tuple[str, ...] = READ_SCOPES) -> dict[str, str]:
    token, claims = await verify_request_token(ctx, scopes=scopes)
    headers = {"Authorization": f"Bearer {token}"}
    if claims:
        headers["X-Exam-MCP-Subject"] = str(claims.get("sub") or "")
        headers["X-Exam-MCP-Internal-Issue"] = str(claims.get("internal_issue") or "").lower()
    org_id = os.environ.get("EXAM_AGENT_ORG_ID", "").strip()
    if org_id:
        headers["X-Org-Id"] = org_id
    return headers


async def reference_api_headers(ctx: Context | None) -> dict[str, str]:
    # The request still needs a valid teacher token, but the reference query is
    # executed with the server-held read-only admin/service credential.
    teacher_token, claims = await verify_request_token(ctx, scopes=READ_SCOPES)
    token = reference_admin_token()
    if not token:
        raise MCPAuthError("EXAM_REFERENCE_ADMIN_TOKEN is required for reference question reads.")
    headers = {"Authorization": f"Bearer {token}"}
    if claims:
        headers["X-Exam-MCP-Acting-Subject"] = str(claims.get("sub") or "")
    else:
        headers["X-Exam-MCP-Acting-Token-Present"] = "true" if teacher_token else "false"
    org_id = os.environ.get("EXAM_REFERENCE_ADMIN_ORG_ID", "").strip() or os.environ.get("EXAM_AGENT_ORG_ID", "").strip()
    if org_id:
        headers["X-Org-Id"] = org_id
    return headers


def _backend_error(response: httpx.Response) -> RuntimeError:
    try:
        payload = response.json()
    except ValueError:
        payload = response.text
    detail = payload.get("detail") if isinstance(payload, dict) else payload
    return RuntimeError(f"Exam backend {response.status_code}: {detail}")


async def request_agent_api(
    method: str,
    path: str,
    *,
    ctx: Context | None,
    params: dict[str, Any] | None = None,
    json: dict[str, Any] | None = None,
    scopes: tuple[str, ...] = READ_SCOPES,
    headers: dict[str, str] | None = None,
) -> Any:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.request(
            method,
            f"{agent_base_url()}{path}",
            headers=headers or await agent_api_headers(ctx, scopes=scopes),
            params=params,
            json=json,
        )
        if response.status_code >= 400:
            raise _backend_error(response)
        return response.json()


async def request_agent_text(
    method: str,
    path: str,
    *,
    ctx: Context | None,
    params: dict[str, Any] | None = None,
    json: dict[str, Any] | None = None,
    scopes: tuple[str, ...] = READ_SCOPES,
) -> str:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.request(
            method,
            f"{agent_base_url()}{path}",
            headers=await agent_api_headers(ctx, scopes=scopes),
            params=params,
            json=json,
        )
        if response.status_code >= 400:
            raise _backend_error(response)
        return response.text


def _non_empty_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_question_type(value: Any) -> str:
    raw = str(value or "choice").strip()
    return QUESTION_TYPE_ALIASES.get(raw, raw if raw in set(QUESTION_TYPE_ALIASES.values()) else "choice")


def _normalize_difficulty(value: Any) -> int:
    if isinstance(value, (int, float)):
        return min(5, max(1, int(value)))
    if isinstance(value, str) and value.strip():
        raw = value.strip().lower()
        if raw.isdigit():
            return min(5, max(1, int(raw)))
        return DIFFICULTY_ALIASES.get(raw, 3)
    return 3


def _normalize_options(value: Any) -> dict[str, str] | None:
    if isinstance(value, dict):
        options: dict[str, str] = {}
        for key, text in value.items():
            if isinstance(text, dict):
                text = text.get("text") or text.get("label") or text.get("value")
            options[str(key)] = str(text or "")
        return options or None
    if isinstance(value, list):
        options = {}
        for index, item in enumerate(value):
            key = chr(ord("A") + index)
            text = item
            if isinstance(item, dict):
                explicit_text = item.get("text") or item.get("value") or item.get("content")
                if explicit_text is not None:
                    # Standard shape: {"key": "A", "text": "..."}
                    key = str(item.get("key") or item.get("label") or key)
                    text = explicit_text
                elif len(item) == 1:
                    # ArkLoop shape: {"A": "option text"} — letter key maps straight to text.
                    only_key, only_value = next(iter(item.items()))
                    key = str(only_key) or key
                    text = only_value
                else:
                    key = str(item.get("key") or item.get("label") or key)
                    text = None
            options[key] = str(text or "")
        return options or None
    return None


def _split_answer_keys(value: str) -> list[str]:
    items: list[str] = []
    current = value
    for char in OBJECTIVE_SPLIT_CHARS:
        current = current.replace(char, ",")
    for item in current.split(","):
        answer = item.strip()
        if answer:
            items.append(answer)
    return items


def _normalize_answer(value: Any, question_type: str, raw_type: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if question_type == "choice":
        if isinstance(value, list):
            return {"correct": [str(item) for item in value]}
        answer_text = str(value or "").strip()
        should_split = "multi" in str(raw_type or "").lower() or any(char in answer_text for char in OBJECTIVE_SPLIT_CHARS)
        return {"correct": _split_answer_keys(answer_text) if should_split else answer_text}
    if question_type == "true_false":
        if isinstance(value, bool):
            return {"correct": value}
        normalized = str(value or "").strip().lower()
        return {"correct": normalized in {"正确", "对", "true", "t", "yes", "y", "1", "√"}}
    if question_type == "fill_in":
        if isinstance(value, list):
            return {"correct": [str(item) for item in value]}
        return {"correct": _split_answer_keys(str(value or ""))}
    if question_type == "code":
        return {"code": str(value or "")}
    if isinstance(value, list):
        return {"points": [str(item) for item in value]}
    return {"points": [line.strip() for line in str(value or "").splitlines() if line.strip()]}


def normalize_exam_question_payload(question: dict[str, Any], *, question_bank_id: str | None = None) -> dict[str, Any]:
    """Normalize ArkLoop-style question payloads to this backend's QuestionCreate schema."""

    raw_type = question.get("type")
    question_type = _normalize_question_type(raw_type)
    raw_content = question.get("content")
    stem = _non_empty_text(
        question.get("stem"),
        question.get("content_text"),
        question.get("title"),
        raw_content.get("text") if isinstance(raw_content, dict) else None,
        raw_content.get("html") if isinstance(raw_content, dict) else None,
    )
    title = _non_empty_text(question.get("title"), stem[:120], "AI 生成题目")
    content = raw_content if isinstance(raw_content, dict) else {"text": stem or title}
    knowledge_point_ids = question.get("knowledge_point_ids")
    if not isinstance(knowledge_point_ids, list):
        knowledge_point_id = question.get("knowledge_point_id")
        knowledge_point_ids = [knowledge_point_id] if knowledge_point_id else []

    normalized_bank_id = question_bank_id or question.get("question_bank_id")
    return {
        "type": question_type,
        "title": title[:500],
        "content": content,
        "options": _normalize_options(question.get("options")) if question_type == "choice" else None,
        "answer": _normalize_answer(question.get("answer"), question_type, raw_type),
        "analysis": question.get("analysis") or question.get("explanation"),
        "difficulty": _normalize_difficulty(question.get("difficulty")),
        "score": float(question.get("score") or 10.0),
        "tag_ids": question.get("tag_ids") if isinstance(question.get("tag_ids"), list) else [],
        "knowledge_point_ids": knowledge_point_ids,
        "question_bank_id": normalized_bank_id,
    }


def _collection_response(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict) and "items" in payload:
        return payload
    if isinstance(payload, list):
        return {"items": payload, "total": len(payload)}
    return {"items": [], "total": 0, "raw": payload}


@mcp.tool(description="Search job competency models by keyword, taxonomy, and model type.")
async def search_job_models(
    q: str | None = None,
    model_type: str | None = None,
    industry_name: str | None = None,
    direction_name: str | None = None,
    start: int = 0,
    end: int = 20,
    ctx: Context | None = None,
) -> dict[str, Any]:
    return await request_agent_api(
        "GET",
        "/api/agent/job-models",
        ctx=ctx,
        params={
            "q": q,
            "model_type": model_type,
            "industry_name": industry_name,
            "direction_name": direction_name,
            "_start": start,
            "_end": end,
        },
    )


@mcp.tool(description="Get one full job model with current version, dimensions, skills, and knowledge points.")
async def get_job_model(model_id: str, ctx: Context | None = None) -> dict[str, Any]:
    return await request_agent_api("GET", f"/api/agent/job-models/{model_id}", ctx=ctx)


@mcp.tool(description="Export a job model as JSON or Markdown.")
async def export_job_model(
    model_id: str,
    format: Literal["json", "markdown"] = "markdown",
    ctx: Context | None = None,
) -> Any:
    if format == "markdown":
        return await request_agent_text(
            "GET",
            f"/api/agent/job-models/{model_id}/export",
            ctx=ctx,
            params={"format": "markdown"},
        )
    return await request_agent_api(
        "GET",
        f"/api/agent/job-models/{model_id}/export",
        ctx=ctx,
        params={"format": "json"},
    )


@mcp.tool(description="Recommend the best standard job model for a JD or free-text job description.")
async def recommend_standard_job_model(job_text: str, ctx: Context | None = None) -> dict[str, Any]:
    return await request_agent_api(
        "POST",
        "/api/agent/job-models/recommend-standard",
        ctx=ctx,
        json={"job_text": job_text},
    )


@mcp.tool(description="Create a draft job model from a structured competency model payload.")
async def create_draft_job_model(payload: dict[str, Any], ctx: Context | None = None) -> dict[str, Any]:
    return await request_agent_api("POST", "/api/agent/job-models/drafts", ctx=ctx, json=payload, scopes=WRITE_SCOPES)


@mcp.tool(description="Preview structure counts before applying a job model structure update.")
async def preview_job_model_structure(
    model_id: str,
    dimensions: list[dict[str, Any]],
    ctx: Context | None = None,
) -> dict[str, Any]:
    return await request_agent_api(
        "POST",
        f"/api/agent/job-models/{model_id}/structure-preview",
        ctx=ctx,
        json={"dimensions": dimensions},
    )


@mcp.tool(description="Replace the current structure of a draft job model.")
async def replace_draft_job_model_structure(
    model_id: str,
    dimensions: list[dict[str, Any]],
    ctx: Context | None = None,
) -> dict[str, Any]:
    return await request_agent_api(
        "PUT",
        f"/api/agent/job-models/{model_id}/structure",
        ctx=ctx,
        json={"dimensions": dimensions},
        scopes=WRITE_SCOPES,
    )


@mcp.tool(description="Publish a new current version of a job model.")
async def publish_job_model(
    model_id: str,
    version_note: str | None = None,
    ctx: Context | None = None,
) -> dict[str, Any]:
    return await request_agent_api(
        "POST",
        f"/api/agent/job-models/{model_id}/publish",
        ctx=ctx,
        json={"version_note": version_note},
        scopes=WRITE_SCOPES,
    )


@mcp.tool(description="List teacher-visible Exam knowledge points for ArkLoop smart question and paper workflows.")
async def exam_list_knowledge_points(
    exam_scope_id: str | None = None,
    limit: int = 500,
    offset: int = 0,
    ctx: Context | None = None,
) -> dict[str, Any]:
    payload = await request_agent_api(
        "GET",
        "/api/knowledge-points",
        ctx=ctx,
        params={"exam_scope_id": exam_scope_id, "limit": limit, "offset": offset},
    )
    return _collection_response(payload)


@mcp.tool(description="List teacher-visible Exam question banks.")
async def exam_list_question_banks(ctx: Context | None = None) -> dict[str, Any]:
    payload = await request_agent_api("GET", "/api/question-banks", ctx=ctx)
    return _collection_response(payload)


@mcp.tool(description="Ensure the current teacher has the fixed course question bank used by ArkLoop generated questions.")
async def exam_ensure_course_question_bank(ctx: Context | None = None) -> dict[str, Any]:
    return await request_agent_api(
        "POST",
        "/api/question-banks/ensure-course-bank",
        ctx=ctx,
        scopes=WRITE_SCOPES,
    )


@mcp.tool(description="List reusable Exam questions by knowledge point, type, difficulty, and pagination.")
async def exam_list_questions(
    knowledge_point_id: str,
    question_type: str | None = None,
    difficulty: str | int | None = None,
    limit: int = 20,
    offset: int = 0,
    ctx: Context | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "knowledge_point_id": knowledge_point_id,
        "_start": offset,
        "_end": offset + limit,
    }
    if question_type:
        params["type"] = _normalize_question_type(question_type)
    if difficulty is not None:
        params["difficulty"] = _normalize_difficulty(difficulty)
    payload = await request_agent_api("GET", "/api/questions", ctx=ctx, params=params)
    return _collection_response(payload)


@mcp.tool(
    description=(
        "List read-only national/reference questions for seed examples. "
        "The request is authenticated as the teacher, then the backend read is "
        "performed with EXAM_REFERENCE_ADMIN_TOKEN and never writes to the reference bank."
    )
)
async def exam_list_reference_questions(
    knowledge_point_id: str,
    question_bank_id: str | None = None,
    question_type: str | None = None,
    difficulty: str | int | None = None,
    limit: int = 20,
    offset: int = 0,
    ctx: Context | None = None,
) -> dict[str, Any]:
    target_bank_id = question_bank_id or reference_question_bank_id()
    if not target_bank_id:
        raise RuntimeError("question_bank_id or EXAM_REFERENCE_QUESTION_BANK_ID is required for reference reads.")
    params: dict[str, Any] = {
        "knowledge_point_id": knowledge_point_id,
        "question_bank_id": target_bank_id,
        "_start": offset,
        "_end": offset + limit,
    }
    if question_type:
        params["type"] = _normalize_question_type(question_type)
    if difficulty is not None:
        params["difficulty"] = _normalize_difficulty(difficulty)
    payload = await request_agent_api(
        "GET",
        "/api/questions",
        ctx=ctx,
        params=params,
        headers=await reference_api_headers(ctx),
    )
    response = _collection_response(payload)
    response["readonly_reference"] = True
    response["question_bank_id"] = target_bank_id
    return response


@mcp.tool(
    description="Save teacher-confirmed AI questions into the teacher's default course bank. "
    "Returns created_question_ids — pass those to exam_create_paper to assemble a paper."
)
async def exam_save_questions(
    questions: list[dict[str, Any]],
    ctx: Context | None = None,
) -> dict[str, Any]:
    normalized_questions = [normalize_exam_question_payload(question) for question in questions]
    # ArkLoop KB knowledge-point ids (especially for standalone course KBs) are NOT
    # Exam knowledge points; forwarding them rejects the batch with "Knowledge point
    # not found". Drafts land in the teacher's private course bank where Exam-KP
    # linkage is optional, so drop the unresolved ids here.
    for normalized in normalized_questions:
        normalized["knowledge_point_ids"] = []
    # Purpose-built endpoint: lands questions in the teacher's default course bank AND
    # returns created_question_ids (the generic /api/questions/bulk returns counts only,
    # leaving the agent with no ids to build a paper from).
    return await request_agent_api(
        "POST",
        "/api/questions/save-generated-to-course-bank",
        ctx=ctx,
        json={"questions": normalized_questions},
        scopes=WRITE_SCOPES,
    )


DEFAULT_PAPER_TITLE = "智能组卷试卷"


async def _unique_paper_title(base: str | None, ctx: Context | None) -> str:
    """Pick a paper title, appending （2）/（3）… when the base name already exists."""
    base = (base or "").strip() or DEFAULT_PAPER_TITLE
    try:
        existing = await request_agent_api("GET", "/api/papers", ctx=ctx)
    except Exception:
        # If we can't list papers, fall back to the base name — a duplicate title
        # is allowed by the backend and far better than failing the whole compose.
        return base
    items = existing.get("items") if isinstance(existing, dict) else existing
    titles = {
        str(item["title"])
        for item in (items or [])
        if isinstance(item, dict) and item.get("title")
    }
    if base not in titles:
        return base
    index = 2
    while f"{base}（{index}）" in titles:
        index += 1
    return f"{base}（{index}）"


@mcp.tool(
    description="Create an Exam paper (试卷, not an exam) from an ordered question id list. "
    "Leave name empty for a default title; duplicate names auto-increment （2）（3）…"
)
async def exam_create_paper(
    question_ids: list[str],
    name: str | None = None,
    exam_scope_id: str | None = None,
    spec: dict[str, Any] | None = None,
    description: str | None = None,
    ctx: Context | None = None,
) -> dict[str, Any]:
    paper_description = description
    if paper_description is None and spec and spec.get("summary"):
        paper_description = str(spec["summary"])
    title = await _unique_paper_title(name, ctx)
    return await request_agent_api(
        "POST",
        "/api/papers",
        ctx=ctx,
        json={
            "title": title,
            "description": paper_description,
            "source_type": "ai_generated",
            "root_knowledge_point_id": exam_scope_id,
            "question_items": [
                {"question_id": question_id, "order": index, "score_override": None}
                for index, question_id in enumerate(question_ids)
            ],
        },
        scopes=WRITE_SCOPES,
    )


@mcp.prompt(description="Guide an agent to generate a job competency model from a JD.")
def jd_to_job_model_prompt(job_description: str) -> str:
    return (
        "请根据以下岗位 JD 生成岗位能力模型草稿。输出必须包含岗位名称、产业方向、能力维度、"
        "技能项、知识点、建议等级和教学建议。先调用 recommend_standard_job_model 查找可复用标准岗位，"
        "再生成企业草稿。\n\n"
        f"JD:\n{job_description}"
    )


def main() -> None:
    transport = mcp_transport()
    if transport not in {"stdio", "sse", "streamable-http"}:
        raise RuntimeError("EXAM_AGENT_MCP_TRANSPORT must be stdio, sse, streamable_http, or streamable-http")
    mcp.run(transport=transport)


if __name__ == "__main__":
    main()

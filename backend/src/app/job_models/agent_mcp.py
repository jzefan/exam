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

import asyncio
import math
import os
from datetime import datetime, timezone
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


def _request_header(ctx: Context | None, name: str) -> str | None:
    if ctx is None:
        return None
    try:
        request = ctx.request_context.request
    except ValueError:
        return None
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    value = headers.get(name) or headers.get(name.lower())
    return value.strip() if isinstance(value, str) and value.strip() else None


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
    # Native Exam login sessions are already authenticated by Exam's own REST
    # dependency. The explicit header is stored in ArkLoop's encrypted, per-profile
    # MCP auth secret; it only selects the verifier and does not bypass downstream
    # Exam permission checks.
    if (_request_header(ctx, "X-Exam-Auth-Mode") or "").lower() == "native":
        expires_at = _request_header(ctx, "X-Exam-Session-Expires-At")
        if not expires_at:
            raise MCPAuthError("Native Exam session is missing its expiry boundary.")
        try:
            expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise MCPAuthError("Native Exam session has an invalid expiry boundary.") from exc
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= expiry.astimezone(timezone.utc):
            raise MCPAuthError("Native Exam session has expired; please sign in again.")
        return token, None
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


SUBJECTIVE_QUESTION_TYPES = {"short_answer", "essay", "code"}
CONFIRMED_GRADING_STATUSES = {"已确认", "人工改分", "confirmed", "reviewed"}


def _grading_status_confirmed(value: Any) -> bool:
    return str(value or "").strip().lower() in {item.lower() for item in CONFIRMED_GRADING_STATUSES}


async def _exam_grading_matrix(exam_id: str, ctx: Context | None) -> dict[str, Any]:
    inbox = await request_agent_api(
        "GET",
        "/api/grading/inbox",
        ctx=ctx,
        params={"exam_id": exam_id},
    )
    groups = inbox.get("exams", []) if isinstance(inbox, dict) else []
    exam_group = next(
        (item for item in groups if isinstance(item, dict) and str(item.get("exam_id") or "") == exam_id),
        None,
    )
    if exam_group is None:
        return {"exam_id": exam_id, "exam_label": "", "questions": [], "candidate_tasks": {}}

    questions: list[dict[str, Any]] = []
    candidate_tasks: dict[str, list[dict[str, Any]]] = {}
    for question in exam_group.get("questions", []):
        if not isinstance(question, dict):
            continue
        question_id = str(question.get("question_id") or "")
        if not question_id:
            continue
        detail = await request_agent_api(
            "GET",
            f"/api/grading/inbox/questions/{exam_id}/{question_id}",
            ctx=ctx,
        )
        normalized_question = {
            "question_id": question_id,
            "question_label": detail.get("question_label") or question.get("question_label") or question_id,
            "question_type": detail.get("question_type") or question.get("question_type"),
            "question_content": detail.get("question_content") or question.get("question_content") or "",
            "max_score": detail.get("max_score") or question.get("max_score") or 0,
            "pending_count": question.get("pending_count", 0),
            "completed_count": question.get("completed_count", 0),
        }
        questions.append(normalized_question)
        for candidate in detail.get("candidates", []):
            if not isinstance(candidate, dict):
                continue
            student_id = str(candidate.get("student_id") or "").strip()
            fallback_key = str(candidate.get("candidate_code") or candidate.get("candidate_name") or "").strip()
            candidate_key = student_id or fallback_key
            if not candidate_key:
                continue
            candidate_tasks.setdefault(candidate_key, []).append(
                {
                    **normalized_question,
                    "task_id": candidate.get("task_id"),
                    "student_id": student_id or None,
                    "candidate_name": candidate.get("candidate_name"),
                    "candidate_code": candidate.get("candidate_code"),
                    "status": candidate.get("status"),
                    "score": candidate.get("score"),
                    "manual_override": bool(candidate.get("manual_override")),
                    "arbitration_required": bool(candidate.get("arbitration_required")),
                }
            )
    return {
        "exam_id": exam_id,
        "exam_label": exam_group.get("exam_label") or "",
        "questions": questions,
        "candidate_tasks": candidate_tasks,
    }


def _candidate_task_rows(matrix: dict[str, Any], student: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = matrix.get("candidate_tasks", {})
    student_id = str(student.get("student_id") or "")
    if student_id and student_id in candidates:
        return list(candidates[student_id])
    for fallback in (student.get("username"), student.get("phone"), student.get("full_name")):
        key = str(fallback or "").strip()
        if key and key in candidates:
            return list(candidates[key])
    return []


def _candidate_review_status(student: dict[str, Any], tasks: list[dict[str, Any]]) -> str:
    if not student.get("submitted_at"):
        return "unsubmitted"
    if not tasks:
        return "objective_only"
    confirmed = sum(1 for task in tasks if _grading_status_confirmed(task.get("status")))
    if confirmed == len(tasks):
        return "completed"
    if confirmed > 0:
        return "partially_confirmed"
    return "pending_confirmation"


async def _grading_task_evaluations(tasks: list[dict[str, Any]], ctx: Context | None) -> dict[str, dict[str, Any]]:
    """Load native grading detail for each task without blocking on one bad row."""
    task_ids = [str(task.get("task_id") or "") for task in tasks]
    task_ids = list(dict.fromkeys(task_id for task_id in task_ids if task_id))
    if not task_ids:
        return {}
    responses = await asyncio.gather(
        *(
            request_agent_api("GET", f"/api/grading/inbox/tasks/{task_id}", ctx=ctx)
            for task_id in task_ids
        ),
        return_exceptions=True,
    )
    return {
        task_id: response
        for task_id, response in zip(task_ids, responses, strict=True)
        if isinstance(response, dict)
    }


@mcp.tool(description="Return grading-provider capabilities for the native Exam integration.")
async def exam_get_grading_capabilities(ctx: Context | None = None) -> dict[str, Any]:
    # Validate the current native/acting-user token even though this tool does not
    # need a REST round-trip. This keeps capability discovery user-scoped.
    await verify_request_token(ctx, scopes=READ_SCOPES)
    return {
        "provider": "exam",
        "display_name": "智评线",
        "pregraded": True,
        "supports_score_override": True,
        "supports_optional_override_reason": True,
        "supports_objective_details": True,
        "supports_printable_report": True,
    }


@mcp.tool(description="List every Exam visible to the logged-in teacher and annotate current grading availability.")
async def exam_list_grading_exams(ctx: Context | None = None) -> dict[str, Any]:
    exams = await request_agent_api("GET", "/api/exams", ctx=ctx)
    inbox = await request_agent_api("GET", "/api/grading/inbox", ctx=ctx)
    inbox_by_id = {
        str(item.get("exam_id")): item
        for item in (inbox.get("exams", []) if isinstance(inbox, dict) else [])
        if isinstance(item, dict) and item.get("exam_id")
    }
    items: list[dict[str, Any]] = []
    for exam in exams if isinstance(exams, list) else exams.get("items", []):
        if not isinstance(exam, dict):
            continue
        exam_id = str(exam.get("id") or "")
        grading_group = inbox_by_id.get(exam_id, {})
        grading_questions = grading_group.get("questions", []) if isinstance(grading_group, dict) else []
        pending_count = sum(int(question.get("pending_count") or 0) for question in grading_questions)
        completed_count = sum(int(question.get("completed_count") or 0) for question in grading_questions)
        items.append(
            {
                "exam_id": exam_id,
                "title": exam.get("title") or "未命名考试",
                "status": exam.get("status"),
                "start_time": exam.get("start_time"),
                "end_time": exam.get("end_time"),
                "total_score": exam.get("total_score"),
                "total_questions": exam.get("total_questions", 0),
                "total_students": exam.get("total_students", 0),
                "submitted_count": exam.get("submitted_count", 0),
                "has_subjective_questions": bool(exam.get("has_gradable_questions")),
                "subjective_question_count": len(grading_questions),
                "pending_confirmation_count": pending_count,
                "confirmed_count": completed_count,
                "can_review": int(exam.get("submitted_count") or 0) > 0,
            }
        )
    items.sort(key=lambda item: str(item.get("start_time") or ""), reverse=True)
    return {"provider": "exam", "pregraded": True, "items": items, "total": len(items)}


@mcp.tool(description="List all assigned candidates for an Exam, including unsubmitted and objective-only candidates.")
async def exam_list_grading_candidates(exam_id: str, ctx: Context | None = None) -> dict[str, Any]:
    analysis = await request_agent_api("GET", f"/api/exams/{exam_id}/analysis", ctx=ctx)
    matrix = await _exam_grading_matrix(exam_id, ctx)
    candidates: list[dict[str, Any]] = []
    for student in analysis.get("students", []):
        if not isinstance(student, dict):
            continue
        tasks = _candidate_task_rows(matrix, student)
        confirmed_count = sum(1 for task in tasks if _grading_status_confirmed(task.get("status")))
        candidates.append(
            {
                "student_id": str(student.get("student_id") or ""),
                "candidate_name": student.get("full_name") or student.get("username") or "未命名考生",
                "candidate_code": student.get("username") or student.get("phone"),
                "submitted_at": student.get("submitted_at"),
                "status": _candidate_review_status(student, tasks),
                "grading_status": student.get("grading_status"),
                "objective_score": student.get("objective_score"),
                "subjective_score": student.get("subjective_score"),
                "total_score": student.get("score"),
                "subjective_question_count": len(tasks),
                "confirmed_count": confirmed_count,
                "pending_count": max(0, len(tasks) - confirmed_count),
                "subjective_scores": {
                    str(task.get("question_id")): task.get("score") for task in tasks
                },
            }
        )
    status_order = {
        "pending_confirmation": 0,
        "partially_confirmed": 1,
        "completed": 2,
        "objective_only": 3,
        "unsubmitted": 4,
    }
    candidates.sort(
        key=lambda item: (
            status_order.get(str(item.get("status")), 9),
            str(item.get("candidate_name") or ""),
        )
    )
    return {
        "provider": "exam",
        "pregraded": True,
        "exam_id": exam_id,
        "exam_title": analysis.get("title") or matrix.get("exam_label") or "",
        "total_score": analysis.get("overall", {}).get("total_score"),
        "items": candidates,
        "total": len(candidates),
    }


@mcp.tool(description="Get one candidate's pregraded subjective questions and optional objective-question details.")
async def exam_get_candidate_review(
    exam_id: str,
    student_id: str,
    include_objective_details: bool = False,
    ctx: Context | None = None,
) -> dict[str, Any]:
    result = await request_agent_api(
        "GET", f"/api/exams/{exam_id}/students/{student_id}/result", ctx=ctx,
    )
    matrix = await _exam_grading_matrix(exam_id, ctx)
    student_stub = {"student_id": student_id}
    tasks = _candidate_task_rows(matrix, student_stub)
    if not tasks:
        # The grading inbox may key a task by candidate_code/name when its row
        # lacks student_id. Resolve the same fallback identity used by the
        # candidate list before treating this as an objective-only submission.
        analysis = await request_agent_api("GET", f"/api/exams/{exam_id}/analysis", ctx=ctx)
        students = analysis.get("students", []) if isinstance(analysis, dict) else []
        student = next(
            (
                item
                for item in students
                if isinstance(item, dict) and str(item.get("student_id") or "") == student_id
            ),
            None,
        )
        if student is not None:
            tasks = _candidate_task_rows(matrix, student)
    tasks_by_question = {str(task.get("question_id")): task for task in tasks}
    task_evaluations = await _grading_task_evaluations(tasks, ctx)
    subjective_questions: list[dict[str, Any]] = []
    objective_questions: list[dict[str, Any]] = []
    included_subjective_question_ids: set[str] = set()
    for question in result.get("questions", []):
        if not isinstance(question, dict):
            continue
        question_id = str(question.get("question_id") or "")
        task = tasks_by_question.get(question_id, {})
        # The grading inbox is the authority for questions that need teacher
        # confirmation. Keep its task even if the score-detail response is
        # temporarily incomplete or uses an unexpected type value.
        if question.get("type") in SUBJECTIVE_QUESTION_TYPES or task:
            evaluation = task_evaluations.get(str(task.get("task_id") or ""), {})
            subjective_questions.append(
                {
                    **question,
                    "task_id": task.get("task_id"),
                    "review_status": task.get("status"),
                    "confirmed": _grading_status_confirmed(task.get("status")),
                    "manual_override": bool(task.get("manual_override")),
                    "arbitration_required": bool(task.get("arbitration_required")),
                    "ai_models": evaluation.get("models", []),
                    "ai_feedback": evaluation.get("feedback"),
                }
            )
            included_subjective_question_ids.add(question_id)
        elif include_objective_details:
            objective_questions.append(question)

    # A submitted candidate can still have an incomplete score-detail payload
    # while the grading inbox has an actionable task. Preserve that task so the
    # native review UI never misreports the candidate as already completed.
    for task in tasks:
        question_id = str(task.get("question_id") or "")
        if not question_id or question_id in included_subjective_question_ids:
            continue
        evaluation = task_evaluations.get(str(task.get("task_id") or ""), {})
        subjective_questions.append(
            {
                "question_id": question_id,
                "order": task.get("order") or 0,
                "type": task.get("question_type") or "short_answer",
                "title": task.get("question_label") or "题目",
                "content": task.get("question_content") or "",
                "total_score": task.get("max_score") or 0,
                "score_awarded": task.get("score") or 0,
                "answer_content": {},
                "feedback": {},
                "task_id": task.get("task_id"),
                "review_status": task.get("status"),
                "confirmed": _grading_status_confirmed(task.get("status")),
                "manual_override": bool(task.get("manual_override")),
                "arbitration_required": bool(task.get("arbitration_required")),
                "ai_models": evaluation.get("models", []),
                "ai_feedback": evaluation.get("feedback"),
            }
        )
    subjective_questions.sort(key=lambda item: int(item.get("order") or 0))
    pending = [question for question in subjective_questions if not question.get("confirmed")]
    return {
        "provider": "exam",
        "pregraded": True,
        "exam_id": exam_id,
        "student_id": student_id,
        "exam_title": result.get("title"),
        "submitted_at": result.get("submitted_at"),
        "grading_status": result.get("grading_status"),
        "objective_score": result.get("objective_score"),
        "subjective_score": result.get("subjective_score"),
        "total_score": result.get("score"),
        "max_score": result.get("total_score"),
        "subjective_questions": subjective_questions,
        "objective_details_included": include_objective_details,
        "objective_questions": objective_questions,
        "next_pending_question": pending[0] if pending else None,
        "pending_count": len(pending),
        "completed": bool(subjective_questions) and not pending,
        "can_view": result.get("can_view", False),
        "blocked_reason": result.get("blocked_reason"),
    }


@mcp.tool(description="Confirm one pregraded subjective question, optionally overriding its score first.")
async def exam_confirm_grading_question(
    exam_id: str,
    student_id: str,
    question_id: str,
    task_id: str,
    score: float | None = None,
    reason: str | None = None,
    ctx: Context | None = None,
) -> dict[str, Any]:
    review = await exam_get_candidate_review(exam_id, student_id, False, ctx)
    question = next(
        (item for item in review.get("subjective_questions", []) if str(item.get("question_id")) == question_id),
        None,
    )
    if question is None or str(question.get("task_id") or "") != task_id:
        raise RuntimeError("The grading question changed or no longer belongs to this candidate. Refresh before confirming.")
    if question.get("confirmed"):
        return {"ok": True, "already_confirmed": True, "review": review}

    current_score = float(question.get("score_awarded") or 0.0)
    target_score = current_score if score is None else float(score)
    max_score = float(question.get("total_score") or 0.0)
    if not math.isfinite(target_score) or target_score < 0 or target_score > max_score:
        raise RuntimeError(f"Score must be between 0 and {max_score}.")
    score_changed = abs(target_score - current_score) > 1e-9
    if score_changed:
        await request_agent_api(
            "POST",
            f"/api/grading/tasks/{task_id}/manual-score",
            ctx=ctx,
            json={
                "score_total": target_score,
                "reason": (reason or "").strip() or "阅卷智能体人工改分",
            },
            scopes=WRITE_SCOPES,
        )
    await request_agent_api(
        "POST", f"/api/grading/tasks/{task_id}/confirm", ctx=ctx, scopes=WRITE_SCOPES,
    )
    refreshed = await exam_get_candidate_review(exam_id, student_id, False, ctx)
    return {
        "ok": True,
        "already_confirmed": False,
        "score_changed": score_changed,
        "confirmed_question_id": question_id,
        "confirmed_score": target_score,
        "review": refreshed,
    }


def _score_shape(scores: list[float]) -> dict[str, Any]:
    sample_size = len(scores)
    if sample_size < 8:
        return {
            "sample_size": sample_size,
            "assessment": "insufficient_sample",
            "approximately_normal": None,
            "message": "有效成绩少于 8 份，只展示分布图，不作正态分布判断。",
        }
    mean = sum(scores) / sample_size
    variance = sum((score - mean) ** 2 for score in scores) / sample_size
    standard_deviation = math.sqrt(variance)
    if standard_deviation == 0:
        return {
            "sample_size": sample_size,
            "assessment": "not_normal",
            "approximately_normal": False,
            "mean": mean,
            "standard_deviation": 0.0,
            "skewness": 0.0,
            "excess_kurtosis": -3.0,
            "message": "所有有效成绩相同，不呈现正态分布形态。",
        }
    skewness = sum(((score - mean) / standard_deviation) ** 3 for score in scores) / sample_size
    excess_kurtosis = (
        sum(((score - mean) / standard_deviation) ** 4 for score in scores) / sample_size - 3
    )
    approximately_normal = abs(skewness) <= 0.75 and abs(excess_kurtosis) <= 1.5
    return {
        "sample_size": sample_size,
        "assessment": "approximately_normal" if approximately_normal else "not_normal",
        "approximately_normal": approximately_normal,
        "mean": round(mean, 2),
        "standard_deviation": round(standard_deviation, 2),
        "skewness": round(skewness, 3),
        "excess_kurtosis": round(excess_kurtosis, 3),
        "message": (
            "按偏度和峰度的描述性规则，当前成绩形态近似正态分布。"
            if approximately_normal
            else "按偏度和峰度的描述性规则，当前成绩形态不接近正态分布。"
        ),
        "method_note": "这是描述性判断，不替代正式统计检验。",
    }


@mcp.tool(description="Build current printable grading-report data with ranks, per-question subjective scores, and distribution analysis.")
async def exam_get_grading_report(exam_id: str, ctx: Context | None = None) -> dict[str, Any]:
    analysis = await request_agent_api("GET", f"/api/exams/{exam_id}/analysis", ctx=ctx)
    matrix = await _exam_grading_matrix(exam_id, ctx)
    students: list[dict[str, Any]] = []
    for student in analysis.get("students", []):
        if not isinstance(student, dict):
            continue
        tasks = _candidate_task_rows(matrix, student)
        confirmed_count = sum(1 for task in tasks if _grading_status_confirmed(task.get("status")))
        students.append(
            {
                "student_id": str(student.get("student_id") or ""),
                "candidate_name": student.get("full_name") or student.get("username") or "未命名考生",
                "candidate_code": student.get("username") or student.get("phone"),
                "submitted_at": student.get("submitted_at"),
                "status": _candidate_review_status(student, tasks),
                "objective_score": student.get("objective_score"),
                "subjective_score": student.get("subjective_score"),
                "total_score": student.get("score"),
                "subjective_scores": {
                    str(task.get("question_id")): task.get("score") for task in tasks
                },
                "confirmed_count": confirmed_count,
                "subjective_question_count": len(tasks),
            }
        )
    ranked = sorted(
        [student for student in students if student.get("submitted_at") and student.get("total_score") is not None],
        key=lambda item: (-float(item["total_score"]), str(item.get("candidate_name") or "")),
    )
    for index, student in enumerate(ranked, start=1):
        student["rank"] = index
    ranked_ids = {student["student_id"] for student in ranked}
    unranked = [student for student in students if student["student_id"] not in ranked_ids]
    for student in unranked:
        student["rank"] = None
    scores = [float(student["total_score"]) for student in ranked]
    overall = analysis.get("overall", {})
    return {
        "provider": "exam",
        "pregraded": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "exam_id": exam_id,
        "exam_title": analysis.get("title") or matrix.get("exam_label") or "",
        "summary": {
            **overall,
            "unsubmitted_count": sum(1 for student in students if not student.get("submitted_at")),
            "pending_confirmation_count": sum(
                max(0, student["subjective_question_count"] - student["confirmed_count"])
                for student in students
            ),
        },
        "subjective_questions": matrix.get("questions", []),
        "students": ranked + sorted(unranked, key=lambda item: str(item.get("candidate_name") or "")),
        "score_distribution": analysis.get("score_distribution", []),
        "normality": _score_shape(scores),
        "report_scope_note": "未提交考生保留在名单中，但不参与排名、平均分、及格率和分布判断。",
    }


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

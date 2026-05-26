"""Middleware that attaches per-request context for activity-log helpers.

Keeps header parsing in one place so log_event() doesn't have to know about
X-Forwarded-For or other proxy quirks.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

REQUEST_ID_HEADER = "X-Request-Id"


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # First entry in the chain is the originating client.
        return forwarded.split(",")[0].strip() or None
    if request.client and request.client.host:
        return request.client.host
    return None


class ActivityContextMiddleware(BaseHTTPMiddleware):
    """Populate request.state with a request_id, client IP, and user-agent."""

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        existing_id = request.headers.get(REQUEST_ID_HEADER)
        request_id = existing_id or uuid.uuid4().hex
        request.state.request_id = request_id
        request.state.client_ip = _client_ip(request)
        ua = request.headers.get("user-agent")
        request.state.user_agent = ua[:400] if ua else None
        response = await call_next(request)
        response.headers.setdefault(REQUEST_ID_HEADER, request_id)
        return response

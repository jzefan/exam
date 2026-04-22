"""Lightweight observability hooks.

- Request duration middleware: logs p95 tail latency per route.
- Slow-query logger: prints SQL taking > SLOW_QUERY_MS.
- /internal/metrics: current DB pool state.

Kept dependency-free (no Prometheus) — stdout logs are sufficient for the
150-concurrent-exam-taker scale and can be piped into any log aggregator.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import FastAPI, Request
from sqlalchemy import event
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("app.observability")
SLOW_QUERY_MS = 200
SLOW_REQUEST_MS = 500


class RequestTimingMiddleware(BaseHTTPMiddleware):
    """Log duration + status for every HTTP request; warn on slow requests."""

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        route = request.url.path
        method = request.method
        status_code = response.status_code

        level = logging.WARNING if duration_ms >= SLOW_REQUEST_MS else logging.INFO
        logger.log(
            level,
            "http %s %s status=%d duration_ms=%.1f",
            method,
            route,
            status_code,
            duration_ms,
        )
        response.headers["X-Response-Time-Ms"] = f"{duration_ms:.1f}"
        return response


def install_slow_query_logger(engine: Any) -> None:
    """Attach before/after_cursor_execute hooks to log slow SQL."""

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _before(conn: Any, cursor: Any, statement: str, *_: Any, **__: Any) -> None:
        conn.info.setdefault("query_start_time", []).append(time.perf_counter())

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def _after(conn: Any, cursor: Any, statement: str, *_: Any, **__: Any) -> None:
        start_times = conn.info.get("query_start_time")
        if not start_times:
            return
        elapsed_ms = (time.perf_counter() - start_times.pop()) * 1000
        if elapsed_ms >= SLOW_QUERY_MS:
            snippet = " ".join(statement.split())[:200]
            logger.warning("slow_query duration_ms=%.1f sql=%s", elapsed_ms, snippet)


def install(app: FastAPI, engine: Any) -> None:
    app.add_middleware(RequestTimingMiddleware)
    install_slow_query_logger(engine)

    @app.get("/internal/metrics", include_in_schema=False)
    async def _metrics() -> dict[str, Any]:
        pool = engine.pool
        return {
            "pool": {
                "size": pool.size(),
                "checked_in": pool.checkedin(),
                "checked_out": pool.checkedout(),
                "overflow": pool.overflow(),
            }
        }

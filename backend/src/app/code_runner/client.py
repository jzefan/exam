from __future__ import annotations

from typing import Any

import httpx

from app.code_runner.schemas import CodeRunRequest, CodeRunResult


async def run_code_via_judge_runner(
    base_url: str,
    request: CodeRunRequest,
    sample_tests: list[dict[str, Any]],
) -> CodeRunResult:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{base_url.rstrip('/')}/run",
            json={
                "request": request.model_dump(mode="json"),
                "sample_tests": sample_tests,
            },
        )
        response.raise_for_status()
        return CodeRunResult.model_validate(response.json())

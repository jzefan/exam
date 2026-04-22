import pytest
from httpx import ASGITransport, AsyncClient

from app.judge_runner.main import app


@pytest.mark.asyncio
async def test_judge_runner_health() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_judge_runner_run_returns_code_result() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/run",
            json={
                "request": {
                    "language": "python",
                    "code": "print(1 + 2)",
                    "mode": "sample",
                    "custom_input": "",
                    "sample_case_index": None,
                },
                "sample_tests": [{"name": "示例 1", "input": "", "expected_output": "3", "is_public": True}],
            },
        )

    assert response.status_code == 200
    assert response.json()["status"] == "passed"

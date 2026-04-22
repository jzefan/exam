import pytest
from httpx import ConnectError

from app.code_runner.client import run_code_via_judge_runner
from app.code_runner.schemas import CodeRunMode, CodeRunRequest


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, response: _FakeResponse | Exception):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, json: dict):
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


@pytest.mark.asyncio
async def test_run_code_via_judge_runner_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.code_runner.client.httpx.AsyncClient",
        lambda timeout=30.0: _FakeAsyncClient(
            _FakeResponse(
                {
                    "status": "passed",
                    "mode": "sample",
                    "language": "python",
                    "stdout": "3\n",
                    "stderr": "",
                    "compile_output": "",
                    "time_ms": 10,
                    "memory_kb": 0,
                    "case_count": 1,
                    "passed_count": 1,
                    "cases": [],
                }
            )
        ),
    )

    result = await run_code_via_judge_runner(
        "http://judge_runner:8010",
        CodeRunRequest(language="python", code="print(3)", mode=CodeRunMode.SAMPLE),
        [{"name": "示例 1", "input": "", "expected_output": "3", "is_public": True}],
    )

    assert result.status.value == "passed"
    assert result.case_count == 1


@pytest.mark.asyncio
async def test_run_code_via_judge_runner_raises_on_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.code_runner.client.httpx.AsyncClient",
        lambda timeout=30.0: _FakeAsyncClient(ConnectError("boom")),
    )

    with pytest.raises(ConnectError):
        await run_code_via_judge_runner(
            "http://judge_runner:8010",
            CodeRunRequest(language="python", code="print(3)", mode=CodeRunMode.SAMPLE),
            [],
        )

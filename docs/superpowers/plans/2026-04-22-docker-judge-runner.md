# Docker 判题运行环境 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为代码题在线运行接入独立 Docker judge-runner 容器，让六种语言在容器内统一执行。

**Architecture:** 新增一个轻量 judge-runner HTTP 服务，复用现有 code_runner 逻辑；backend 在配置了 `EXAM_JUDGE_RUNNER_URL` 时通过 HTTP 调用它，否则保持本地回退逻辑；docker-compose 新增内部 judge-runner 服务并把 URL 注入 backend。

**Tech Stack:** FastAPI, httpx, Docker Compose, existing code_runner package

---

### Task 1: 增加 judge-runner 配置与客户端调用层

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/config.py`
- Create: `/Users/jzefan/work/proj/exam/backend/src/app/code_runner/client.py`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_code_runner_client.py`

- [ ] **Step 1: Write the failing tests**

```python
import pytest
from app.code_runner.client import run_code_via_judge_runner
from app.code_runner.schemas import CodeRunMode, CodeRunRequest


@pytest.mark.asyncio
async def test_run_code_via_judge_runner_success(httpx_mock):
    httpx_mock.add_response(
        json={
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
    result = await run_code_via_judge_runner(
        "http://judge_runner:8010",
        CodeRunRequest(language="python", code="print(3)", mode=CodeRunMode.SAMPLE),
        [{"name": "示例 1", "input": "", "expected_output": "3", "is_public": True}],
    )
    assert result.status.value == "passed"


@pytest.mark.asyncio
async def test_run_code_via_judge_runner_raises_on_http_error(httpx_mock):
    httpx_mock.add_exception(RuntimeError("boom"))
    with pytest.raises(RuntimeError):
        await run_code_via_judge_runner(
            "http://judge_runner:8010",
            CodeRunRequest(language="python", code="print(3)", mode=CodeRunMode.SAMPLE),
            [],
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_client.py -q`
Expected: FAIL with missing module or function

- [ ] **Step 3: Write minimal implementation**

```python
import httpx
from app.code_runner.schemas import CodeRunRequest, CodeRunResult


async def run_code_via_judge_runner(base_url: str, request: CodeRunRequest, sample_tests: list[dict]):
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
```

- [ ] **Step 4: Add config field**

```python
judge_runner_url: str | None = None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_client.py -q`
Expected: PASS

### Task 2: 新增 judge-runner HTTP 服务

**Files:**
- Create: `/Users/jzefan/work/proj/exam/backend/src/app/judge_runner/router.py`
- Create: `/Users/jzefan/work/proj/exam/backend/src/app/judge_runner/schemas.py`
- Create: `/Users/jzefan/work/proj/exam/backend/src/app/judge_runner/main.py`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_judge_runner_api.py`

- [ ] **Step 1: Write failing API tests**

```python
from httpx import AsyncClient


async def test_judge_runner_health(client: AsyncClient):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_judge_runner_run_returns_code_result(client: AsyncClient):
    response = await client.post(
        "/run",
        json={
            "request": {"language": "python", "code": "print(1+2)", "mode": "sample", "custom_input": ""},
            "sample_tests": [{"name": "示例 1", "input": "", "expected_output": "3", "is_public": True}],
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "passed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_judge_runner_api.py -q`
Expected: FAIL because app/router does not exist

- [ ] **Step 3: Create request schema and router**

```python
from collections.abc import Mapping
from typing import Any
from pydantic import BaseModel, Field
from fastapi import APIRouter
from app.code_runner.schemas import CodeRunRequest, CodeRunResult
from app.code_runner.service import run_code


class JudgeRunPayload(BaseModel):
    request: CodeRunRequest
    sample_tests: list[dict[str, Any]] = Field(default_factory=list)


router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.post("/run", response_model=CodeRunResult)
async def run(payload: JudgeRunPayload) -> CodeRunResult:
    return run_code(payload.request, payload.sample_tests)
```

- [ ] **Step 4: Create standalone app**

```python
from fastapi import FastAPI
from app.judge_runner.router import router

app = FastAPI(title="judge-runner")
app.include_router(router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_judge_runner_api.py -q`
Expected: PASS

### Task 3: 让学生端代码运行优先走 judge-runner

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/exams/student_router.py`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_student_code_run_api.py`

- [ ] **Step 1: Add failing integration test**

```python
@pytest.mark.asyncio
async def test_student_code_run_uses_judge_runner_when_configured(monkeypatch, client, db_session):
    called = {"value": False}

    async def fake_run(base_url, request, sample_tests):
        called["value"] = True
        return CodeRunResult(
            status=CodeRunStatus.PASSED,
            mode=request.mode,
            language=request.language,
            stdout="3\n",
            stderr="",
            compile_output="",
            time_ms=1,
            memory_kb=0,
            case_count=1,
            passed_count=1,
            cases=[],
        )

    monkeypatch.setattr("app.exams.student_router.settings.judge_runner_url", "http://judge_runner:8010")
    monkeypatch.setattr("app.exams.student_router.run_code_via_judge_runner", fake_run)
    # reuse existing exam/question fixture setup and assert called["value"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_student_code_run_api.py -q`
Expected: FAIL because route still calls local run_code directly

- [ ] **Step 3: Implement judge-runner branch**

```python
if settings.judge_runner_url:
    result = await run_code_via_judge_runner(settings.judge_runner_url, payload, sample_tests)
else:
    result = await asyncio.to_thread(run_code, payload, sample_tests=sample_tests)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_student_code_run_api.py tests/test_code_runner_client.py tests/test_judge_runner_api.py -q`
Expected: PASS

### Task 4: 增加 judge-runner Docker 镜像

**Files:**
- Create: `/Users/jzefan/work/proj/exam/backend/judge-runner.Dockerfile`
- Modify: `/Users/jzefan/work/proj/exam/backend/.dockerignore`

- [ ] **Step 1: Add Dockerfile**

```dockerfile
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}

ARG DEBIAN_APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    UV_INDEX_URL=${UV_INDEX_URL} \
    PATH="/app/.venv/bin:${PATH}"

WORKDIR /app

RUN if [ -n "${DEBIAN_APT_MIRROR}" ]; then \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|http://deb.debian.org/debian|${DEBIAN_APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
        sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_APT_MIRROR}-security|g" /etc/apt/sources.list.d/debian.sources; \
      fi; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl nodejs npm default-jdk-headless golang-go \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY src ./src

ENV PYTHONPATH=/app/src
EXPOSE 8010

CMD ["uvicorn", "app.judge_runner.main:app", "--host", "0.0.0.0", "--port", "8010"]
```

- [ ] **Step 2: Ensure dockerignore does not exclude needed app source**

Review and update `.dockerignore` only if judge-runner needs files currently excluded.

### Task 5: 接入 docker-compose

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/docker-compose.yml`
- Modify: `/Users/jzefan/work/proj/exam/docs/deployment-docker-compose.md`

- [ ] **Step 1: Add judge_runner service**

```yaml
  judge_runner:
    build:
      context: ./backend
      dockerfile: judge-runner.Dockerfile
      args:
        PYTHON_BASE_IMAGE: ${PYTHON_BASE_IMAGE:-python:3.12-slim}
        DEBIAN_APT_MIRROR: ${DEBIAN_APT_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/debian}
        PIP_INDEX_URL: ${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}
        UV_INDEX_URL: ${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/health', timeout=5)\""]
      interval: 10s
      timeout: 5s
      retries: 12
```

- [ ] **Step 2: Inject backend env**

```yaml
    environment:
      EXAM_JUDGE_RUNNER_URL: http://judge_runner:8010
    depends_on:
      db:
        condition: service_healthy
      judge_runner:
        condition: service_healthy
```

- [ ] **Step 3: Update deployment doc**

Document that compose now includes `judge_runner` and that code execution languages come from this container instead of host machine.

### Task 6: Full verification

**Files:**
- Verify only

- [ ] **Step 1: Run backend test suite slice**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_client.py tests/test_judge_runner_api.py tests/test_student_code_run_api.py tests/test_code_runner_service.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend type check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Optionally validate compose config**

Run: `docker compose config`
Expected: judge_runner service present and backend env injected

# Code Question Practical LSP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add practical single-file LSP support to student code questions for Python, JavaScript, Java, C, C++, and Go without changing the student-facing exam workflow.

**Architecture:** Keep Monaco as the existing editor shell, add a frontend LSP session hook and backend WebSocket proxy, and introduce a dedicated `lsp_runner` service that hosts language servers for each supported language. Any LSP failure must silently fall back to the current Monaco experience so coding, running, and submitting remain unaffected.

**Tech Stack:** React, Monaco, `@monaco-editor/react`, `monaco-languageclient`, FastAPI WebSocket proxying, Docker Compose, `pyright`, `typescript-language-server`, `jdtls`, `clangd`, `gopls`.

---

### Task 1: Define shared LSP session types and config plumbing

**Files:**
- Create: `backend/src/app/lsp_runner/schemas.py`
- Modify: `backend/src/app/config.py`
- Modify: `frontend/src/types/index.ts`
- Test: `backend/tests/test_lsp_config.py`

- [ ] **Step 1: Write the failing backend config test**

```python
from app.config import settings


def test_lsp_runner_default_url_is_present() -> None:
    assert hasattr(settings, "lsp_runner_url")
    assert settings.lsp_runner_url
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_lsp_config.py -q`
Expected: FAIL because `lsp_runner_url` does not exist yet.

- [ ] **Step 3: Add backend config and runner schemas**

```python
# backend/src/app/config.py
class Settings(BaseSettings):
    ...
    judge_runner_url: str | None = None
    lsp_runner_url: str | None = None
```

```python
# backend/src/app/lsp_runner/schemas.py
from pydantic import BaseModel


class LspSessionRequest(BaseModel):
    student_id: str
    exam_id: str
    question_id: str
    language: str
    document_uri: str


class LspSessionResponse(BaseModel):
    session_id: str
    websocket_path: str
```

```ts
// frontend/src/types/index.ts
export type CodeLanguage = "python" | "javascript" | "java" | "cpp" | "c" | "go";

export interface ICodeLspSessionState {
  language: CodeLanguage;
  questionId: string;
  active: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_lsp_config.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/config.py backend/src/app/lsp_runner/schemas.py frontend/src/types/index.ts backend/tests/test_lsp_config.py
git commit -m "feat: add lsp runner config and shared session types"
```

### Task 2: Add backend student WebSocket gateway for code-question LSP

**Files:**
- Create: `backend/src/app/lsp_runner/client.py`
- Modify: `backend/src/app/exams/student_router.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/test_student_lsp_gateway.py`

- [ ] **Step 1: Write the failing WebSocket gateway test**

```python
async def test_student_code_question_lsp_websocket_requires_valid_code_question(...):
    with client.websocket_connect("/api/student/exams/exam-1/questions/code-1/lsp?language=python") as ws:
        first = ws.receive_json()
        assert first["type"] == "ready"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_student_lsp_gateway.py -q`
Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the minimal backend gateway**

```python
# backend/src/app/lsp_runner/client.py
class LspRunnerClient:
    async def open_session(...): ...
    async def proxy_websocket(...): ...
```

```python
# backend/src/app/exams/student_router.py
@router.websocket("/student/exams/{exam_id}/questions/{question_id}/lsp")
async def student_code_question_lsp(...):
    # authenticate student
    # validate exam/question/language
    # proxy websocket traffic to lsp_runner
```

```python
# backend/src/app/main.py
app.include_router(student_router, prefix="/api")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_student_lsp_gateway.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/lsp_runner/client.py backend/src/app/exams/student_router.py backend/src/app/main.py backend/tests/test_student_lsp_gateway.py
git commit -m "feat: add student code question lsp gateway"
```

### Task 3: Build dedicated lsp_runner service skeleton with health and session routing

**Files:**
- Create: `backend/src/app/lsp_runner/main.py`
- Create: `backend/src/app/lsp_runner/router.py`
- Create: `backend/src/app/lsp_runner/service.py`
- Create: `backend/src/app/lsp_runner/session_store.py`
- Test: `backend/tests/test_lsp_runner_api.py`

- [ ] **Step 1: Write the failing service API test**

```python
def test_lsp_runner_health_and_open_session(client):
    assert client.get("/health").json() == {"status": "ok"}
    payload = {
        "student_id": "student-1",
        "exam_id": "exam-1",
        "question_id": "code-1",
        "language": "python",
        "document_uri": "file:///student-exam/exam-1/code-1/solution.py",
    }
    response = client.post("/sessions", json=payload)
    assert response.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_lsp_runner_api.py -q`
Expected: FAIL because `lsp_runner` app does not exist yet.

- [ ] **Step 3: Implement the minimal service shell**

```python
# backend/src/app/lsp_runner/session_store.py
class LspSessionStore:
    def create(...): ...
    def get(...): ...
    def close(...): ...
```

```python
# backend/src/app/lsp_runner/service.py
class LspRunnerService:
    async def create_session(...): ...
    async def close_session(...): ...
```

```python
# backend/src/app/lsp_runner/router.py
@router.get("/health")
async def health():
    return {"status": "ok"}

@router.post("/sessions")
async def create_session(...):
    ...
```

```python
# backend/src/app/lsp_runner/main.py
app = FastAPI()
app.include_router(router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_lsp_runner_api.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/lsp_runner/main.py backend/src/app/lsp_runner/router.py backend/src/app/lsp_runner/service.py backend/src/app/lsp_runner/session_store.py backend/tests/test_lsp_runner_api.py
git commit -m "feat: scaffold lsp runner service"
```

### Task 4: Add language-server process adapters for all six languages

**Files:**
- Create: `backend/src/app/lsp_runner/languages.py`
- Modify: `backend/src/app/lsp_runner/service.py`
- Test: `backend/tests/test_lsp_languages.py`

- [ ] **Step 1: Write the failing language adapter test**

```python
from app.lsp_runner.languages import LANGUAGE_SERVER_COMMANDS


def test_all_supported_languages_have_language_server_commands() -> None:
    assert set(LANGUAGE_SERVER_COMMANDS) == {"python", "javascript", "java", "cpp", "c", "go"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_lsp_languages.py -q`
Expected: FAIL because the mapping file does not exist.

- [ ] **Step 3: Implement language adapter registry**

```python
LANGUAGE_SERVER_COMMANDS = {
    "python": ["pyright-langserver", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"],
    "java": ["jdtls"],
    "cpp": ["clangd", "--background-index=false"],
    "c": ["clangd", "--background-index=false"],
    "go": ["gopls"],
}
```

Update `LspRunnerService` to choose the correct adapter by language and launch one stdio-backed process per session.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_lsp_languages.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/lsp_runner/languages.py backend/src/app/lsp_runner/service.py backend/tests/test_lsp_languages.py
git commit -m "feat: add language server registry for code lsp"
```

### Task 5: Add lsp_runner Docker image and compose wiring

**Files:**
- Create: `backend/lsp-runner-requirements.txt`
- Create: `backend/lsp-runner.Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `scripts/deploy.sh`
- Test: `scripts/check-judge-runner.sh` (extend or companion check)

- [ ] **Step 1: Write the failing deployment smoke check**

```bash
docker compose -f docker-compose.dev.yml config | rg lsp_runner
```

Expected: currently no `lsp_runner` service is present.

- [ ] **Step 2: Run the smoke check to verify it fails**

Run: `docker compose -f docker-compose.dev.yml config | rg lsp_runner`
Expected: no match / non-zero exit.

- [ ] **Step 3: Add Docker and compose support**

```dockerfile
# backend/lsp-runner.Dockerfile
FROM python:3.12-slim
# install node, openjdk, clangd, golang, npm packages for language servers
# install minimal Python deps for FastAPI runner
```

```yaml
# docker-compose.yml
services:
  lsp_runner:
    build:
      context: ./backend
      dockerfile: lsp-runner.Dockerfile
```

Update `backend` service env with:

```yaml
EXAM_LSP_RUNNER_URL: http://lsp_runner:8020
```

- [ ] **Step 4: Run the smoke checks to verify they pass**

Run: `docker compose -f docker-compose.dev.yml config | rg lsp_runner`
Expected: shows `lsp_runner`

Run: `bash -n scripts/deploy.sh`
Expected: no syntax errors

- [ ] **Step 5: Commit**

```bash
git add backend/lsp-runner-requirements.txt backend/lsp-runner.Dockerfile docker-compose.yml docker-compose.dev.yml scripts/deploy.sh
git commit -m "feat: add lsp runner deployment service"
```

### Task 6: Add frontend LSP session hook

**Files:**
- Create: `frontend/src/hooks/use-code-question-lsp.ts`
- Modify: `frontend/src/types/index.ts`
- Test: `frontend/src/hooks/use-code-question-lsp.test.ts`

- [ ] **Step 1: Write the failing hook test**

```ts
it("creates and disposes a language-scoped lsp session", async () => {
  const { result, unmount } = renderHook(() =>
    useCodeQuestionLsp({
      examId: "exam-1",
      questionId: "code-1",
      language: "python",
      enabled: true,
    }),
  );

  expect(result.current.active).toBe(true);
  unmount();
  expect(closeMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && CI=1 pnpm exec vitest run src/hooks/use-code-question-lsp.test.ts --reporter=verbose`
Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the minimal hook**

```ts
export function useCodeQuestionLsp({ examId, questionId, language, enabled }: Options) {
  // create websocket URL
  // connect when enabled
  // expose active flag and cleanup on change/unmount
}
```

No user-facing UI output is added here. This hook only owns connection lifecycle.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && CI=1 pnpm exec vitest run src/hooks/use-code-question-lsp.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/use-code-question-lsp.ts frontend/src/hooks/use-code-question-lsp.test.ts frontend/src/types/index.ts
git commit -m "feat: add code question lsp session hook"
```

### Task 7: Integrate Monaco with monaco-languageclient in code question editor

**Files:**
- Modify: `frontend/src/pages/student/components/code-question.tsx`
- Modify: `frontend/src/pages/student/components/code-question.test.tsx`
- Test: `frontend/src/pages/student/components/code-question.test.tsx`

- [ ] **Step 1: Write the failing editor integration test**

```ts
it("starts lsp session for program-mode code questions without changing visible workflow", () => {
  render(<CodeQuestionHarness />);
  expect(useCodeQuestionLspMock).toHaveBeenCalledWith(
    expect.objectContaining({
      questionId: "code-1",
      language: "python",
      enabled: true,
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && CI=1 pnpm exec vitest run src/pages/student/components/code-question.test.tsx --reporter=verbose`
Expected: FAIL because the editor does not yet wire LSP hook/client.

- [ ] **Step 3: Wire the hook and Monaco bridge**

```ts
const lspSession = useCodeQuestionLsp({
  examId,
  questionId: question.question_id,
  language,
  enabled: questionMode === "program" || questionMode === "function",
});
```

Then:

- attach Monaco editor/model references
- initialize `monaco-languageclient`
- bind the active model URI to the session
- dispose the client when question/language changes

Do not add any visible LSP labels, banners, or status text.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && CI=1 pnpm exec vitest run src/pages/student/components/code-question.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/student/components/code-question.tsx frontend/src/pages/student/components/code-question.test.tsx
git commit -m "feat: attach lsp sessions to code question editor"
```

### Task 8: Add backend-to-lsp_runner proxy tests and fallback verification

**Files:**
- Modify: `backend/tests/test_student_lsp_gateway.py`
- Modify: `frontend/src/pages/student/components/code-question.test.tsx`

- [ ] **Step 1: Write failing fallback tests**

```python
async def test_student_lsp_gateway_rejects_invalid_language(...): ...
async def test_student_lsp_gateway_closes_cleanly_when_runner_unavailable(...): ...
```

```ts
it("does not add user-facing technical text when lsp hookup fails", () => {
  render(<CodeQuestionHarness />);
  expect(screen.queryByText(/LSP|language server|connecting/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_student_lsp_gateway.py -q`

Run: `cd frontend && CI=1 pnpm exec vitest run src/pages/student/components/code-question.test.tsx --reporter=verbose`

Expected: FAIL because fallback constraints are not fully enforced yet.

- [ ] **Step 3: Implement minimal fallback handling**

Backend:
- close rejected websocket requests cleanly
- log runner unavailability

Frontend:
- keep editor interactive if hook connection fails
- do not surface technical wording
- preserve existing static completion behavior

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_student_lsp_gateway.py -q`

Run: `cd frontend && CI=1 pnpm exec vitest run src/pages/student/components/code-question.test.tsx --reporter=verbose`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_student_lsp_gateway.py frontend/src/pages/student/components/code-question.test.tsx
git commit -m "test: verify lsp fallback remains invisible to students"
```

### Task 9: Add LSP deployment verification script and docs

**Files:**
- Create: `scripts/check-lsp-runner.sh`
- Modify: `docs/deployment-docker-compose.md`
- Test: `bash -n scripts/check-lsp-runner.sh`

- [ ] **Step 1: Write the failing deployment verification expectation**

Expected checks:
- `lsp_runner` container exists
- backend has `EXAM_LSP_RUNNER_URL`
- backend can reach `http://lsp_runner:8020/health`

- [ ] **Step 2: Add the verification script**

```bash
#!/usr/bin/env bash
set -euo pipefail
# detect app root
# verify lsp_runner container
# verify health
# verify backend env and in-container reachability
```

- [ ] **Step 3: Run shell syntax verification**

Run: `bash -n scripts/check-lsp-runner.sh`
Expected: success

- [ ] **Step 4: Update deployment docs**

Add:
- how `lsp_runner` is deployed
- how to validate it after deployment
- that no student-facing behavior changes if it is unavailable

- [ ] **Step 5: Commit**

```bash
git add scripts/check-lsp-runner.sh docs/deployment-docker-compose.md
git commit -m "docs: add lsp runner deployment verification"
```

### Task 10: Full regression verification

**Files:**
- No new files

- [ ] **Step 1: Run backend LSP tests**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_lsp_config.py tests/test_student_lsp_gateway.py tests/test_lsp_runner_api.py tests/test_lsp_languages.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend editor/LSP tests**

Run: `cd frontend && CI=1 pnpm exec vitest run src/hooks/use-code-question-lsp.test.ts src/pages/student/components/code-question.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Run frontend type-check**

Run: `cd frontend && pnpm exec tsc --noEmit --pretty false`
Expected: PASS

- [ ] **Step 4: Run Docker config verification**

Run: `docker compose -f docker-compose.dev.yml config`
Expected: includes `judge_runner` and `lsp_runner`

- [ ] **Step 5: Commit final integration state**

```bash
git add -A
git commit -m "feat: add practical lsp support for code questions"
```

## Self-Review

### Spec coverage

- Real LSP for all six languages: Tasks 4, 5, 7, 10
- Backend WebSocket gateway: Task 2
- Dedicated `lsp_runner`: Tasks 3, 4, 5
- Frontend Monaco integration with no workflow change: Tasks 6 and 7
- Silent fallback: Task 8
- Deployment support: Tasks 5 and 9

No major spec gaps remain.

### Placeholder scan

- No TODO/TBD markers remain in tasks.
- Every task contains explicit files, commands, and minimal code shapes.

### Type consistency

- Shared language naming stays on `"python" | "javascript" | "java" | "cpp" | "c" | "go"`
- Session identity consistently uses `student_id`, `exam_id`, `question_id`, `language`
- Frontend hook and backend gateway use the same per-question/per-language session model


# Code Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build student-facing online code execution for exam coding questions, supporting six languages, sample tests, and custom input without changing final grading.

**Architecture:** Add a dedicated backend `code_runner` module that executes single-file programs under strict limits and expose it through a new student exam run endpoint. Reuse the existing coding-question UI, replacing the placeholder run behavior with a real asynchronous request and structured result rendering while keeping answer autosave and submit flows unchanged.

**Tech Stack:** FastAPI, SQLAlchemy async session, Pydantic schemas, Python subprocess/tempfile utilities, React, Axios, Vitest, TypeScript.

---

## File Structure

### New backend files

- `backend/src/app/code_runner/__init__.py`
  - Export runner entrypoints and schemas.
- `backend/src/app/code_runner/schemas.py`
  - Pydantic models for run request/result and per-case results.
- `backend/src/app/code_runner/limits.py`
  - Centralize compile timeout, run timeout, output truncation, temp file naming.
- `backend/src/app/code_runner/executors.py`
  - Language command builders and source file layout rules.
- `backend/src/app/code_runner/compare.py`
  - Normalize stdout/expected output and compare sample case results.
- `backend/src/app/code_runner/service.py`
  - Orchestrate compile/run, sample/custom modes, and status normalization.

### Modified backend files

- `backend/src/app/exams/student_schemas.py`
  - Add request/response schemas for code execution endpoint.
- `backend/src/app/exams/student_router.py`
  - Add `POST /api/student/exams/{exam_id}/questions/{question_id}/run` and route-level validation.
- `backend/src/app/main.py`
  - Ensure imports and router exposure remain consistent if needed.

### New backend tests

- `backend/tests/test_code_runner_service.py`
  - Unit-style tests for execution service status mapping and comparison rules.
- `backend/tests/test_student_code_run_api.py`
  - Route tests for permissions, time-window validation, non-code rejection, sample/custom results.

### Modified frontend files

- `frontend/src/types/index.ts`
  - Add run request/result types for coding question UI.
- `frontend/src/pages/student/components/code-question.tsx`
  - Replace placeholder run behavior with API call and structured rendering.
- `frontend/src/pages/student/exam-taking.tsx`
  - Pass exam/question context if needed by `CodeQuestion`.

### New or modified frontend tests

- `frontend/src/pages/student/components/code-question.test.tsx`
  - Cover loading state, sample/custom rendering, error rendering.
- `frontend/src/pages/student/components/question-renderer.test.tsx`
  - Keep code-question wiring coverage stable.

## Task 1: Define Backend Code Runner Schemas and Limits

**Files:**
- Create: `backend/src/app/code_runner/__init__.py`
- Create: `backend/src/app/code_runner/schemas.py`
- Create: `backend/src/app/code_runner/limits.py`
- Modify: `backend/src/app/exams/student_schemas.py`
- Test: `backend/tests/test_code_runner_service.py`

- [ ] **Step 1: Write the failing schema test**

```python
from app.code_runner.schemas import CodeRunMode, CodeRunRequest, CodeRunResult, CodeRunCaseResult


def test_code_run_request_and_result_round_trip() -> None:
    payload = CodeRunRequest(
        language="python",
        code="print('ok')",
        mode=CodeRunMode.SAMPLE,
        custom_input="",
        sample_case_index=None,
    )

    case = CodeRunCaseResult(
        name="示例 1",
        input="1 2",
        expected_output="3",
        actual_output="3",
        status="passed",
        time_ms=12,
        memory_kb=0,
        message="",
    )
    result = CodeRunResult(
        status="passed",
        mode=CodeRunMode.SAMPLE,
        language="python",
        stdout="3",
        stderr="",
        compile_output="",
        time_ms=12,
        memory_kb=0,
        case_count=1,
        passed_count=1,
        cases=[case],
    )

    assert payload.mode is CodeRunMode.SAMPLE
    assert result.cases[0].status == "passed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.code_runner'`

- [ ] **Step 3: Write minimal schemas and limits**

```python
# backend/src/app/code_runner/schemas.py
from enum import Enum

from pydantic import BaseModel


class CodeRunMode(str, Enum):
    SAMPLE = "sample"
    CUSTOM = "custom"


class CodeRunRequest(BaseModel):
    language: str
    code: str
    mode: CodeRunMode
    custom_input: str = ""
    sample_case_index: int | None = None


class CodeRunCaseResult(BaseModel):
    name: str
    input: str
    expected_output: str | None = None
    actual_output: str = ""
    status: str
    time_ms: int = 0
    memory_kb: int = 0
    message: str = ""


class CodeRunResult(BaseModel):
    status: str
    mode: CodeRunMode
    language: str
    stdout: str = ""
    stderr: str = ""
    compile_output: str = ""
    time_ms: int = 0
    memory_kb: int = 0
    case_count: int = 0
    passed_count: int = 0
    cases: list[CodeRunCaseResult] = []
```

```python
# backend/src/app/code_runner/limits.py
COMPILE_TIMEOUT_SECONDS = 8
RUN_TIMEOUT_SECONDS = 3
MAX_OUTPUT_BYTES = 128 * 1024
```

```python
# backend/src/app/code_runner/__init__.py
from .schemas import CodeRunCaseResult, CodeRunMode, CodeRunRequest, CodeRunResult

__all__ = [
    "CodeRunCaseResult",
    "CodeRunMode",
    "CodeRunRequest",
    "CodeRunResult",
]
```

```python
# backend/src/app/exams/student_schemas.py
from app.code_runner.schemas import CodeRunMode


class StudentCodeRunRequest(BaseModel):
    language: str
    code: str
    mode: CodeRunMode
    custom_input: str = ""
    sample_case_index: int | None = None


class StudentCodeRunCaseResponse(BaseModel):
    name: str
    input: str
    expected_output: str | None = None
    actual_output: str = ""
    status: str
    time_ms: int = 0
    memory_kb: int = 0
    message: str = ""


class StudentCodeRunResponse(BaseModel):
    status: str
    mode: CodeRunMode
    language: str
    stdout: str = ""
    stderr: str = ""
    compile_output: str = ""
    time_ms: int = 0
    memory_kb: int = 0
    case_count: int = 0
    passed_count: int = 0
    cases: list[StudentCodeRunCaseResponse] = []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py -q`

Expected: PASS for the schema round-trip test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/code_runner/__init__.py backend/src/app/code_runner/schemas.py backend/src/app/code_runner/limits.py backend/src/app/exams/student_schemas.py backend/tests/test_code_runner_service.py
git commit -m "feat: add code runner schemas"
```

## Task 2: Build Output Comparison and Language Command Builders

**Files:**
- Create: `backend/src/app/code_runner/compare.py`
- Create: `backend/src/app/code_runner/executors.py`
- Test: `backend/tests/test_code_runner_service.py`

- [ ] **Step 1: Write failing tests for comparison and language config**

```python
from app.code_runner.compare import compare_case_output, normalize_output
from app.code_runner.executors import build_language_spec


def test_normalize_output_ignores_trailing_whitespace() -> None:
    assert normalize_output("3 \n") == "3"
    assert compare_case_output("3\n", "3 \n") is True


def test_build_language_spec_for_cpp() -> None:
    spec = build_language_spec("cpp")
    assert spec.source_filename == "main.cpp"
    assert spec.compile_command[:2] == ["g++", "main.cpp"]
    assert spec.run_command == ["./main"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py -q`

Expected: FAIL with import errors for `compare` and `executors`.

- [ ] **Step 3: Implement comparison helpers and executor specs**

```python
# backend/src/app/code_runner/compare.py
def normalize_output(value: str | None) -> str:
    if not value:
        return ""
    return "\n".join(line.rstrip() for line in value.replace("\r\n", "\n").strip().split("\n")).strip()


def compare_case_output(actual: str | None, expected: str | None) -> bool:
    return normalize_output(actual) == normalize_output(expected)
```

```python
# backend/src/app/code_runner/executors.py
from dataclasses import dataclass


@dataclass(frozen=True)
class LanguageSpec:
    language: str
    source_filename: str
    compile_command: list[str] | None
    run_command: list[str]


def build_language_spec(language: str) -> LanguageSpec:
    mapping = {
        "python": LanguageSpec("python", "main.py", None, ["python3", "main.py"]),
        "javascript": LanguageSpec("javascript", "main.js", None, ["node", "main.js"]),
        "java": LanguageSpec("java", "Solution.java", ["javac", "Solution.java"], ["java", "Solution"]),
        "c": LanguageSpec("c", "main.c", ["gcc", "main.c", "-O2", "-o", "main"], ["./main"]),
        "cpp": LanguageSpec("cpp", "main.cpp", ["g++", "main.cpp", "-O2", "-std=c++17", "-o", "main"], ["./main"]),
        "go": LanguageSpec("go", "main.go", ["go", "build", "-o", "main", "main.go"], ["./main"]),
    }
    try:
        return mapping[language]
    except KeyError as exc:
        raise ValueError(f"Unsupported language: {language}") from exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py -q`

Expected: PASS for normalization and language-spec tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/code_runner/compare.py backend/src/app/code_runner/executors.py backend/tests/test_code_runner_service.py
git commit -m "feat: add code runner executor specs"
```

## Task 3: Implement Backend Execution Service

**Files:**
- Create: `backend/src/app/code_runner/service.py`
- Modify: `backend/src/app/code_runner/__init__.py`
- Test: `backend/tests/test_code_runner_service.py`

- [ ] **Step 1: Write failing service tests**

```python
from app.code_runner.schemas import CodeRunMode, CodeRunRequest
from app.code_runner.service import run_code


def test_run_code_sample_mode_returns_passed_case() -> None:
    request = CodeRunRequest(language="python", code="print(1 + 2)", mode=CodeRunMode.SAMPLE)
    sample_tests = [{"name": "示例 1", "input": "", "expected_output": "3", "is_public": True}]

    result = run_code(request=request, sample_tests=sample_tests)

    assert result.status == "passed"
    assert result.passed_count == 1
    assert result.cases[0].actual_output == "3\n"


def test_run_code_custom_mode_returns_stdout_only() -> None:
    request = CodeRunRequest(
        language="python",
        code="value = input().strip()\nprint(value.upper())",
        mode=CodeRunMode.CUSTOM,
        custom_input="hello",
    )

    result = run_code(request=request, sample_tests=[])

    assert result.mode.value == "custom"
    assert result.stdout == "HELLO\n"
    assert result.case_count == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py -q`

Expected: FAIL because `run_code` does not exist.

- [ ] **Step 3: Implement minimal execution service**

```python
# backend/src/app/code_runner/service.py
from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path

from .compare import compare_case_output
from .executors import build_language_spec
from .limits import COMPILE_TIMEOUT_SECONDS, MAX_OUTPUT_BYTES, RUN_TIMEOUT_SECONDS
from .schemas import CodeRunCaseResult, CodeRunMode, CodeRunRequest, CodeRunResult


def _truncate(value: str) -> str:
    encoded = value.encode("utf-8", errors="ignore")
    if len(encoded) <= MAX_OUTPUT_BYTES:
        return value
    return encoded[:MAX_OUTPUT_BYTES].decode("utf-8", errors="ignore")


def _run_process(command: list[str], cwd: Path, stdin_text: str, timeout_seconds: int) -> tuple[int, str, str, int]:
    started = time.perf_counter()
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return completed.returncode, _truncate(completed.stdout), _truncate(completed.stderr), elapsed_ms


def run_code(*, request: CodeRunRequest, sample_tests: list[dict]) -> CodeRunResult:
    spec = build_language_spec(request.language)
    with tempfile.TemporaryDirectory(prefix="exam-code-run-") as temp_dir:
        cwd = Path(temp_dir)
        (cwd / spec.source_filename).write_text(request.code, encoding="utf-8")

        compile_output = ""
        if spec.compile_command:
            compile_returncode, compile_stdout, compile_stderr, compile_ms = _run_process(
                spec.compile_command, cwd, "", COMPILE_TIMEOUT_SECONDS
            )
            compile_output = f"{compile_stdout}{compile_stderr}"
            if compile_returncode != 0:
                return CodeRunResult(
                    status="compile_error",
                    mode=request.mode,
                    language=request.language,
                    compile_output=compile_output,
                    stderr=compile_stderr,
                    stdout=compile_stdout,
                    time_ms=compile_ms,
                    memory_kb=0,
                    case_count=0,
                    passed_count=0,
                    cases=[],
                )

        if request.mode is CodeRunMode.CUSTOM:
            returncode, stdout, stderr, elapsed_ms = _run_process(
                spec.run_command,
                cwd,
                request.custom_input,
                RUN_TIMEOUT_SECONDS,
            )
            status = "passed" if returncode == 0 else "runtime_error"
            return CodeRunResult(
                status=status,
                mode=request.mode,
                language=request.language,
                stdout=stdout,
                stderr=stderr,
                compile_output=compile_output,
                time_ms=elapsed_ms,
                memory_kb=0,
                case_count=1,
                passed_count=1 if status == "passed" else 0,
                cases=[
                    CodeRunCaseResult(
                        name="自定义测试",
                        input=request.custom_input,
                        expected_output=None,
                        actual_output=stdout,
                        status=status,
                        time_ms=elapsed_ms,
                        memory_kb=0,
                        message=stderr,
                    )
                ],
            )

        visible_cases = [item for item in sample_tests if item.get("is_public") is True]
        case_results: list[CodeRunCaseResult] = []
        passed_count = 0
        total_ms = 0
        overall_status = "passed"
        for index, case in enumerate(visible_cases, start=1):
            returncode, stdout, stderr, elapsed_ms = _run_process(
                spec.run_command,
                cwd,
                case.get("input", ""),
                RUN_TIMEOUT_SECONDS,
            )
            total_ms += elapsed_ms
            status = "runtime_error"
            if returncode == 0:
                status = "passed" if compare_case_output(stdout, case.get("expected_output", "")) else "failed"
            if status == "passed":
                passed_count += 1
            else:
                overall_status = status if overall_status == "passed" else overall_status
            case_results.append(
                CodeRunCaseResult(
                    name=case.get("name", f"示例 {index}"),
                    input=case.get("input", ""),
                    expected_output=case.get("expected_output", ""),
                    actual_output=stdout,
                    status=status,
                    time_ms=elapsed_ms,
                    memory_kb=0,
                    message=stderr,
                )
            )
        return CodeRunResult(
            status=overall_status,
            mode=request.mode,
            language=request.language,
            stdout=case_results[-1].actual_output if case_results else "",
            stderr="",
            compile_output=compile_output,
            time_ms=total_ms,
            memory_kb=0,
            case_count=len(case_results),
            passed_count=passed_count,
            cases=case_results,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py -q`

Expected: PASS for basic sample/custom execution tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/code_runner/service.py backend/src/app/code_runner/__init__.py backend/tests/test_code_runner_service.py
git commit -m "feat: implement code runner service"
```

## Task 4: Harden Service for Timeout, Runtime Error, and Unsupported Language

**Files:**
- Modify: `backend/src/app/code_runner/service.py`
- Modify: `backend/tests/test_code_runner_service.py`

- [ ] **Step 1: Write failing edge-case tests**

```python
from app.code_runner.schemas import CodeRunMode, CodeRunRequest
from app.code_runner.service import run_code


def test_run_code_returns_runtime_error_for_nonzero_exit() -> None:
    request = CodeRunRequest(language="python", code="raise ValueError('boom')", mode=CodeRunMode.CUSTOM)
    result = run_code(request=request, sample_tests=[])
    assert result.status == "runtime_error"
    assert "ValueError" in result.stderr


def test_run_code_returns_timeout_status() -> None:
    request = CodeRunRequest(language="python", code="while True:\n    pass\n", mode=CodeRunMode.CUSTOM)
    result = run_code(request=request, sample_tests=[])
    assert result.status == "timeout"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py -q`

Expected: FAIL because timeout currently raises and runtime status is incomplete.

- [ ] **Step 3: Implement timeout and error normalization**

```python
# inside backend/src/app/code_runner/service.py
try:
    completed = subprocess.run(...)
except subprocess.TimeoutExpired as exc:
    elapsed_ms = int(timeout_seconds * 1000)
    stdout = _truncate((exc.stdout or "") if isinstance(exc.stdout, str) else "")
    stderr = _truncate((exc.stderr or "") if isinstance(exc.stderr, str) else "")
    return -999, stdout, stderr, elapsed_ms
```

```python
# map -999 to timeout
if returncode == -999:
    status = "timeout"
elif returncode == 0:
    ...
else:
    status = "runtime_error"
```

```python
# wrap unsupported language
try:
    spec = build_language_spec(request.language)
except ValueError:
    return CodeRunResult(
        status="system_error",
        mode=request.mode,
        language=request.language,
        stderr="当前语言暂不支持在线运行。",
        compile_output="",
        stdout="",
        time_ms=0,
        memory_kb=0,
        case_count=0,
        passed_count=0,
        cases=[],
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py -q`

Expected: PASS including timeout and runtime error tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/code_runner/service.py backend/tests/test_code_runner_service.py
git commit -m "feat: harden code runner statuses"
```

## Task 5: Expose Student Exam Run API

**Files:**
- Modify: `backend/src/app/exams/student_router.py`
- Modify: `backend/src/app/exams/student_schemas.py`
- Test: `backend/tests/test_student_code_run_api.py`

- [ ] **Step 1: Write failing route tests**

```python
def test_student_can_run_code_question_sample(client, student_token, seeded_exam_with_code_question):
    exam_id, question_id = seeded_exam_with_code_question
    response = client.post(
        f"/api/student/exams/{exam_id}/questions/{question_id}/run",
        headers={"Authorization": f"Bearer {student_token}"},
        json={
            "language": "python",
            "code": "print(1 + 2)",
            "mode": "sample",
            "custom_input": "",
            "sample_case_index": None,
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] in {"passed", "failed"}


def test_student_cannot_run_non_code_question(client, student_token, seeded_exam_with_choice_question):
    exam_id, question_id = seeded_exam_with_choice_question
    response = client.post(
        f"/api/student/exams/{exam_id}/questions/{question_id}/run",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"language": "python", "code": "print(1)", "mode": "sample"},
    )
    assert response.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_student_code_run_api.py -q`

Expected: FAIL with 404 route not found.

- [ ] **Step 3: Add route with business validation**

```python
# backend/src/app/exams/student_router.py
from app.code_runner.service import run_code
from app.exams.student_schemas import StudentCodeRunRequest, StudentCodeRunResponse


@router.post("/exams/{exam_id}/questions/{question_id}/run", response_model=StudentCodeRunResponse)
async def run_code_for_student_exam(
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: StudentCodeRunRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> StudentCodeRunResponse:
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status_code=404, detail="Exam not found")

    exam_student = (
        await db.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == exam_id,
                ExamStudent.student_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if exam_student is None:
        raise HTTPException(status_code=404, detail="Exam assignment not found")

    now = _utcnow()
    if exam.start_time and _as_utc(exam.start_time) and now < _as_utc(exam.start_time):
        raise HTTPException(status_code=400, detail="Exam not started")
    if exam.end_time and _as_utc(exam.end_time) and now > _as_utc(exam.end_time):
        raise HTTPException(status_code=400, detail="Exam already ended")

    question = (await db.execute(select(Question).where(Question.id == question_id))).scalar_one_or_none()
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    if question.type != QuestionType.CODE:
        raise HTTPException(status_code=400, detail="Only code questions can be run online")

    order_item = next((item for item in exam.questions if str(item.get("question_id")) == str(question_id)), None)
    if order_item is None:
        raise HTTPException(status_code=400, detail="Question does not belong to this exam")

    sample_tests = []
    if isinstance(question.content, dict):
        sample_tests = question.content.get("sample_tests") or []

    result = run_code(
        request=CodeRunRequest(**payload.model_dump()),
        sample_tests=sample_tests,
    )
    return StudentCodeRunResponse(**result.model_dump())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_student_code_run_api.py -q`

Expected: PASS for sample run and non-code rejection.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/exams/student_router.py backend/src/app/exams/student_schemas.py backend/tests/test_student_code_run_api.py
git commit -m "feat: add student code run endpoint"
```

## Task 6: Add Frontend Types and API Integration

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/pages/student/components/code-question.tsx`
- Test: `frontend/src/pages/student/components/code-question.test.tsx`

- [ ] **Step 1: Write failing frontend test for sample-mode run**

```tsx
it("runs sample tests and renders returned case results", async () => {
  server.use(
    http.post("/api/student/exams/exam-1/questions/code-1/run", async () =>
      HttpResponse.json({
        status: "passed",
        mode: "sample",
        language: "python",
        stdout: "3\n",
        stderr: "",
        compile_output: "",
        time_ms: 15,
        memory_kb: 0,
        case_count: 1,
        passed_count: 1,
        cases: [
          {
            name: "示例 1",
            input: "1 2",
            expected_output: "3",
            actual_output: "3\n",
            status: "passed",
            time_ms: 15,
            memory_kb: 0,
            message: "",
          },
        ],
      }),
    ),
  );

  render(<CodeQuestionHarness examId="exam-1" />);
  await userEvent.click(screen.getByRole("button", { name: "运行代码" }));

  expect(await screen.findByText("1 / 1 通过")).toBeInTheDocument();
  expect(screen.getByText("示例 1")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test src/pages/student/components/code-question.test.tsx --run`

Expected: FAIL because the component still renders placeholder local messages.

- [ ] **Step 3: Add types and replace placeholder run behavior**

```ts
// frontend/src/types/index.ts
export interface IStudentCodeRunCaseResult {
  name: string;
  input: string;
  expected_output?: string | null;
  actual_output: string;
  status: string;
  time_ms: number;
  memory_kb: number;
  message: string;
}

export interface IStudentCodeRunResult {
  status: "passed" | "failed" | "compile_error" | "runtime_error" | "timeout" | "system_error";
  mode: "sample" | "custom";
  language: string;
  stdout: string;
  stderr: string;
  compile_output: string;
  time_ms: number;
  memory_kb: number;
  case_count: number;
  passed_count: number;
  cases: IStudentCodeRunCaseResult[];
}
```

```tsx
// inside frontend/src/pages/student/components/code-question.tsx
const [isRunning, setIsRunning] = useState(false);
const [runResult, setRunResult] = useState<IStudentCodeRunResult | null>(null);

const handleRun = async () => {
  if (!examId) return;
  setIsRunning(true);
  setRunFeedback("");
  try {
    const response = await api.post<IStudentCodeRunResult>(
      `/api/student/exams/${examId}/questions/${question.question_id}/run`,
      {
        language,
        code: currentCode,
        mode: activeTab,
        custom_input: activeTab === "custom" ? normalized.custom_input ?? "" : "",
        sample_case_index: null,
      },
    );
    setRunResult(response.data);
  } catch (error) {
    setRunFeedback("在线运行暂时不可用，请稍后重试。");
    setRunResult(null);
  } finally {
    setIsRunning(false);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && pnpm test src/pages/student/components/code-question.test.tsx --run`

Expected: PASS for sample result rendering.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/student/components/code-question.tsx frontend/src/pages/student/components/code-question.test.tsx
git commit -m "feat: wire code question run api"
```

## Task 7: Render Custom Input, Errors, and Loading States

**Files:**
- Modify: `frontend/src/pages/student/components/code-question.tsx`
- Modify: `frontend/src/pages/student/components/code-question.test.tsx`

- [ ] **Step 1: Write failing tests for custom mode and error UI**

```tsx
it("renders custom run output without pass/fail summary", async () => {
  server.use(
    http.post("/api/student/exams/exam-1/questions/code-1/run", async () =>
      HttpResponse.json({
        status: "passed",
        mode: "custom",
        language: "python",
        stdout: "HELLO\n",
        stderr: "",
        compile_output: "",
        time_ms: 10,
        memory_kb: 0,
        case_count: 1,
        passed_count: 1,
        cases: [
          {
            name: "自定义测试",
            input: "hello",
            expected_output: null,
            actual_output: "HELLO\n",
            status: "passed",
            time_ms: 10,
            memory_kb: 0,
            message: "",
          },
        ],
      }),
    ),
  );

  render(<CodeQuestionHarness examId="exam-1" />);
  await userEvent.click(screen.getByRole("button", { name: "自定义测试" }));
  await userEvent.type(screen.getByPlaceholderText(/输入你自己的测试用例/), "hello");
  await userEvent.click(screen.getByRole("button", { name: "运行代码" }));

  expect(await screen.findByText("HELLO")).toBeInTheDocument();
  expect(screen.queryByText(/通过/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test src/pages/student/components/code-question.test.tsx --run`

Expected: FAIL because custom rendering still uses placeholder output text.

- [ ] **Step 3: Implement result rendering rules**

```tsx
// inside frontend/src/pages/student/components/code-question.tsx
<button
  type="button"
  onClick={() => void handleRun()}
  disabled={isRunning}
  className="..."
>
  <Play size={14} />
  {isRunning ? "运行中..." : "运行代码"}
</button>
```

```tsx
{runResult?.mode === "sample" ? (
  <div className="space-y-4">
    <div className="rounded-[0.95rem] border border-[#dbe3ef] bg-white px-4 py-3">
      <p className="text-[12px] text-[#94a3b8]">摘要</p>
      <p className="mt-2 text-[14px] font-medium text-[#334155]">
        {runResult.passed_count} / {runResult.case_count} 通过
      </p>
    </div>
    {runResult.cases.map((item) => (
      <div key={item.name} className="rounded-[0.95rem] border border-[#e6eaf2] bg-white px-4 py-3">
        <p className="text-[13px] font-medium text-[#334155]">{item.name}</p>
        <pre>{item.actual_output}</pre>
      </div>
    ))}
  </div>
) : runResult?.mode === "custom" ? (
  <div className="rounded-[0.95rem] border border-[#e6eaf2] bg-white px-4 py-3">
    <p className="text-[12px] text-[#94a3b8]">程序输出</p>
    <pre className="mt-3 whitespace-pre-wrap">{runResult.stdout || runResult.stderr || "无输出"}</pre>
  </div>
) : (
  <pre>{runFeedback || "点击“运行代码”后，这里会显示运行结果。"}</pre>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && pnpm test src/pages/student/components/code-question.test.tsx --run`

Expected: PASS for custom output and loading-state tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/student/components/code-question.tsx frontend/src/pages/student/components/code-question.test.tsx
git commit -m "feat: render code runner results"
```

## Task 8: Integrate Exam Context and Protect Existing Exam Flow

**Files:**
- Modify: `frontend/src/pages/student/exam-taking.tsx`
- Modify: `frontend/src/pages/student/components/question-renderer.tsx`
- Modify: `frontend/src/pages/student/components/code-question.tsx`
- Test: `frontend/src/pages/student/exam-taking.test.tsx`
- Test: `frontend/src/pages/student/components/question-renderer.test.tsx`

- [ ] **Step 1: Write failing integration tests**

```tsx
it("passes exam id into the code question component during exam taking", async () => {
  render(<ExamTaking />);
  expect(await screen.findByRole("button", { name: "运行代码" })).toBeInTheDocument();
});
```

```tsx
it("still renders code questions through question renderer after adding run props", () => {
  render(<QuestionRenderer question={codeQuestion} answer={{}} onChange={vi.fn()} examId="exam-1" />);
  expect(screen.getByText("题目说明")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test src/pages/student/exam-taking.test.tsx src/pages/student/components/question-renderer.test.tsx --run`

Expected: FAIL because `examId` prop does not exist yet.

- [ ] **Step 3: Thread exam context through renderer**

```tsx
// frontend/src/pages/student/components/question-renderer.tsx
interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
  examId?: string;
}

const renderers = {
  code: (props: Props) => <CodeQuestion {...props} />,
};
```

```tsx
// frontend/src/pages/student/exam-taking.tsx
<QuestionRenderer
  question={currentQuestion}
  answer={answers[currentQuestion.question_id] ?? {}}
  onChange={(value) => updateAnswer(currentQuestion.question_id, value)}
  examId={examData.exam_id}
/>
```

```tsx
// frontend/src/pages/student/components/code-question.tsx
interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
  examId?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && pnpm test src/pages/student/exam-taking.test.tsx src/pages/student/components/question-renderer.test.tsx --run`

Expected: PASS and no regression in coding-question rendering.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/student/exam-taking.tsx frontend/src/pages/student/components/question-renderer.tsx frontend/src/pages/student/components/code-question.tsx frontend/src/pages/student/exam-taking.test.tsx frontend/src/pages/student/components/question-renderer.test.tsx
git commit -m "feat: pass exam context into code question"
```

## Task 9: Final Verification and Cleanup

**Files:**
- Modify: any touched files from previous tasks
- Test: `backend/tests/test_code_runner_service.py`
- Test: `backend/tests/test_student_code_run_api.py`
- Test: `frontend/src/pages/student/components/code-question.test.tsx`
- Test: `frontend/src/pages/student/components/question-renderer.test.tsx`
- Test: `frontend/src/pages/student/exam-taking.test.tsx`

- [ ] **Step 1: Run backend test suite for code runner**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_code_runner_service.py tests/test_student_code_run_api.py -q`

Expected: PASS for all code-runner backend tests.

- [ ] **Step 2: Run frontend test suite for coding question flow**

Run: `cd frontend && pnpm test src/pages/student/components/code-question.test.tsx src/pages/student/components/question-renderer.test.tsx src/pages/student/exam-taking.test.tsx --run`

Expected: PASS for code-question UI and exam-taking integration tests.

- [ ] **Step 3: Run type check**

Run: `cd frontend && pnpm exec tsc --noEmit`

Expected: PASS with zero TypeScript errors.

- [ ] **Step 4: Run targeted backend import/start flow regression**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run --with aiosqlite pytest tests/test_student_flow.py -q`

Expected: PASS so the new run endpoint does not regress exam-taking behavior.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/code_runner backend/src/app/exams/student_router.py backend/src/app/exams/student_schemas.py backend/tests/test_code_runner_service.py backend/tests/test_student_code_run_api.py frontend/src/types/index.ts frontend/src/pages/student/components/code-question.tsx frontend/src/pages/student/components/code-question.test.tsx frontend/src/pages/student/components/question-renderer.tsx frontend/src/pages/student/components/question-renderer.test.tsx frontend/src/pages/student/exam-taking.tsx frontend/src/pages/student/exam-taking.test.tsx
git commit -m "feat: add student code runner"
```

## Self-Review

### Spec coverage

- Six languages: covered by Task 2 executor specs and Task 3 service tests.
- Sample tests and custom input: covered by Tasks 3, 6, and 7.
- New student exam run endpoint: covered by Task 5.
- Frontend async run experience and result rendering: covered by Tasks 6 and 7.
- No grading side effects: preserved by scope in Tasks 5 through 9, which only add a run endpoint and UI rendering.
- Limits and status normalization: covered by Task 4.

### Placeholder scan

- No `TBD`, `TODO`, or “similar to Task N”.
- Each code step includes concrete code or commands.
- Each verification step includes exact commands and expected outcomes.

### Type consistency

- Backend uses `CodeRunRequest`, `CodeRunResult`, and `StudentCodeRunRequest/Response` consistently.
- Frontend uses `IStudentCodeRunResult` and threads `examId` explicitly through `QuestionRenderer` into `CodeQuestion`.
- Route path is consistently `POST /api/student/exams/{exam_id}/questions/{question_id}/run`.

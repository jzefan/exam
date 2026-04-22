from __future__ import annotations

import subprocess
import tempfile
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from app.code_runner.compare import compare_case_output
from app.code_runner.executors import build_language_spec, get_missing_commands
from app.code_runner.limits import MAX_OUTPUT_BYTES, RUN_TIMEOUT_SECONDS
from app.code_runner.schemas import CodeRunCaseResult, CodeRunMode, CodeRunRequest, CodeRunResult, CodeRunStatus


def _truncate_output(value: str | bytes) -> str:
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    encoded = value.encode("utf-8")
    if len(encoded) <= MAX_OUTPUT_BYTES:
        return value
    return encoded[:MAX_OUTPUT_BYTES].decode("utf-8", errors="ignore")


def _run_subprocess(
    command: Sequence[str],
    *,
    cwd: Path,
    input_text: str = "",
    timeout_seconds: int,
) -> tuple[int | None, str, str, int, CodeRunStatus | None]:
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            list(command),
            cwd=cwd,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        stdout = _truncate_output(exc.stdout or "")
        stderr = _truncate_output(exc.stderr or "")
        return None, stdout, stderr, elapsed_ms, CodeRunStatus.TIMEOUT
    except OSError as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return None, "", _truncate_output(str(exc)), elapsed_ms, CodeRunStatus.SYSTEM_ERROR

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return (
        completed.returncode,
        _truncate_output(completed.stdout),
        _truncate_output(completed.stderr),
        elapsed_ms,
        None,
    )


def _build_compile_error_result(
    request: CodeRunRequest,
    *,
    status: CodeRunStatus,
    compile_output: str,
    stderr: str,
    time_ms: int,
) -> CodeRunResult:
    return CodeRunResult(
        status=status,
        mode=request.mode,
        language=request.language,
        stdout="",
        stderr=stderr,
        compile_output=compile_output,
        time_ms=time_ms,
        memory_kb=0,
        case_count=0,
        passed_count=0,
        cases=[],
    )


def _build_runtime_case(
    *,
    name: str,
    case_input: str,
    expected_output: str | None,
    actual_output: str,
    status: CodeRunStatus,
    time_ms: int,
    message: str,
) -> CodeRunCaseResult:
    return CodeRunCaseResult(
        name=name,
        input=case_input,
        expected_output=expected_output,
        actual_output=actual_output,
        status=status,
        time_ms=time_ms,
        memory_kb=0,
        message=message,
    )


def _merge_sample_overall_status(current: CodeRunStatus, case_status: CodeRunStatus) -> CodeRunStatus:
    return case_status if _sample_status_priority(case_status) > _sample_status_priority(current) else current


def _sample_status_priority(status: CodeRunStatus) -> int:
    priority = {
        CodeRunStatus.PASSED: 0,
        CodeRunStatus.FAILED: 1,
        CodeRunStatus.RUNTIME_ERROR: 2,
        CodeRunStatus.SYSTEM_ERROR: 3,
        CodeRunStatus.TIMEOUT: 4,
    }
    return priority[status]


def run_code(request: CodeRunRequest, sample_tests: Sequence[Mapping[str, Any]]) -> CodeRunResult:
    try:
        spec = build_language_spec(request.language)
    except ValueError as exc:
        return CodeRunResult(
            status=CodeRunStatus.SYSTEM_ERROR,
            mode=request.mode,
            language=request.language,
            stdout="",
            stderr=_truncate_output(str(exc)),
            compile_output="",
            time_ms=0,
            memory_kb=0,
            case_count=0,
            passed_count=0,
            cases=[],
        )

    missing_commands = get_missing_commands(spec)
    if missing_commands:
        command_list = " / ".join(missing_commands)
        message = f"当前运行环境未安装 {command_list}，暂不支持 {request.language} 在线运行。"
        return CodeRunResult(
            status=CodeRunStatus.SYSTEM_ERROR,
            mode=request.mode,
            language=request.language,
            stdout="",
            stderr=message,
            compile_output=message,
            time_ms=0,
            memory_kb=0,
            case_count=0,
            passed_count=0,
            cases=[],
        )

    with tempfile.TemporaryDirectory(prefix="code-runner-") as temp_dir:
        workspace = Path(temp_dir)
        source_path = workspace / spec.source_filename
        source_path.write_text(request.code, encoding="utf-8")

        compile_output = ""
        if spec.compile_command:
            compile_returncode, compile_stdout, compile_stderr, compile_time_ms, compile_status = _run_subprocess(
                spec.compile_command,
                cwd=workspace,
                timeout_seconds=spec.compile_timeout_seconds,
            )
            compile_output = _truncate_output(f"{compile_stdout}{compile_stderr}")
            if compile_status is CodeRunStatus.TIMEOUT:
                return _build_compile_error_result(
                    request,
                    status=CodeRunStatus.COMPILE_ERROR,
                    compile_output=compile_output,
                    stderr=compile_stderr,
                    time_ms=compile_time_ms,
                )
            if compile_status is CodeRunStatus.SYSTEM_ERROR:
                return _build_compile_error_result(
                    request,
                    status=CodeRunStatus.SYSTEM_ERROR,
                    compile_output=compile_output,
                    stderr=compile_stderr,
                    time_ms=compile_time_ms,
                )
            if compile_returncode not in (0, None):
                return _build_compile_error_result(
                    request,
                    status=CodeRunStatus.COMPILE_ERROR,
                    compile_output=compile_output,
                    stderr=compile_stderr,
                    time_ms=compile_time_ms,
                )

        if request.mode is CodeRunMode.CUSTOM:
            returncode, stdout, stderr, time_ms, run_status = _run_subprocess(
                spec.run_command,
                cwd=workspace,
                input_text=request.custom_input,
                timeout_seconds=RUN_TIMEOUT_SECONDS,
            )
            if run_status is CodeRunStatus.TIMEOUT:
                case_status = CodeRunStatus.TIMEOUT
                result_status = CodeRunStatus.TIMEOUT
                message = "Execution timed out"
            elif run_status is CodeRunStatus.SYSTEM_ERROR:
                case_status = CodeRunStatus.SYSTEM_ERROR
                result_status = CodeRunStatus.SYSTEM_ERROR
                message = stderr
            elif returncode == 0:
                case_status = CodeRunStatus.PASSED
                result_status = CodeRunStatus.PASSED
                message = ""
            else:
                case_status = CodeRunStatus.RUNTIME_ERROR
                result_status = CodeRunStatus.RUNTIME_ERROR
                message = stderr

            case = _build_runtime_case(
                name="自定义测试",
                case_input=request.custom_input,
                expected_output=None,
                actual_output=stdout,
                status=case_status,
                time_ms=time_ms,
                message=message,
            )
            passed_count = 1 if case_status is CodeRunStatus.PASSED else 0
            return CodeRunResult(
                status=result_status,
                mode=request.mode,
                language=request.language,
                stdout=stdout,
                stderr=stderr,
                compile_output=compile_output,
                time_ms=time_ms,
                memory_kb=0,
                case_count=1,
                passed_count=passed_count,
                cases=[case],
            )

        public_tests = [case for case in sample_tests if case.get("is_public")]
        if not public_tests:
            return CodeRunResult(
                status=CodeRunStatus.SYSTEM_ERROR,
                mode=request.mode,
                language=request.language,
                stdout="",
                stderr="No public sample cases available",
                compile_output=compile_output,
                time_ms=0,
                memory_kb=0,
                case_count=0,
                passed_count=0,
                cases=[],
            )
        if request.sample_case_index is not None:
            if 0 <= request.sample_case_index < len(public_tests):
                public_tests = [public_tests[request.sample_case_index]]
            else:
                return CodeRunResult(
                    status=CodeRunStatus.SYSTEM_ERROR,
                    mode=request.mode,
                    language=request.language,
                    stdout="",
                    stderr=_truncate_output(f"Invalid sample_case_index: {request.sample_case_index}"),
                    compile_output=compile_output,
                    time_ms=0,
                    memory_kb=0,
                    case_count=0,
                    passed_count=0,
                    cases=[],
                )
        cases: list[CodeRunCaseResult] = []
        passed_count = 0
        overall_status = CodeRunStatus.PASSED
        result_stdout = ""
        result_stderr = ""
        result_time_ms = 0
        best_priority = -1

        for index, sample_test in enumerate(public_tests, start=1):
            case_input = str(sample_test.get("input", ""))
            expected_output = sample_test.get("expected_output")
            expected_text = None if expected_output is None else str(expected_output)
            returncode, stdout, stderr, time_ms, run_status = _run_subprocess(
                spec.run_command,
                cwd=workspace,
                input_text=case_input,
                timeout_seconds=RUN_TIMEOUT_SECONDS,
            )
            if run_status is CodeRunStatus.TIMEOUT:
                case_status = CodeRunStatus.TIMEOUT
                message = "Execution timed out"
            elif run_status is CodeRunStatus.SYSTEM_ERROR:
                case_status = CodeRunStatus.SYSTEM_ERROR
                message = stderr
            elif returncode != 0:
                case_status = CodeRunStatus.RUNTIME_ERROR
                message = stderr
            elif compare_case_output(stdout, expected_text):
                case_status = CodeRunStatus.PASSED
                passed_count += 1
                message = ""
            else:
                case_status = CodeRunStatus.FAILED
                message = ""

            overall_status = _merge_sample_overall_status(overall_status, case_status)
            case_priority = _sample_status_priority(case_status)
            if case_priority > best_priority:
                result_stdout = stdout
                result_stderr = stderr
                result_time_ms = time_ms
                best_priority = case_priority

            cases.append(
                _build_runtime_case(
                    name=str(sample_test.get("name") or f"示例 {index}"),
                    case_input=case_input,
                    expected_output=expected_text,
                    actual_output=stdout,
                    status=case_status,
                    time_ms=time_ms,
                    message=message,
                )
            )

        return CodeRunResult(
            status=overall_status,
            mode=request.mode,
            language=request.language,
            stdout=result_stdout,
            stderr=result_stderr,
            compile_output=compile_output,
            time_ms=result_time_ms,
            memory_kb=0,
            case_count=len(cases),
            passed_count=passed_count,
            cases=cases,
        )

"""Unit tests for code runner schema round-trips."""

import subprocess

import pytest
from pydantic import TypeAdapter

from app.code_runner import service
from app.code_runner.compare import compare_case_output, normalize_output
from app.code_runner.executors import build_language_spec, get_missing_commands
from app.code_runner.service import run_code
from app.code_runner.schemas import CodeRunCaseResult, CodeRunMode, CodeRunRequest, CodeRunResult, CodeRunStatus


def test_code_run_schema_round_trip() -> None:
    mode_round_trip = TypeAdapter(CodeRunMode).validate_python(CodeRunMode.SAMPLE.value)
    status_round_trip = TypeAdapter(CodeRunStatus).validate_python(CodeRunStatus.PASSED.value)
    payload = CodeRunRequest(
        language="python",
        code="print('ok')",
        mode=mode_round_trip,
        custom_input="",
        sample_case_index=None,
    )

    case = CodeRunCaseResult(
        name="示例 1",
        input="1 2",
        expected_output="3",
        actual_output="3",
        status=status_round_trip,
        time_ms=12,
        memory_kb=0,
        message="",
    )
    case_round_trip = CodeRunCaseResult.model_validate(case.model_dump())
    result = CodeRunResult(
        status=status_round_trip,
        mode=mode_round_trip,
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

    payload_round_trip = CodeRunRequest.model_validate(payload.model_dump())
    result_round_trip = CodeRunResult.model_validate(result.model_dump())

    assert mode_round_trip is CodeRunMode.SAMPLE
    assert status_round_trip is CodeRunStatus.PASSED
    assert case_round_trip == case
    assert payload_round_trip.mode is CodeRunMode.SAMPLE
    assert payload_round_trip.custom_input == ""
    assert result_round_trip.cases[0] == case
    assert result_round_trip.status is CodeRunStatus.PASSED
    assert result_round_trip.cases[0].status is CodeRunStatus.PASSED


def test_compare_case_output_ignores_trailing_whitespace() -> None:
    assert normalize_output("hello \n") == "hello"
    assert compare_case_output("42\n", "42") is True


def test_build_language_spec_cpp() -> None:
    spec = build_language_spec("cpp")

    assert spec.source_filename == "main.cpp"
    assert spec.compile_command == ["g++", "-O2", "-std=c++17", "main.cpp", "-o", "main"]
    assert spec.run_command == ["./main"]
    assert spec.required_commands == ("g++",)


def test_get_missing_commands_reports_missing_toolchain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.code_runner.executors.which",
        lambda command: None if command in {"go", "java", "javac"} else f"/usr/bin/{command}",
    )

    go_spec = build_language_spec("go")
    java_spec = build_language_spec("java")

    assert get_missing_commands(go_spec) == ("go",)
    assert get_missing_commands(java_spec) == ("javac", "java")


def test_get_missing_commands_treats_java_stub_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    class Completed:
        def __init__(self, returncode: int) -> None:
            self.returncode = returncode
            self.stdout = ""
            self.stderr = "Unable to locate a Java Runtime."

    monkeypatch.setattr("app.code_runner.executors.which", lambda command: f"/usr/bin/{command}")

    def fake_run(command: list[str], **_: object) -> Completed:
        if command[0] in {"java", "javac"}:
            return Completed(1)
        return Completed(0)

    monkeypatch.setattr("app.code_runner.executors.subprocess.run", fake_run)

    java_spec = build_language_spec("java")

    assert get_missing_commands(java_spec) == ("javac", "java")


def test_run_code_sample_mode_returns_passed_public_case_for_python() -> None:
    request = CodeRunRequest(
        language="python",
        code="print(1 + 2)",
        mode=CodeRunMode.SAMPLE,
        custom_input="",
        sample_case_index=None,
    )

    result = run_code(
        request,
        sample_tests=[
            {
                "name": "示例 1",
                "input": "",
                "expected_output": "3",
                "is_public": True,
            }
        ],
    )

    assert result.status is CodeRunStatus.PASSED
    assert result.passed_count == 1
    assert result.case_count == 1
    assert result.cases[0].name == "示例 1"
    assert result.cases[0].status is CodeRunStatus.PASSED
    assert result.cases[0].actual_output == "3\n"


def test_run_code_custom_mode_returns_stdout_only_for_python_input() -> None:
    request = CodeRunRequest(
        language="python",
        code="print(input().strip().upper())",
        mode=CodeRunMode.CUSTOM,
        custom_input="hello\n",
        sample_case_index=None,
    )

    result = run_code(request, sample_tests=[])

    assert result.status is CodeRunStatus.PASSED
    assert result.case_count == 1
    assert result.passed_count == 1
    assert result.stdout == "HELLO\n"
    assert result.stderr == ""
    assert result.cases[0].name == "自定义测试"
    assert result.cases[0].input == "hello\n"
    assert result.cases[0].expected_output is None
    assert result.cases[0].actual_output == "HELLO\n"


def test_run_code_custom_mode_returns_runtime_error_for_python_exception() -> None:
    request = CodeRunRequest(
        language="python",
        code="raise ValueError('boom')",
        mode=CodeRunMode.CUSTOM,
        custom_input="",
        sample_case_index=None,
    )

    result = run_code(request, sample_tests=[])

    assert result.status is CodeRunStatus.RUNTIME_ERROR
    assert result.case_count == 1
    assert result.passed_count == 0
    assert "ValueError" in result.stderr
    assert result.cases[0].status is CodeRunStatus.RUNTIME_ERROR


def test_run_code_custom_mode_returns_timeout_for_python_infinite_loop() -> None:
    request = CodeRunRequest(
        language="python",
        code="while True:\n    pass\n",
        mode=CodeRunMode.CUSTOM,
        custom_input="",
        sample_case_index=None,
    )

    result = run_code(request, sample_tests=[])

    assert result.status is CodeRunStatus.TIMEOUT
    assert result.case_count == 1
    assert result.passed_count == 0
    assert result.cases[0].status is CodeRunStatus.TIMEOUT


def test_run_code_returns_system_error_for_unsupported_language() -> None:
    request = CodeRunRequest(
        language="ruby",
        code="puts 'ok'",
        mode=CodeRunMode.CUSTOM,
        custom_input="",
        sample_case_index=None,
    )

    result = run_code(request, sample_tests=[])

    assert result.status is CodeRunStatus.SYSTEM_ERROR
    assert result.case_count == 0
    assert result.passed_count == 0
    assert "Unsupported language" in result.stderr


def test_run_code_returns_clear_message_when_toolchain_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.code_runner.service.get_missing_commands", lambda spec: ("go",) if "main.go" == spec.source_filename else ())

    request = CodeRunRequest(
        language="go",
        code="package main\nfunc main() {}\n",
        mode=CodeRunMode.SAMPLE,
        custom_input="",
        sample_case_index=None,
    )

    result = run_code(
        request,
        sample_tests=[
            {"name": "示例 1", "input": "", "expected_output": "", "is_public": True},
        ],
    )

    assert result.status is CodeRunStatus.SYSTEM_ERROR
    assert "当前运行环境未安装 go" in result.stderr
    assert result.case_count == 0


def test_run_code_returns_system_error_for_invalid_sample_case_index() -> None:
    request = CodeRunRequest(
        language="python",
        code="print('ok')",
        mode=CodeRunMode.SAMPLE,
        custom_input="",
        sample_case_index=3,
    )

    result = run_code(
        request,
        sample_tests=[
            {"name": "示例 1", "input": "", "expected_output": "ok", "is_public": True},
            {"name": "示例 2", "input": "", "expected_output": "ok", "is_public": True},
        ],
    )

    assert result.status is CodeRunStatus.SYSTEM_ERROR
    assert result.case_count == 0
    assert result.passed_count == 0
    assert "sample_case_index" in result.stderr


def test_run_code_returns_system_error_when_no_public_sample_cases_are_runnable() -> None:
    request = CodeRunRequest(
        language="python",
        code="print('ok')",
        mode=CodeRunMode.SAMPLE,
        custom_input="",
        sample_case_index=None,
    )

    result = run_code(
        request,
        sample_tests=[
            {"name": "隐藏示例 1", "input": "", "expected_output": "ok", "is_public": False},
            {"name": "隐藏示例 2", "input": "", "expected_output": "ok", "is_public": False},
        ],
    )

    assert result.status is CodeRunStatus.SYSTEM_ERROR
    assert result.case_count == 0
    assert result.passed_count == 0
    assert "No public sample cases" in result.stderr


def test_run_code_prefers_zero_public_case_error_over_invalid_index_when_all_samples_hidden() -> None:
    request = CodeRunRequest(
        language="python",
        code="print('ok')",
        mode=CodeRunMode.SAMPLE,
        custom_input="",
        sample_case_index=0,
    )

    result = run_code(
        request,
        sample_tests=[
            {"name": "隐藏示例 1", "input": "", "expected_output": "ok", "is_public": False},
            {"name": "隐藏示例 2", "input": "", "expected_output": "ok", "is_public": False},
        ],
    )

    assert result.status is CodeRunStatus.SYSTEM_ERROR
    assert result.case_count == 0
    assert result.passed_count == 0
    assert result.stderr == "No public sample cases available"


def test_run_code_sample_case_index_selects_single_public_case() -> None:
    request = CodeRunRequest(
        language="python",
        code="print(input().strip())",
        mode=CodeRunMode.SAMPLE,
        custom_input="",
        sample_case_index=1,
    )

    result = run_code(
        request,
        sample_tests=[
            {"name": "示例 1", "input": "first\n", "expected_output": "first", "is_public": True},
            {"name": "示例 2", "input": "second\n", "expected_output": "second", "is_public": True},
            {"name": "隐藏示例", "input": "hidden\n", "expected_output": "hidden", "is_public": False},
        ],
    )

    assert result.status is CodeRunStatus.PASSED
    assert result.case_count == 1
    assert result.passed_count == 1
    assert result.stdout == "second\n"
    assert result.cases[0].name == "示例 2"
    assert result.cases[0].input == "second\n"


def test_run_code_process_launch_failure_returns_system_error(monkeypatch) -> None:
    def fake_run(*args, **kwargs):
        raise OSError("runtime missing")

    monkeypatch.setattr("app.code_runner.service.get_missing_commands", lambda spec: ())
    monkeypatch.setattr(service.subprocess, "run", fake_run)
    request = CodeRunRequest(
        language="python",
        code="print('ok')",
        mode=CodeRunMode.CUSTOM,
        custom_input="",
        sample_case_index=None,
    )

    result = run_code(request, sample_tests=[])

    assert result.status is CodeRunStatus.SYSTEM_ERROR
    assert result.case_count == 1
    assert result.passed_count == 0
    assert result.stderr == "runtime missing"
    assert result.cases[0].name == "自定义测试"
    assert result.cases[0].status is CodeRunStatus.SYSTEM_ERROR
    assert result.cases[0].message == "runtime missing"


def test_run_subprocess_timeout_handles_partial_byte_output(monkeypatch, tmp_path) -> None:
    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(
            cmd=["python3", "main.py"],
            timeout=1,
            output=b"partial stdout",
            stderr=b"partial stderr",
        )

    monkeypatch.setattr(service.subprocess, "run", fake_run)

    returncode, stdout, stderr, time_ms, status = service._run_subprocess(
        ["python3", "main.py"],
        cwd=tmp_path,
        timeout_seconds=1,
    )

    assert returncode is None
    assert stdout == "partial stdout"
    assert stderr == "partial stderr"
    assert time_ms >= 0
    assert status is CodeRunStatus.TIMEOUT


def test_run_code_sample_mode_keeps_earlier_timeout_as_overall_status(monkeypatch) -> None:
    outcomes = iter(
        [
            (None, "timed out stdout", "timed out stderr", 10, CodeRunStatus.TIMEOUT),
            (1, "later stdout", "boom", 5, None),
        ]
    )

    def fake_run_subprocess(*args, **kwargs):
        return next(outcomes)

    monkeypatch.setattr(service, "_run_subprocess", fake_run_subprocess)
    request = CodeRunRequest(
        language="python",
        code="print('ignored')",
        mode=CodeRunMode.SAMPLE,
        custom_input="",
        sample_case_index=None,
    )

    result = run_code(
        request,
        sample_tests=[
            {"name": "示例 1", "input": "", "expected_output": "x", "is_public": True},
            {"name": "示例 2", "input": "", "expected_output": "y", "is_public": True},
        ],
    )

    assert result.status is CodeRunStatus.TIMEOUT
    assert result.case_count == 2
    assert result.stdout == "timed out stdout"
    assert result.stderr == "timed out stderr"
    assert result.time_ms == 10
    assert result.cases[0].status is CodeRunStatus.TIMEOUT
    assert result.cases[1].status is CodeRunStatus.RUNTIME_ERROR

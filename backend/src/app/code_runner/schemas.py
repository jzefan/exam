from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class CodeRunMode(str, Enum):
    SAMPLE = "sample"
    CUSTOM = "custom"


class CodeRunStatus(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    COMPILE_ERROR = "compile_error"
    RUNTIME_ERROR = "runtime_error"
    TIMEOUT = "timeout"
    SYSTEM_ERROR = "system_error"


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
    status: CodeRunStatus
    time_ms: int = 0
    memory_kb: int = 0
    message: str = ""


class CodeRunResult(BaseModel):
    status: CodeRunStatus
    mode: CodeRunMode
    language: str
    stdout: str = ""
    stderr: str = ""
    compile_output: str = ""
    time_ms: int = 0
    memory_kb: int = 0
    case_count: int = 0
    passed_count: int = 0
    cases: list[CodeRunCaseResult] = Field(default_factory=list)

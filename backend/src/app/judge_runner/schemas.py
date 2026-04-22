from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.code_runner.schemas import CodeRunRequest


class JudgeRunPayload(BaseModel):
    request: CodeRunRequest
    sample_tests: list[dict[str, Any]] = Field(default_factory=list)

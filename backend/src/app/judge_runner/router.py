from __future__ import annotations

from fastapi import APIRouter

from app.code_runner.schemas import CodeRunResult
from app.code_runner.service import run_code
from app.judge_runner.schemas import JudgeRunPayload

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/run", response_model=CodeRunResult)
async def run(payload: JudgeRunPayload) -> CodeRunResult:
    return run_code(payload.request, payload.sample_tests)

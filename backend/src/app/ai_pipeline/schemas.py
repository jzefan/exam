"""Pydantic schemas for the AI pipeline feature."""

import uuid
from typing import Literal

from pydantic import BaseModel, Field

StepEnum = Literal[
    "extraction",
    "llm_extract",
    "llm_clean",
    "llm_decompose",
    "llm_grade",
    "vector_match",
    "done",
    "error",
]

StatusEnum = Literal["processing", "success", "error"]


class DocumentUploadResponse(BaseModel):
    model_config = {"from_attributes": True}

    document_id: uuid.UUID
    status: str = "extracting"
    message: str = "Document processing started"


class ProgressResponse(BaseModel):
    model_config = {"from_attributes": True}

    document_id: uuid.UUID
    step: StepEnum
    progress: int = Field(ge=0, le=100)
    status: StatusEnum
    result: dict | None = None
    error_message: str | None = None


class GeneratedModelResponse(BaseModel):
    model_config = {"from_attributes": True}

    model_id: uuid.UUID
    job_role: str
    dimensions: list[dict]
    confidence_score: float = Field(ge=0.0, le=1.0)

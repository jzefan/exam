"""Pydantic schemas for reusable paper assets."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.questions.schemas import KnowledgePointResponse, QuestionCreate, QuestionResponse

PaperSourceTypeLiteral = Literal["manual", "import", "ai_generated"]


class PaperQuestionItem(BaseModel):
    question_id: uuid.UUID
    order: int | None = Field(default=None, ge=0)
    score_override: float | None = Field(default=None, ge=0)


class PaperCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    source_type: PaperSourceTypeLiteral = "manual"
    source_paper_id: uuid.UUID | None = None
    root_knowledge_point_id: uuid.UUID | None = None
    is_reusable: bool = True
    question_items: list[PaperQuestionItem] = Field(default_factory=list, max_length=500)


class PaperUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    root_knowledge_point_id: uuid.UUID | None = None
    is_reusable: bool | None = None
    question_items: list[PaperQuestionItem] | None = Field(default=None, max_length=500)


class PaperQuestionResponse(BaseModel):
    question_id: uuid.UUID
    order: int
    score_override: float | None
    question: QuestionResponse | None = None


class PaperResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    source_type: PaperSourceTypeLiteral
    source_paper_id: uuid.UUID | None
    root_knowledge_point_id: uuid.UUID | None
    root_knowledge_point: KnowledgePointResponse | None = None
    is_reusable: bool
    archived_at: datetime | None
    question_count: int
    total_score: float
    owner_id: uuid.UUID
    created_by: uuid.UUID
    created_by_name: str
    created_at: datetime
    updated_at: datetime


class PaperDetailResponse(PaperResponse):
    questions: list[PaperQuestionResponse] = Field(default_factory=list)


class PaperImportQuestionDraft(BaseModel):
    question: QuestionCreate
    order: int = Field(default=0, ge=0)
    score_override: float | None = Field(default=None, ge=0)

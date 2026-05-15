"""Pydantic schemas for reusable paper assets."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.questions.schemas import (
    KnowledgePointResponse,
    QuestionCreate,
    QuestionImportDocumentSummary,
    QuestionImportDraft,
    QuestionImportImageInput,
    QuestionImportTableInput,
    QuestionResponse,
)

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


class PaperExamSeedResponse(BaseModel):
    paper_id: uuid.UUID
    title: str
    description: str | None
    total_score: float
    question_items: list[PaperQuestionItem] = Field(default_factory=list)


class PaperAIGenerateRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=1)
    difficulty_strategy: Literal["similar", "easier", "harder"] = "similar"
    question_type_strategy: Literal["inherit"] = "inherit"
    prefer_root_knowledge_point: bool = True
    # 复用源试卷题目的最大占比（百分比）。0 表示完全不复用，全部由 AI 新生成；上限 60%。
    source_reuse_rate: int = Field(default=0, ge=0, le=60)
    model: Literal["qwen", "deepseek", "claude"] = "deepseek"


class PaperAIGenerateResponse(BaseModel):
    paper_id: uuid.UUID
    generated_question_count: int


class PaperImportQuestionDraft(BaseModel):
    question: QuestionCreate
    order: int = Field(default=0, ge=0)
    score_override: float | None = Field(default=None, ge=0)


class PaperImportRecognizeRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    raw_text: str = Field(min_length=1, max_length=200000)
    source_format: str = Field(pattern="^(pdf|docx|md)$")
    root_knowledge_point_id: uuid.UUID | None = None
    images: list[QuestionImportImageInput] = Field(default_factory=list, max_length=200)
    tables: list[QuestionImportTableInput] = Field(default_factory=list, max_length=200)
    recognition_prompt: str | None = Field(default=None, max_length=2000)


class PaperImportRecognizeResponse(BaseModel):
    session_id: uuid.UUID
    mode: str
    summary: QuestionImportDocumentSummary
    drafts: list[QuestionImportDraft]


class PaperImportSessionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    file_name: str
    source_format: str
    root_knowledge_point_id: uuid.UUID | None
    error_detail: str | None
    preview_payload: dict
    created_paper_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PaperImportConfirmRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    root_knowledge_point_id: uuid.UUID | None = None
    drafts: list[QuestionImportDraft] = Field(min_length=1, max_length=500)
    skip_background_matching: bool = False

"""Pydantic schemas for Question, Tag, and KnowledgePoint."""

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.common.data_visibility import VisibilityScope
from app.questions.models import QuestionType, TagType


# --- Tag ---

class TagCreate(BaseModel):
    name: str = Field(max_length=100)
    type: TagType


class TagUpdate(BaseModel):
    name: str = Field(max_length=100)


class TagResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    type: TagType
    question_count: int = 0
    created_at: datetime


# --- KnowledgePoint ---

class KnowledgePointCreate(BaseModel):
    name: str = Field(max_length=200)
    parent_id: uuid.UUID | None = None
    description: str | None = None


class KnowledgePointResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None
    description: str | None
    owner_id: uuid.UUID
    visibility: VisibilityScope
    created_at: datetime


# --- QuestionBank ---

class QuestionBankCreate(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None


class QuestionBankResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    description: str | None
    owner_id: uuid.UUID
    visibility: VisibilityScope
    question_count: int = 0
    created_at: datetime


# --- Question ---

class QuestionCreate(BaseModel):
    type: QuestionType
    title: str = Field(max_length=500)
    content: dict[str, Any]
    options: dict[str, Any] | None = None
    answer: dict[str, Any]
    analysis: str | None = None
    difficulty: int = Field(ge=1, le=5)
    score: float = 10.0
    tag_ids: list[uuid.UUID] = Field(default_factory=list)
    knowledge_point_ids: list[uuid.UUID] = Field(default_factory=list)
    question_bank_id: uuid.UUID | None = None


class QuestionUpdate(BaseModel):
    type: QuestionType | None = None
    title: str | None = Field(default=None, max_length=500)
    content: dict[str, Any] | None = None
    options: dict[str, Any] | None = None
    answer: dict[str, Any] | None = None
    analysis: str | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    score: float | None = None
    tag_ids: list[uuid.UUID] | None = None
    knowledge_point_ids: list[uuid.UUID] | None = None
    question_bank_id: uuid.UUID | None = None


class QuestionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    type: QuestionType
    title: str
    content: dict[str, Any]
    options: dict[str, Any] | None
    answer: dict[str, Any]
    analysis: str | None
    difficulty: int
    score: float
    usage_count: int
    created_by: uuid.UUID
    created_by_name: str
    owner_id: uuid.UUID
    question_bank_id: uuid.UUID | None
    question_bank_name: str | None
    tags: list[TagResponse]
    knowledge_points: list[KnowledgePointResponse]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_question(cls, question: Any) -> "QuestionResponse":
        return cls(
            id=question.id,
            type=question.type,
            title=question.title,
            content=question.content,
            options=question.options,
            answer=question.answer,
            analysis=question.analysis,
            difficulty=question.difficulty,
            score=question.score,
            usage_count=question.usage_count,
            created_by=question.created_by,
            created_by_name=question.creator.full_name,
            owner_id=question.owner_id,
            question_bank_id=question.question_bank_id,
            question_bank_name=question.question_bank.name if question.question_bank else None,
            tags=[TagResponse.model_validate(t) for t in question.tags],
            knowledge_points=[KnowledgePointResponse.model_validate(kp) for kp in question.knowledge_points],
            created_at=question.created_at,
            updated_at=question.updated_at,
        )


class ImportedQuestionDraft(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    type: QuestionType
    content_text: str = Field(max_length=4000)
    options: dict[str, str] | None = None
    answer_text: str | None = None


class QuestionImportAnalyzeRequest(BaseModel):
    question: ImportedQuestionDraft


class QuestionImportAnalyzeResponse(BaseModel):
    analysis: str
    difficulty: int = Field(ge=1, le=5)
    difficulty_reason: str


class QuestionImportRecognizeRequest(BaseModel):
    raw_text: str = Field(max_length=4000)


class QuestionImportRecognizeResponse(BaseModel):
    type: QuestionType
    content_text: str
    options: dict[str, str] | None = None
    answer_text: str | None = None


class ImportRecognitionMode(str, Enum):
    TEMPLATE = "template"
    SMART = "smart"


class QuestionImportAnalysisMode(str, Enum):
    FAST = "fast"
    AI_FULL = "ai_full"


class ImportConfidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ImportReviewStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    SKIPPED = "skipped"


class QuestionImportImageInput(BaseModel):
    image_id: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=2048)
    order: int = Field(ge=0)
    page: int | None = Field(default=None, ge=1)
    alt: str | None = Field(default=None, max_length=255)


class QuestionImportDraft(BaseModel):
    draft_id: str
    raw_text: str
    title: str
    type: QuestionType
    content_text: str
    options: dict[str, str] | None = None
    answer_text: str | None = None
    analysis: str | None = None
    difficulty: int = Field(default=3, ge=1, le=5)
    segment_source: str
    type_confidence: ImportConfidence
    boundary_confidence: ImportConfidence
    issues: list[str] = Field(default_factory=list)
    images: list[QuestionImportImageInput] = Field(default_factory=list)
    comparison_flags: list[str] = Field(default_factory=list)
    review_status: ImportReviewStatus = ImportReviewStatus.PENDING
    review_required: bool = True


class QuestionImportDocumentSummary(BaseModel):
    total: int
    duplicates_removed: int = 0
    high_confidence: int
    medium_confidence: int
    low_confidence: int
    issue_count: int
    pending_review: int
    approved: int
    skipped: int


class QuestionImportDocumentRecognizeRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    raw_text: str = Field(min_length=1, max_length=200000)
    source_format: str = Field(pattern="^(pdf|docx|md)$")
    prefer_template: bool = False
    analysis_mode: QuestionImportAnalysisMode = QuestionImportAnalysisMode.FAST
    images: list[QuestionImportImageInput] = Field(default_factory=list, max_length=200)


class QuestionImportDocumentRecognizeResponse(BaseModel):
    mode: ImportRecognitionMode
    summary: QuestionImportDocumentSummary
    drafts: list[QuestionImportDraft]


class QuestionBulkCreateRequest(BaseModel):
    questions: list[QuestionCreate] = Field(min_length=1, max_length=2000)


class QuestionBulkCreateResponse(BaseModel):
    created: int


class QuestionImportMatchCreateRequest(BaseModel):
    question: QuestionCreate
    course_id: uuid.UUID


class QuestionImportMatchCreateResponse(BaseModel):
    question_id: uuid.UUID
    matched_knowledge_point_ids: list[uuid.UUID]
    matched_knowledge_point_names: list[str]

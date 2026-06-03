"""Pydantic schemas for Question, Tag, and KnowledgePoint."""

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.common.data_visibility import VisibilityScope
from app.questions.models import QuestionImportJobStatus, QuestionType, TagType


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
    owner_username: str | None = None
    owner_full_name: str | None = None
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

    @model_validator(mode="after")
    def require_code_answer(self) -> "QuestionCreate":
        if self.type == QuestionType.CODE:
            answer_text = ""
            if isinstance(self.answer, dict):
                raw_answer = self.answer.get("text") or self.answer.get("correct")
                answer_text = str(raw_answer).strip() if raw_answer is not None else ""
                if not answer_text and self.answer.get("code") is not None:
                    answer_text = str(self.answer.get("code")).strip()
            if not answer_text:
                raise ValueError("代码题必须填写参考答案")
            if isinstance(self.answer, dict) and not self.answer.get("code"):
                self.answer = {**self.answer, "code": answer_text}
        return self


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


class QuestionEditLockInfo(BaseModel):
    in_use: bool
    allowed_fields: list[str] = Field(default_factory=list)
    regrade_on_fields: list[str] = Field(default_factory=list)
    has_submitted_attempts: bool = False


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
    edit_lock: QuestionEditLockInfo | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_question(
        cls,
        question: Any,
        *,
        edit_lock: QuestionEditLockInfo | None = None,
    ) -> "QuestionResponse":
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
            edit_lock=edit_lock,
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
    VISUAL = "visual"


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


class QuestionImportTableInput(BaseModel):
    order: int = Field(ge=0)
    rows: list[list[str]] = Field(default_factory=list, max_length=100)


class KnowledgePointSuggestion(BaseModel):
    id: uuid.UUID
    name: str


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
    doubt: bool = False
    doubt_reason: str | None = None
    suggested_knowledge_points: list[KnowledgePointSuggestion] = Field(default_factory=list)


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
    incomplete_choice_count: int = 0
    visual_retry_recommended: bool = False


class QuestionImportDocumentRecognizeRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    raw_text: str = Field(min_length=1, max_length=1000000)
    source_format: str = Field(pattern="^(pdf|docx|md|json|zip)$")
    prefer_template: bool = False
    analysis_mode: QuestionImportAnalysisMode = QuestionImportAnalysisMode.FAST
    images: list[QuestionImportImageInput] = Field(default_factory=list)
    tables: list[QuestionImportTableInput] = Field(default_factory=list)
    import_context: str | None = Field(default=None, max_length=50)
    recognition_prompt: str | None = Field(default=None, max_length=2000)


class QuestionImportDocumentRecognizeResponse(BaseModel):
    mode: ImportRecognitionMode
    summary: QuestionImportDocumentSummary
    drafts: list[QuestionImportDraft]


class QuestionBulkCreateRequest(BaseModel):
    questions: list[QuestionCreate] = Field(min_length=1, max_length=5000)


class SaveGeneratedToCourseBankRequest(BaseModel):
    questions: list[QuestionCreate] = Field(min_length=1, max_length=5000)
    source_material_id: uuid.UUID | None = None


class QuestionBulkCreateResponse(BaseModel):
    created: int
    existing: int = 0
    failed: int = 0


class SaveGeneratedToCourseBankResponse(QuestionBulkCreateResponse):
    created_question_ids: list[str] = Field(default_factory=list)


class QuestionImportBulkCreateJobRequest(BaseModel):
    questions: list[QuestionCreate] = Field(min_length=1, max_length=5000)
    root_knowledge_point_id: uuid.UUID | None = None
    course_id: uuid.UUID | None = Field(default=None, deprecated=True)

    @model_validator(mode="after")
    def normalize_root_knowledge_point_id(self) -> "QuestionImportBulkCreateJobRequest":
        if self.root_knowledge_point_id is None:
            self.root_knowledge_point_id = self.course_id
        if self.root_knowledge_point_id is None:
            raise ValueError("root_knowledge_point_id is required")
        return self


class QuestionImportBulkCreateJobResponse(BaseModel):
    job_id: uuid.UUID
    created: int
    existing: int = 0
    failed: int = 0
    status: QuestionImportJobStatus


class QuestionImportJobResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    user_id: uuid.UUID
    status: QuestionImportJobStatus
    total_count: int
    processed_count: int
    matched_count: int
    unmatched_count: int
    failed_count: int
    created_question_ids: list[str] = Field(default_factory=list)
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class QuestionBulkDeleteRequest(BaseModel):
    question_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class QuestionBulkDeleteResponse(BaseModel):
    deleted: int


class QuestionBulkMoveRequest(BaseModel):
    question_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    question_bank_id: uuid.UUID | None = None


class QuestionBulkMoveResponse(BaseModel):
    moved: int


class QuestionBankClearResponse(BaseModel):
    deleted: int
    hard_deleted: int
    soft_deleted: int


class QuestionImportMatchCreateRequest(BaseModel):
    question: QuestionCreate
    root_knowledge_point_id: uuid.UUID | None = None
    course_id: uuid.UUID | None = Field(default=None, deprecated=True)

    @model_validator(mode="after")
    def normalize_root_knowledge_point_id(self) -> "QuestionImportMatchCreateRequest":
        if self.root_knowledge_point_id is None:
            self.root_knowledge_point_id = self.course_id
        if self.root_knowledge_point_id is None:
            raise ValueError("root_knowledge_point_id is required")
        return self


class QuestionImportMatchCreateResponse(BaseModel):
    question_id: uuid.UUID
    matched_knowledge_point_ids: list[uuid.UUID]
    matched_knowledge_point_names: list[str]


# --- Import Enhancement ---


class EnhanceDraftInput(BaseModel):
    draft_id: str
    type: QuestionType
    content_text: str
    options: dict[str, str] | None = None
    answer_text: str | None = None
    analysis: str | None = None


class QuestionImportEnhanceDraftsRequest(BaseModel):
    drafts: list[EnhanceDraftInput] = Field(min_length=1, max_length=500)
    root_knowledge_point_id: uuid.UUID


class EnhancedDraft(BaseModel):
    draft_id: str
    answer_text: str | None = None
    analysis: str | None = None
    doubt: bool = False
    doubt_reason: str | None = None
    suggested_knowledge_points: list[KnowledgePointSuggestion] = Field(default_factory=list)

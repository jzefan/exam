"""Pydantic schemas for Question, Tag, and KnowledgePoint."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

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


class QuestionBulkCreateRequest(BaseModel):
    questions: list[QuestionCreate] = Field(min_length=1, max_length=200)


class QuestionBulkCreateResponse(BaseModel):
    created: int

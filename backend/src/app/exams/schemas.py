"""Pydantic schemas for Exam, Position, ExamQuestion, ExamStudent."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ExamStatus = Literal["draft", "upcoming", "ongoing", "completed", "closed"]
ExamQuestionMode = Literal["manual", "auto", "ai"]


# ── Position ──


class PositionCreate(BaseModel):
    name: str = Field(max_length=100)


class PositionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    is_system: bool
    created_by: uuid.UUID
    created_at: datetime


# ── Exam Question ──


class ExamQuestionItem(BaseModel):
    question_id: uuid.UUID
    order: int = 0
    score_override: float | None = None


class ExamQuestionResponse(BaseModel):
    model_config = {"from_attributes": True}

    question_id: uuid.UUID
    order: int
    score_override: float | None
    # Flattened question info
    question_title: str | None = None
    question_type: str | None = None
    question_score: float | None = None
    question_difficulty: int | None = None


# ── Exam Student ──


class ExamStudentResponse(BaseModel):
    model_config = {"from_attributes": True}

    student_id: uuid.UUID
    full_name: str | None = None
    username: str | None = None
    started_at: datetime | None = None
    submitted_at: datetime | None = None
    grading_status: str | None = None


# ── Exam ──


class ExamCreate(BaseModel):
    title: str = Field(max_length=200)
    description: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int = Field(default=60, gt=0)
    total_score: float = Field(default=100.0, gt=0)
    status: ExamStatus = "draft"
    position_id: uuid.UUID | None = None
    max_switch_count: int = Field(default=0, ge=0)
    show_result: bool = False
    notes_template: str | None = None
    question_mode: ExamQuestionMode | None = None
    question_ids: list[uuid.UUID] = Field(default_factory=list)
    question_items: list[ExamQuestionItem] = Field(default_factory=list)
    student_ids: list[uuid.UUID] = Field(default_factory=list)


class ExamUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    description: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0)
    total_score: float | None = Field(default=None, gt=0)
    status: ExamStatus | None = None
    position_id: uuid.UUID | None = None
    max_switch_count: int | None = Field(default=None, ge=0)
    show_result: bool | None = None
    notes_template: str | None = None
    question_mode: ExamQuestionMode | None = None
    question_ids: list[uuid.UUID] | None = None
    question_items: list[ExamQuestionItem] | None = None
    student_ids: list[uuid.UUID] | None = None


class ExamResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    title: str
    description: str | None
    start_time: datetime | None
    end_time: datetime | None
    duration_minutes: int
    total_score: float
    status: ExamStatus
    position_id: uuid.UUID | None
    position_name: str | None = None
    max_switch_count: int
    show_result: bool
    notes_template: str | None
    question_mode: ExamQuestionMode | None = None
    total_questions: int = 0
    total_students: int = 0
    submitted_count: int = 0
    participated: bool | None = None
    started_at: datetime | None = None
    submitted_at: datetime | None = None
    grading_status: str | None = None
    objective_score: float | None = None
    subjective_score: float | None = None
    score: float | None = None
    ai_scored_at: datetime | None = None
    reviewed_at: datetime | None = None
    owner_id: uuid.UUID
    created_by: uuid.UUID
    created_by_name: str = ""
    created_at: datetime
    updated_at: datetime


class ExamDetailResponse(ExamResponse):
    """Extended response with questions and students lists."""

    questions: list[ExamQuestionResponse] = Field(default_factory=list)
    students: list[ExamStudentResponse] = Field(default_factory=list)


# ── Exam Analysis ──


class AnalysisOverall(BaseModel):
    total_students: int
    submitted_count: int
    graded_count: int
    average_score: float | None = None
    median_score: float | None = None
    highest_score: float | None = None
    lowest_score: float | None = None
    pass_count: int = 0
    pass_rate: float | None = None
    total_score: float


class ScoreBucket(BaseModel):
    label: str
    min_percent: float
    max_percent: float
    count: int


class StudentResultRow(BaseModel):
    student_id: uuid.UUID
    full_name: str | None = None
    username: str | None = None
    submitted_at: datetime | None = None
    grading_status: str | None = None
    objective_score: float | None = None
    subjective_score: float | None = None
    score: float | None = None
    percent: float | None = None


class QuestionStatRow(BaseModel):
    question_id: uuid.UUID
    order: int
    title: str | None = None
    type: str | None = None
    max_score: float
    attempt_count: int
    correct_count: int
    correct_rate: float | None = None
    average_score: float | None = None


class KnowledgePointStatRow(BaseModel):
    knowledge_point_id: uuid.UUID
    name: str
    question_count: int
    average_correct_rate: float | None = None


class ExamAnalysisResponse(BaseModel):
    exam_id: uuid.UUID
    title: str
    overall: AnalysisOverall
    score_distribution: list[ScoreBucket] = Field(default_factory=list)
    students: list[StudentResultRow] = Field(default_factory=list)
    questions: list[QuestionStatRow] = Field(default_factory=list)
    knowledge_points: list[KnowledgePointStatRow] = Field(default_factory=list)

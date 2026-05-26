import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RegradingAssigneeResponse(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    roles: list[str] = Field(default_factory=list)
    exam_count: int = 0
    practice_count: int = 0


class RegradingExamResponse(BaseModel):
    id: uuid.UUID
    title: str
    kind: Literal["exam", "practice"]
    status: str
    total_questions: int = 0
    submitted_count: int = 0
    start_time: datetime | None = None
    end_time: datetime | None = None


class RegradingQuestionResponse(BaseModel):
    question_id: uuid.UUID
    order: int
    type: Literal["fill_in", "short_answer"]
    title: str
    content_preview: str
    score: float
    submitted_count: int = 0


class RegradingRunResponse(BaseModel):
    exam_id: uuid.UUID
    question_id: uuid.UUID
    question_type: Literal["fill_in", "short_answer"]
    affected_submissions: int = 0
    updated_latest_answers: int = 0
    created_grading_tasks: int = 0

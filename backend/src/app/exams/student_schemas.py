import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

class StudentAnswerItem(BaseModel):
    question_id: uuid.UUID
    answer_content: dict[str, Any] = Field(default_factory=dict)


class SaveAnswersRequest(BaseModel):
    answers: list[StudentAnswerItem] = Field(default_factory=list)


class SubmitExamRequest(BaseModel):
    answers: list[StudentAnswerItem] = Field(default_factory=list)


class SubmitExamResponse(BaseModel):
    submitted: bool
    score: float | None = None
    grading_status: str


class SwitchReportRequest(BaseModel):
    switch_count: int = Field(ge=0)


class StudentQuestionPayload(BaseModel):
    question_id: uuid.UUID
    order: int
    score: float
    type: str
    title: str
    content: dict[str, Any]
    options: dict[str, Any] | None = None


class StudentExamStartResponse(BaseModel):
    exam_id: uuid.UUID
    title: str
    duration_minutes: int
    max_switch_count: int
    started_at: datetime
    end_time: datetime | None = None
    questions: list[StudentQuestionPayload] = Field(default_factory=list)
    saved_answers: dict[str, dict[str, Any]] = Field(default_factory=dict)
    switch_count: int = 0


class StudentExamResultQuestionResponse(BaseModel):
    question_id: uuid.UUID
    order: int
    type: str
    title: str
    content: dict[str, Any]
    options: dict[str, Any] | None = None
    total_score: float
    score_awarded: float
    is_correct: bool
    answer_content: dict[str, Any] = Field(default_factory=dict)
    standard_answer: dict[str, Any] = Field(default_factory=dict)
    analysis: str | None = None
    feedback: dict[str, Any] = Field(default_factory=dict)
    appeal_status: str | None = None
    appeal_reason: str | None = None
    appeal_reply: str | None = None


class StudentExamResultResponse(BaseModel):
    exam_id: uuid.UUID
    title: str
    submitted_at: datetime | None = None
    total_score: float
    score: float | None = None
    grading_status: str | None = None
    can_view: bool
    blocked_reason: str | None = None
    questions: list[StudentExamResultQuestionResponse] = Field(default_factory=list)


class WrongAnswerListItem(BaseModel):
    id: uuid.UUID
    question_id: uuid.UUID
    question_title: str
    question_type: str
    exam_title: str
    wrong_count: int
    last_wrong_at: datetime
    tags: list[str] = Field(default_factory=list)
    mastered: bool = False


class WrongAnswerDetailResponse(WrongAnswerListItem):
    question_content: dict[str, Any]
    standard_answer: dict[str, Any]
    analysis: str | None = None
    student_answer: dict[str, Any] = Field(default_factory=dict)
    feedback: dict[str, Any] = Field(default_factory=dict)


class AppealCreateRequest(BaseModel):
    question_id: uuid.UUID
    reason: str = Field(min_length=3)


class AppealResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    exam_id: uuid.UUID
    question_id: uuid.UUID
    status: str
    reason: str
    teacher_reply: str | None = None
    created_at: datetime
    updated_at: datetime


class StudentNotificationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    type: str
    title: str
    content: str
    related_exam_id: uuid.UUID | None = None
    read_at: datetime | None = None
    created_at: datetime

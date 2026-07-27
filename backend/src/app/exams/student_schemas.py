import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from app.code_runner.schemas import CodeRunCaseResult, CodeRunMode, CodeRunRequest, CodeRunResult

class StudentAnswerItem(BaseModel):
    question_id: uuid.UUID
    answer_content: dict[str, Any] = Field(default_factory=dict)


class SaveAnswersRequest(BaseModel):
    answers: list[StudentAnswerItem] = Field(default_factory=list)


class StartExamRequest(BaseModel):
    retake: bool = False


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
    category: str = "exam"
    duration_minutes: int
    max_switch_count: int
    allow_retake: bool = False
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
    grading_pending: bool = False
    grading_failed: bool = False
    needs_human_review: bool = False


class SingleQuestionAIGradeResponse(BaseModel):
    """Minimal payload returned from the per-question AI 判题 endpoint.

    Carries only the fields the answer-detail page needs to refresh the row
    in place: the new score, correctness, and updated feedback (including
    `feedback.model_evaluation` from DeepSeek if present).
    """

    question_id: uuid.UUID
    total_score: float
    score_awarded: float
    is_correct: bool
    feedback: dict[str, Any] = Field(default_factory=dict)


class ManualQuestionScoreRequest(BaseModel):
    score_awarded: float = Field(ge=0)


class ManualQuestionScoreResponse(BaseModel):
    question_id: uuid.UUID
    total_score: float
    score_awarded: float
    is_correct: bool
    objective_score: float | None = None
    subjective_score: float | None = None
    exam_score: float | None = None
    grading_status: str | None = None
    feedback: dict[str, Any] = Field(default_factory=dict)


class StudentExamCommentRequest(BaseModel):
    comment: str = Field(default="", max_length=2000)


class StudentExamCommentResponse(BaseModel):
    teacher_comment: str | None = None


class StudentExamResultResponse(BaseModel):
    exam_id: uuid.UUID
    title: str
    submitted_at: datetime | None = None
    total_score: float
    score: float | None = None
    objective_score: float | None = None
    subjective_score: float | None = None
    grading_status: str | None = None
    can_view: bool
    can_retake: bool = False
    show_score: bool = True
    blocked_reason: str | None = None
    teacher_comment: str | None = None
    questions: list[StudentExamResultQuestionResponse] = Field(default_factory=list)


class WrongAnswerListItem(BaseModel):
    id: uuid.UUID
    question_id: uuid.UUID
    question_title: str
    question_type: str
    exam_title: str
    wrong_count: int
    last_wrong_at: datetime
    mastered_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)
    mastered: bool = False


class WrongAnswerDetailResponse(WrongAnswerListItem):
    question_content: dict[str, Any]
    question_options: dict[str, Any] | None = None
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


class StudentCodeRunRequest(CodeRunRequest):
    pass


class StudentCodeRunCaseResponse(CodeRunCaseResult):
    pass


class StudentCodeRunResponse(CodeRunResult):
    cases: list[StudentCodeRunCaseResponse] = Field(default_factory=list)


class AttemptStatusResponse(BaseModel):
    state: str
    submitted_at: datetime | None = None
    latest_submission_id: uuid.UUID | None = None
    switch_count: int
    deadline_at: datetime | None = None


class VisibilityEvent(BaseModel):
    hidden: bool
    at_ms: int = Field(ge=0)


class VisibilityEventsRequest(BaseModel):
    events: list[VisibilityEvent] = Field(default_factory=list)


class VisibilityEventsResponse(BaseModel):
    switch_count: int
    max_switch_count: int

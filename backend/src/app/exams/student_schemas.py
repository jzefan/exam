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


class SelectedTextExplainRequest(BaseModel):
    selected_text: str = Field(min_length=1, max_length=1200)


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
    ai_explanation_enabled: bool = False
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
    exam_id: uuid.UUID | None = None
    exam_title: str
    exam_category: str = "exam"
    wrong_count: int
    last_wrong_at: datetime
    mastered_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)
    mastered: bool = False
    # 该考试/练习下已生成的错题强化练习数量。
    remedial_practice_count: int = 0
    # 这道题在来源考试/练习里的位置（`exam_questions.order`，0 基）；历史错题或题目已从试卷移除时为 None。
    exam_question_order: int | None = None


class WrongAnswerDetailResponse(WrongAnswerListItem):
    question_content: dict[str, Any]
    question_options: dict[str, Any] | None = None
    standard_answer: dict[str, Any]
    analysis: str | None = None
    student_answer: dict[str, Any] = Field(default_factory=dict)
    feedback: dict[str, Any] = Field(default_factory=dict)


class RemedialPracticeGroupItem(BaseModel):
    key: str
    knowledge_point_id: uuid.UUID | None = None
    name: str
    path: str | None = None
    wrong_question_count: int
    suggested_count: int


class RemedialPracticeSummaryItem(BaseModel):
    id: uuid.UUID
    title: str
    question_count: int
    duration_minutes: int
    created_at: datetime
    started_at: datetime | None = None
    submitted_at: datetime | None = None
    score: float | None = None
    total_score: float


class RemedialPracticeAnalysisResponse(BaseModel):
    source_exam_id: uuid.UUID | None = None
    source_title: str
    source_category: str = "exam"
    wrong_question_count: int
    default_total_count: int
    max_total_count: int
    groups: list[RemedialPracticeGroupItem] = Field(default_factory=list)
    practices: list[RemedialPracticeSummaryItem] = Field(default_factory=list)


class RemedialPracticeAllocationItem(BaseModel):
    group_key: str = Field(min_length=1, max_length=80)
    count: int = Field(ge=0, le=50)


class RemedialPracticeCreateRequest(BaseModel):
    source_exam_id: uuid.UUID | None = None
    total_count: int = Field(default=10, ge=1, le=50)
    allocations: list[RemedialPracticeAllocationItem] = Field(default_factory=list)
    difficulty: int = Field(default=3, ge=1, le=5)
    model: str = Field(default="deepseek", max_length=20)


class RemedialPracticeCreateResponse(BaseModel):
    exam_id: uuid.UUID
    title: str
    question_count: int
    requested_count: int
    duration_minutes: int
    total_score: float


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

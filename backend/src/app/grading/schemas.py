"""Pydantic schemas for grading APIs."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GradingTaskCreate(BaseModel):
    source_type: str
    source_business_id: str | None = None
    question_type: str
    question_content: str
    subject: str | None = None
    language: str | None = None
    max_score: int
    knowledge_tags: list = Field(default_factory=list)
    fatal_rule_enabled: bool = True
    student_answer_raw: str
    student_answer_structured: dict | None = None
    ocr_raw_text: str | None = None
    ocr_repaired_text: str | None = None
    attachment_refs: list = Field(default_factory=list)
    standard_answers: list[dict] = Field(default_factory=list)
    rubric_definition: dict = Field(default_factory=dict)
    scoring_points: list[dict] = Field(default_factory=list)
    dimension_weights: dict = Field(default_factory=dict)
    deduction_rules: list[dict] = Field(default_factory=list)
    fatal_error_rules: list[dict] = Field(default_factory=list)
    prompt_template_version: str | None = None
    programming_language: str | None = None
    execution_env: dict | None = None
    test_summary: dict | None = None
    compile_result: dict | None = None
    runtime_result: dict | None = None
    runtime_logs: list[dict] = Field(default_factory=list)
    resource_limit_summary: dict | None = None
    role_binding_version: int


class GradingTaskRead(BaseModel):
    id: str
    status: str
    question_type: str


class GradingTaskListItemRead(BaseModel):
    id: str
    source_type: str
    source_business_id: str | None = None
    status: str
    question_type: str
    question_content: str
    final_score: float | None = None
    result_source: str | None = None
    arbitration_required: bool = False
    manual_override: bool = False
    updated_at: str


class ManualScoreOverride(BaseModel):
    score_total: float
    reason: str


class GradingSnapshotRead(BaseModel):
    id: str
    snapshot_type: str
    score_total: float
    model_label: str | None = None
    provider_key: str | None = None
    dimension_scores: dict = Field(default_factory=dict)
    dimension_comments: dict = Field(default_factory=dict)
    deduction_reasons: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    improvement_suggestions: list[str] = Field(default_factory=list)
    evidence_summary: dict = Field(default_factory=dict)
    risk_flags: list[str] = Field(default_factory=list)


class GradingAuditEventRead(BaseModel):
    id: str
    event_type: str
    event_payload: dict = Field(default_factory=dict)
    operator_type: str
    operator_id: str
    created_at: str


class GradingExecutionEvidenceRead(BaseModel):
    programming_language: str | None = None
    execution_env: dict | None = None
    test_summary: dict | None = None
    compile_result: dict | None = None
    runtime_result: dict | None = None
    runtime_logs: list = Field(default_factory=list)
    resource_limit_summary: dict | None = None


class GradingContextRead(BaseModel):
    source_type: str
    source_business_id: str | None = None
    status: str
    question_type: str
    question_content: str
    subject: str | None = None
    language: str | None = None
    max_score: int
    knowledge_tags: list = Field(default_factory=list)
    fatal_rule_enabled: bool
    student_answer_raw: str
    student_answer_structured: dict | None = None
    ocr_raw_text: str | None = None
    ocr_repaired_text: str | None = None
    attachment_refs: list = Field(default_factory=list)
    standard_answers: list = Field(default_factory=list)
    rubric_definition: dict = Field(default_factory=dict)
    scoring_points: list = Field(default_factory=list)
    dimension_weights: dict = Field(default_factory=dict)
    deduction_rules: list = Field(default_factory=list)
    fatal_error_rules: list = Field(default_factory=list)
    prompt_template_version: str | None = None
    role_binding_version: int
    execution_evidence: GradingExecutionEvidenceRead


class FinalGradingReportRead(BaseModel):
    task_id: str
    status: str
    question_type: str
    final_score: float | None = None
    result_source: str | None = None
    context: GradingContextRead
    snapshots: list[GradingSnapshotRead] = Field(default_factory=list)
    audit_events: list[GradingAuditEventRead] = Field(default_factory=list)


class GradingTaskRunRead(BaseModel):
    status: str
    arbitration_required: bool
    reason: str | None = None


class GradingTaskRunRequest(BaseModel):
    locale: str | None = None


class GradingTaskConfirmRead(BaseModel):
    status: str
    grading_status: str


class GradingTaskViewedRead(BaseModel):
    viewed: bool


class GradingInboxQuestionRead(BaseModel):
    question_key: str
    question_id: str
    question_label: str
    question_type: str
    question_content: str
    max_score: int
    knowledge_tags: list = Field(default_factory=list)
    pending_count: int
    completed_count: int
    candidate_count: int
    latest_updated_at: str


class GradingInboxExamGroupRead(BaseModel):
    exam_id: str | None = None
    exam_label: str
    exam_date: str
    questions: list[GradingInboxQuestionRead] = Field(default_factory=list)


class GradingInboxRead(BaseModel):
    exams: list[GradingInboxExamGroupRead] = Field(default_factory=list)


class GradingExportExamRead(BaseModel):
    exam_id: str
    exam_label: str
    exam_date: str
    question_count: int
    candidate_count: int


class GradingExportExamListRead(BaseModel):
    exams: list[GradingExportExamRead] = Field(default_factory=list)


class GradingInboxCandidateRead(BaseModel):
    task_id: str
    candidate_name: str
    candidate_code: str | None = None
    student_id: str | None = None
    status: str
    score: float | None = None
    arbitration_required: bool = False
    manual_override: bool = False
    viewed: bool = False


class GradingInboxQuestionDetailRead(BaseModel):
    exam_id: str | None = None
    exam_label: str
    exam_date: str
    question_key: str
    question_id: str
    question_label: str
    question_type: str
    question_content: str
    max_score: int
    knowledge_tags: list = Field(default_factory=list)
    candidates: list[GradingInboxCandidateRead] = Field(default_factory=list)


class GradingExportQuestionRead(BaseModel):
    question_id: str
    question_label: str
    question_type: str
    question_type_label: str
    max_score: float


class GradingExportStudentScoreRead(BaseModel):
    candidate_name: str
    candidate_code: str | None = None
    objective_score: float = 0.0
    subjective_score: float = 0.0
    scores: dict[str, float | None] = Field(default_factory=dict)
    type_totals: dict[str, float] = Field(default_factory=dict)
    total_score: float


class GradingExportScoreRead(BaseModel):
    exam_id: str
    exam_label: str
    exam_date: str
    questions: list[GradingExportQuestionRead] = Field(default_factory=list)
    students: list[GradingExportStudentScoreRead] = Field(default_factory=list)


class GradingInboxModelCommentRead(BaseModel):
    stage: str
    model_label: str
    score: float
    summary: str
    process: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)


class GradingFeedbackDimensionRead(BaseModel):
    name: str
    score: float
    max_score: float | None = None
    comment: str = ""


class GradingCandidateFeedbackRead(BaseModel):
    """Consolidated (final-snapshot) structured feedback, mirroring the exam
    result page's ``StudentExamAnswer.feedback`` so the grading center can show
    the same dimension breakdown."""

    dimensions: list[GradingFeedbackDimensionRead] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    deductions: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    evidence_lines: list[str] = Field(default_factory=list)


class GradingScoreReuseRead(BaseModel):
    mode: str
    similarity: float
    source_task_id: str


class GradingInboxCandidateDetailRead(BaseModel):
    task_id: str
    candidate_name: str
    candidate_code: str | None = None
    status: str
    viewed: bool = False
    evaluation_note: str | None = None
    score_reuse: GradingScoreReuseRead | None = None
    suggested_score: float | None = None
    max_score: int
    question_type: str
    student_answer_raw: str
    attachment_refs: list = Field(default_factory=list)
    knowledge_tags: list = Field(default_factory=list)
    student_feedback: str | None = None
    teacher_feedback_reply: str | None = None
    feedback_created_at: str | None = None
    models: list[GradingInboxModelCommentRead] = Field(default_factory=list)
    follow_ups: list[GradingPromptFollowUpHistoryRead] = Field(default_factory=list)
    feedback: GradingCandidateFeedbackRead | None = None


class GradingPromptFollowUpCreate(BaseModel):
    prompt: str
    locale: str | None = None


class GradingPromptFollowUpModelRead(BaseModel):
    stage: str
    model_label: str
    score: float
    summary: str
    process: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)


class GradingPromptFollowUpRead(BaseModel):
    prompt: str
    models: list[GradingPromptFollowUpModelRead] = Field(default_factory=list)


class GradingPromptFollowUpHistoryRead(BaseModel):
    prompt: str
    created_at: str | None = None
    models: list[GradingPromptFollowUpModelRead] = Field(default_factory=list)


class ExamCandidateScoreRead(BaseModel):
    candidate_key: str
    objective_score: float | None = None
    subjective_score: float | None = None
    total_score: float | None = None


class ExamCandidateScoresRead(BaseModel):
    candidates: list[ExamCandidateScoreRead]

"""Pydantic schemas for question-generation templates."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.questions.ai_generate import AIModelProvider


class ManualSeed(BaseModel):
    """A non-bank seed question (imported from a paper, or typed by the teacher).

    Carries the question type so 出题技能 can cover 1~2 samples per type. Legacy
    rows stored plain strings; the before-validator coerces those into ``{text}``
    so old templates keep loading on both input and output.
    """

    model_config = {"extra": "allow"}

    type: str | None = None  # choice / true_false / fill_in / short_answer / essay / code
    text: str = Field(default="", max_length=4000)  # 题干
    options: dict[str, str] | None = None  # 选择题选项 {"A": "...", "B": "..."}
    answer: str | None = Field(default=None, max_length=4000)
    analysis: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_string(cls, value: object) -> object:
        if isinstance(value, str):
            return {"text": value}
        return value


class StudentProfile(BaseModel):
    """Teaching-target profile for a question-gen skill.

    Current fields: teaching_stage (大专/本科/研究生/不限), difficulty_preference,
    teaching_goal (期望学生达到的能力), note. Extra keys are tolerated so legacy
    profiles (knowledge_level / ability_target / weak_points…) keep loading.
    """

    model_config = {"extra": "allow"}

    teaching_stage: str | None = None  # 大专 / 本科 / 研究生 / 不限
    difficulty_preference: str | None = None  # easy / medium / hard
    teaching_goal: str | None = Field(default=None, max_length=2000)
    note: str | None = Field(default=None, max_length=2000)


class GenRules(BaseModel):
    """Generation rules. type_distribution keys use SYSTEM question types."""

    model_config = {"extra": "allow"}

    type_distribution: dict[str, int] = Field(default_factory=dict)
    difficulty_distribution: dict[str, int] = Field(default_factory=dict)
    style_rules: list[str] = Field(default_factory=list)
    avoid_scenarios: list[str] = Field(default_factory=list)
    default_scope_kp_ids: list[uuid.UUID] = Field(default_factory=list)


class TemplateMaterialInput(BaseModel):
    resource_id: uuid.UUID
    resource_title: str | None = Field(default=None, max_length=255)
    content_hash: str | None = Field(default=None, max_length=64)
    text: str = Field(default="", max_length=200000)
    truncated: bool = False


class TemplateMaterialResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    resource_id: uuid.UUID
    resource_title: str | None
    content_hash: str | None
    truncated: bool
    text_length: int = 0
    # Full snapshot text is returned on the single-template detail (for editing),
    # so re-saving a template preserves existing material snapshots.
    text: str = ""


class TemplateCreate(BaseModel):
    course_kp_id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool = False
    student_profile: StudentProfile | None = None
    seed_question_ids: list[uuid.UUID] = Field(default_factory=list)
    manual_seed_questions: list[ManualSeed] = Field(default_factory=list)
    gen_rules: GenRules | None = None
    materials: list[TemplateMaterialInput] = Field(default_factory=list)


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    student_profile: StudentProfile | None = None
    seed_question_ids: list[uuid.UUID] | None = None
    manual_seed_questions: list[ManualSeed] | None = None
    gen_rules: GenRules | None = None
    materials: list[TemplateMaterialInput] | None = None


class TemplateSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    course_kp_id: uuid.UUID
    name: str
    description: str | None
    is_default: bool
    student_profile: dict | None = None
    material_count: int = 0
    seed_count: int = 0
    updated_at: datetime


class TemplateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    course_kp_id: uuid.UUID
    name: str
    description: str | None
    is_default: bool
    student_profile: dict | None
    seed_question_ids: list[uuid.UUID]
    manual_seed_questions: list[ManualSeed]
    gen_rules: dict | None
    materials: list[TemplateMaterialResponse]
    created_at: datetime
    updated_at: datetime


class RunSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    template_id: uuid.UUID | None
    status: str
    generated_count: int
    resolved_snapshot: dict | None
    error_message: str | None
    created_at: datetime


class TemplateGenerateRequest(BaseModel):
    """This-time overrides on top of the template (template values used when omitted)."""

    type_distribution: dict[str, int] | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    knowledge_point_ids: list[uuid.UUID] | None = None
    extra_prompt: str = Field(default="", max_length=2000)
    model: AIModelProvider | None = None


class TemplateChatRequest(BaseModel):
    """Chat-style generation: a free-form instruction drives types/counts/topic."""

    message: str = Field(min_length=1, max_length=2000)
    model: AIModelProvider | None = None


class SeedCompleteRequest(BaseModel):
    """Manual seed input: chosen type + pasted stem -> AI completes answer & analysis."""

    type: str = Field(min_length=1, max_length=32)
    text: str = Field(min_length=1, max_length=4000)


class SeedCompleteResponse(BaseModel):
    answer: str
    analysis: str

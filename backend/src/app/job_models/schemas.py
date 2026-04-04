"""Pydantic schemas for job competency model entities."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProjectStatusEnum = Literal["draft", "generating", "review", "published", "archived"]
SourceTypeEnum = Literal["ai_generated", "manual", "template"]
SkillLevelEnum = Literal["L1", "L2", "L3", "L4", "L5"]
DifficultyEnum = Literal["入门", "初级", "中级", "高级", "困难"]
MatchTypeEnum = Literal["auto", "manual"]
FileTypeEnum = Literal["pdf", "word", "txt", "excel"]


# SkillKnowledgePoint schemas

class SkillKnowledgePointCreate(BaseModel):
    name: str = Field(max_length=200)
    teaching_suggestion: str | None = None
    difficulty: DifficultyEnum | None = None
    sort_order: int = 0


class SkillKnowledgePointUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    teaching_suggestion: str | None = None
    difficulty: DifficultyEnum | None = None
    sort_order: int | None = None


class SkillKnowledgePointResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    skill_id: uuid.UUID
    name: str
    teaching_suggestion: str | None
    difficulty: str | None
    sort_order: int
    created_at: datetime
    updated_at: datetime


# Skill schemas

class SkillCreate(BaseModel):
    name: str = Field(max_length=200)
    level: SkillLevelEnum | None = None
    description: str | None = None
    sort_order: int = 0
    knowledge_points: list[SkillKnowledgePointCreate] = Field(default_factory=list)


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    level: SkillLevelEnum | None = None
    description: str | None = None
    sort_order: int | None = None


class SkillResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    dimension_id: uuid.UUID
    name: str
    level: str | None
    description: str | None
    sort_order: int
    knowledge_points: list[SkillKnowledgePointResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


# Dimension schemas

class DimensionCreate(BaseModel):
    name: str = Field(max_length=200)
    description: str | None = None
    sort_order: int = 0
    skills: list[SkillCreate] = Field(default_factory=list)


class DimensionUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    sort_order: int | None = None


class DimensionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    model_id: uuid.UUID
    name: str
    description: str | None
    sort_order: int
    skills: list[SkillResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


# JobModel schemas

class JobModelCreate(BaseModel):
    job_role: str = Field(max_length=200)
    version_note: str | None = None
    source_type: SourceTypeEnum = "manual"
    dimensions: list[DimensionCreate] = Field(default_factory=list)


class JobModelUpdate(BaseModel):
    job_role: str | None = Field(default=None, max_length=200)
    version_note: str | None = None


class JobModelResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    project_id: uuid.UUID
    job_role: str
    version: int
    version_note: str | None
    is_current: bool
    source_type: str
    dimensions: list[DimensionResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class JobModelSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    project_id: uuid.UUID
    job_role: str
    version: int
    version_note: str | None
    is_current: bool
    source_type: str
    created_at: datetime
    updated_at: datetime


# Project schemas

class ProjectCreate(BaseModel):
    name: str = Field(max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    description: str | None = None
    status: ProjectStatusEnum | None = None


class ProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    industry: str | None
    description: str | None
    org_id: uuid.UUID
    created_by: uuid.UUID | None
    status: str
    created_at: datetime
    updated_at: datetime


# SourceDocument schemas

class SourceDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    project_id: uuid.UUID
    file_name: str
    file_type: str
    uploaded_by: uuid.UUID | None
    created_at: datetime


# Template schemas

class TemplateCreate(BaseModel):
    name: str = Field(max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    template_data: dict


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    template_data: dict | None = None


class TemplateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    industry: str | None
    template_data: dict
    is_system: bool
    usage_count: int
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

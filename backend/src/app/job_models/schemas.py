"""Pydantic schemas for job competency model entities."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ResourceTypeEnum = Literal["video", "document", "link"]
NodeTypeEnum = Literal["dimension", "skill", "kp"]
ResourceSourceEnum = Literal["manual", "bilibili", "upload"]
SourceTypeEnum = Literal["ai_generated", "manual", "standard_based", "template"]
SkillLevelEnum = Literal["L1", "L2", "L3", "L4", "L5"]
DifficultyEnum = Literal["入门", "初级", "中级", "高级", "困难"]
MatchTypeEnum = Literal["auto", "manual"]
FileTypeEnum = Literal["pdf", "word", "txt", "excel"]


# SkillKnowledgePoint schemas

class SkillKnowledgePointCreate(BaseModel):
    name: str = Field(max_length=200)
    teaching_suggestion: str | None = None
    difficulty: DifficultyEnum | None = None
    item_source: str = "manual"
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
    item_source: str = "manual"
    sort_order: int
    created_at: datetime
    updated_at: datetime


# Skill schemas

class SkillCreate(BaseModel):
    name: str = Field(max_length=200)
    level: SkillLevelEnum | None = None
    description: str | None = None
    item_source: str = "manual"
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
    item_source: str = "manual"
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
    model_version_id: uuid.UUID
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
    model_type: str = "standard"
    status: str = "draft"
    job_family: str | None = Field(default=None, max_length=100)
    industry_name: str | None = Field(default=None, max_length=100)
    direction_name: str | None = Field(default=None, max_length=100)
    origin_standard_model_id: uuid.UUID | None = None
    dimensions: list[DimensionCreate] = Field(default_factory=list)


class JobModelUpdate(BaseModel):
    job_role: str | None = Field(default=None, max_length=200)
    version_note: str | None = None


class JobModelVersionSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_model_id: uuid.UUID
    version: int
    version_note: str | None
    is_current: bool
    source_type: str
    created_by: uuid.UUID | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


class JobModelVersionResponse(JobModelVersionSummary):
    raw_content: dict | None
    dimensions: list[DimensionResponse] = Field(default_factory=list)


class JobModelVersionListItem(JobModelVersionSummary):
    created_by_name: str | None = None


class JobModelResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    current_version_id: uuid.UUID | None
    job_role: str
    model_type: str
    status: str
    job_family: str | None
    industry_code: str | None
    industry_name: str | None
    direction_code: str | None
    direction_name: str | None
    origin_standard_model_id: uuid.UUID | None
    org_id: uuid.UUID
    created_by: uuid.UUID | None
    current_version: JobModelVersionResponse | None = None
    created_at: datetime
    updated_at: datetime


class JobModelSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    current_version_id: uuid.UUID | None
    job_role: str
    model_type: str
    status: str
    job_family: str | None
    industry_code: str | None
    industry_name: str | None
    direction_code: str | None
    direction_name: str | None
    origin_standard_model_id: uuid.UUID | None
    org_id: uuid.UUID
    created_by: uuid.UUID | None
    current_version: JobModelVersionSummary | None = None
    created_at: datetime
    updated_at: datetime


# SourceDocument schemas

class SourceDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_model_id: uuid.UUID
    file_name: str
    file_type: str
    uploaded_by: uuid.UUID | None
    created_at: datetime


# LearningResource schemas

class LearningResourceCreate(BaseModel):
    resource_type: ResourceTypeEnum
    title: str = Field(max_length=500)
    url: str | None = Field(default=None, max_length=2000)
    file_path: str | None = Field(default=None, max_length=1000)
    description: str | None = None
    source: ResourceSourceEnum = "manual"
    sort_order: int = 0


class LearningResourceUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    url: str | None = Field(default=None, max_length=2000)
    description: str | None = None
    sort_order: int | None = None


class LearningResourceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    node_id: uuid.UUID
    node_type: str
    resource_type: str
    title: str
    url: str | None
    file_path: str | None
    description: str | None
    source: str | None
    sort_order: int
    uploaded_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


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

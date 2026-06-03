"""Schemas for stable agent-facing job model APIs."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.job_models.schemas import DimensionCreate


AgentExportFormat = Literal["json", "markdown"]


class AgentKnowledgePoint(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    difficulty: str | None
    teaching_suggestion: str | None
    sort_order: int


class AgentSkill(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    level: str | None
    description: str | None
    sort_order: int
    knowledge_points: list[AgentKnowledgePoint] = Field(default_factory=list)


class AgentDimension(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    description: str | None
    sort_order: int
    skills: list[AgentSkill] = Field(default_factory=list)


class AgentJobModelVersionSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_model_id: uuid.UUID
    version: int
    version_note: str | None
    is_current: bool
    source_type: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AgentJobModelVersionDetail(AgentJobModelVersionSummary):
    dimensions: list[AgentDimension] = Field(default_factory=list)


class AgentJobModelSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    current_version_id: uuid.UUID | None
    job_role: str
    model_type: str
    status: str
    job_family: str | None
    industry_name: str | None
    direction_name: str | None
    current_version: AgentJobModelVersionSummary | None = None
    created_at: datetime
    updated_at: datetime


class AgentJobModelDetail(AgentJobModelSummary):
    current_version: AgentJobModelVersionDetail | None = None


class AgentJobModelSearchResponse(BaseModel):
    items: list[AgentJobModelSummary]
    total: int


class AgentRecommendStandardRequest(BaseModel):
    job_text: str = Field(min_length=4)


class AgentRecommendStandardResponse(BaseModel):
    model: AgentJobModelSummary
    rationale: str
    confidence: float = 0.0
    matched_keywords: list[str] = Field(default_factory=list)


class AgentJobModelDraftCreate(BaseModel):
    job_role: str = Field(max_length=200)
    model_type: str = "standard"
    job_family: str | None = Field(default=None, max_length=100)
    industry_name: str | None = Field(default=None, max_length=100)
    direction_name: str | None = Field(default=None, max_length=100)
    version_note: str | None = None
    dimensions: list[DimensionCreate] = Field(default_factory=list)


class AgentPublishRequest(BaseModel):
    version_note: str | None = None


class AgentStructurePreviewRequest(BaseModel):
    dimensions: list[DimensionCreate] = Field(default_factory=list)


class AgentStructureCounts(BaseModel):
    dimensions: int
    skills: int
    knowledge_points: int


class AgentStructurePreviewResponse(BaseModel):
    current: AgentStructureCounts
    proposed: AgentStructureCounts
    will_write: bool = False

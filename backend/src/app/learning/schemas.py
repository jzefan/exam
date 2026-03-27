"""Pydantic schemas for knowledge management."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MajorCreate(BaseModel):
    name: str = Field(max_length=100)
    description: str | None = None


class MajorResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime


class DirectionCreate(BaseModel):
    major_id: uuid.UUID
    name: str = Field(max_length=100)
    description: str | None = None


class DirectionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    major_id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime


class KnowledgePointCreate(BaseModel):
    direction_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    name: str = Field(max_length=200)
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    difficulty: str | None = Field(None, pattern="^(入门|初级|中级|高级|困难)$")


class KnowledgePointUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    description: str | None = None
    tags: list[str] | None = None
    difficulty: str | None = Field(None, pattern="^(入门|初级|中级|高级|困难)$")


class KnowledgePointDetail(BaseModel):
    """Single node as returned in the flat tree list."""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    description: str | None
    tags: list[str]
    difficulty: str | None
    parent_id: uuid.UUID | None
    direction_id: uuid.UUID | None
    question_count: int = 0


class FlowNode(BaseModel):
    id: str
    type: str = "knowledgeNode"
    position: dict[str, int]
    data: dict


class FlowEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str


class FlowData(BaseModel):
    nodes: list[FlowNode]
    edges: list[FlowEdge]


class PrerequisiteCreate(BaseModel):
    from_id: uuid.UUID


RecommendationModel = Literal["deepseek", "qwen", "kimi"]


class RecommendationGenerateRequest(BaseModel):
    model: RecommendationModel


class RecommendationItem(BaseModel):
    title: str
    description: str
    url: str
    source: str = "bilibili"


class RecommendationGenerateResponse(BaseModel):
    model: RecommendationModel
    items: list[RecommendationItem]

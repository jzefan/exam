"""Schemas for material → knowledge-point extraction (Step 2)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.questions.ai_generate import AIModelProvider


class ExtractKnowledgePointsRequest(BaseModel):
    # Material text is extracted on the client (reusing extract-material-content)
    # and sent here, mirroring the existing material question-generation flow.
    material_text: str = Field(default="", max_length=200000)
    resource_title: str | None = Field(default=None, max_length=255)
    model: AIModelProvider | None = None


class KnowledgePointCandidate(BaseModel):
    name: str
    description: str | None = None


class ExtractKnowledgePointsResponse(BaseModel):
    candidates: list[KnowledgePointCandidate]


class KnowledgeFragmentItem(BaseModel):
    """A typed knowledge fragment tied to a material."""

    type: str = "concept"  # concept / term / formula / code_example / case / workflow / other
    title: str
    content: str = ""


class ExtractKnowledgeFragmentsResponse(BaseModel):
    """Knowledge fragments saved onto the material (not added to the course tree)."""

    fragments: list[KnowledgeFragmentItem]


class BulkCreateKnowledgePointItem(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    parent_id: uuid.UUID | None = None  # defaults to the course root when omitted


class BulkCreateKnowledgePointsRequest(BaseModel):
    items: list[BulkCreateKnowledgePointItem] = Field(default_factory=list)


class CreatedKnowledgePoint(BaseModel):
    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None


class BulkCreateKnowledgePointsResponse(BaseModel):
    created: list[CreatedKnowledgePoint]
    skipped: list[str] = Field(default_factory=list)

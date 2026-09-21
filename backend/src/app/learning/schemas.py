"""Pydantic schemas for knowledge management."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.common.data_visibility import VisibilityScope


class MajorCreate(BaseModel):
    name: str = Field(max_length=100)
    description: str | None = None


class MajorResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    description: str | None
    owner_id: uuid.UUID | None = None
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
    owner_id: uuid.UUID | None = None
    created_at: datetime


class RootKnowledgePointOptionResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    difficulty: str | None = None
    parent_id: uuid.UUID | None = None
    direction_id: uuid.UUID
    direction_name: str
    major_id: uuid.UUID
    major_name: str
    owner_id: uuid.UUID | None = None
    visibility: VisibilityScope = VisibilityScope.PRIVATE
    question_count: int = 0


CourseOptionResponse = RootKnowledgePointOptionResponse


class KnowledgePointCreate(BaseModel):
    direction_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    name: str = Field(max_length=200)
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    difficulty: str | None = Field(None, pattern="^(入门|初级|中级|高级|困难)$")


class KnowledgePointUpdate(BaseModel):
    parent_id: uuid.UUID | None = None
    name: str | None = Field(None, max_length=200)
    description: str | None = None
    tags: list[str] | None = None
    difficulty: str | None = Field(None, pattern="^(入门|初级|中级|高级|困难)$")


class KnowledgePointReorder(BaseModel):
    """把知识点移到 `parent_id` 下，并按 `ordered_ids` 重排同级顺序。

    `parent_id` 为 None 表示移到根层级。一次调用同时覆盖
    「同级上下移动」与「拖到别的目录下成为子目录」两种操作。
    """

    parent_id: uuid.UUID | None = None
    ordered_ids: list[uuid.UUID] = Field(min_length=1)


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
    owner_id: uuid.UUID
    visibility: VisibilityScope
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


class CatalogPhotoRecognizeRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    # A 30-page upload can contain a left crop, a focused right-top crop, and
    # the complete right crop after two-column splitting.
    images: list[str] = Field(min_length=1, max_length=90)
    image_groups: list[list[str]] | None = Field(default=None, max_length=30)


class CatalogPhotoRecognizeResponse(BaseModel):
    paths: list[list[str]]


CatalogWebSource = Literal["publisher_site", "llm"]


class CatalogWebRecognizeCoverRequest(BaseModel):
    image: str = Field(min_length=1)
    file_name: str | None = Field(default=None, max_length=255)


class CatalogWebRecognizeCoverResponse(BaseModel):
    """封面识别出的图书信息；识别不到的字段为空字符串。"""

    title: str = ""
    edition: str = ""
    author: str = ""
    publisher: str = ""


class CatalogWebSearchRequest(BaseModel):
    keyword: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=8, ge=1, le=20)


class CatalogWebCandidate(BaseModel):
    """图书检索候选。`from_attributes` 用于接收数据层传回的 dataclass，避免响应模型校验失败。"""

    model_config = ConfigDict(from_attributes=True)

    title: str
    url: str = ""
    author: str = ""
    publisher: str = ""
    publish_date: str = ""
    edition: str = ""
    price: str = ""
    source: str = "dangdang"


class CatalogWebSearchResponse(BaseModel):
    candidates: list[CatalogWebCandidate] = Field(default_factory=list)


class CatalogWebFetchRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    edition: str | None = Field(default=None, max_length=50)
    author: str | None = Field(default=None, max_length=200)
    publisher: str | None = Field(default=None, max_length=100)


class CatalogWebFetchResponse(BaseModel):
    paths: list[list[str]]
    source: CatalogWebSource
    source_url: str = ""
    publisher_site: str = ""
    notes: str = ""


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

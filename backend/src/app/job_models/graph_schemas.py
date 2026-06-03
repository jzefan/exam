"""Schemas for the job-course graph workspace API."""

import uuid
from typing import Any

from pydantic import BaseModel, Field


class GraphJobCard(BaseModel):
    id: uuid.UUID
    current_version_id: uuid.UUID | None
    job_role: str
    model_type: str
    status: str
    industry_name: str | None = None
    direction_name: str | None = None
    skill_count: int
    version: int | None = None


class GraphSkillSummary(BaseModel):
    id: uuid.UUID
    job_model_id: uuid.UUID
    dimension_name: str
    name: str
    level: str | None = None
    knowledge_point_count: int
    course_mapping_count: int


class GraphSkillKnowledgePoint(BaseModel):
    id: uuid.UUID
    skill_id: uuid.UUID
    name: str
    difficulty: str | None = None


class GraphCourseCard(BaseModel):
    id: uuid.UUID
    name: str
    major_name: str | None = None
    direction_name: str | None = None
    child_knowledge_point_count: int
    mapped_skill_count: int
    resource_count: int


class GraphCourseKnowledgePoint(BaseModel):
    id: uuid.UUID
    course_root_id: uuid.UUID
    parent_id: uuid.UUID | None = None
    name: str
    mapped_skill_knowledge_point_count: int


class GraphLinkedSkill(BaseModel):
    skill_id: uuid.UUID
    skill_name: str
    job_model_id: uuid.UUID
    job_role: str
    dimension_name: str


class GraphSkillCourseMapping(BaseModel):
    id: uuid.UUID
    skill_id: uuid.UUID
    course_root_knowledge_point_id: uuid.UUID
    relation_type: str
    match_type: str
    status: str
    source_type: str = "skill"
    target_type: str = "course"


class SkillCourseMappingCreate(BaseModel):
    skill_id: uuid.UUID
    course_root_knowledge_point_id: uuid.UUID
    relation_type: str = "required"
    match_type: str = "manual"
    status: str = "confirmed"


class GraphLayoutPayload(BaseModel):
    id: uuid.UUID
    scope_type: str
    scope_id: uuid.UUID
    layout_json: dict[str, Any] = Field(default_factory=dict)


class GraphLayoutScope(BaseModel):
    scope_type: str
    scope_id: uuid.UUID


class GraphLayoutSaveRequest(BaseModel):
    layout_json: dict[str, Any] = Field(default_factory=dict)


class GraphOverviewResponse(BaseModel):
    jobs: list[GraphJobCard]
    courses: list[GraphCourseCard]
    skills: list[GraphSkillSummary]
    skill_course_mappings: list[GraphSkillCourseMapping]
    layout_scope: GraphLayoutScope
    layout: GraphLayoutPayload | None = None


class GraphJobFocusResponse(BaseModel):
    job: GraphJobCard
    skills: list[GraphSkillSummary]
    skill_knowledge_points: list[GraphSkillKnowledgePoint]
    skill_course_mappings: list[GraphSkillCourseMapping]


class GraphCourseFocusResponse(BaseModel):
    course: GraphCourseCard
    child_knowledge_points: list[GraphCourseKnowledgePoint]
    linked_skills: list[GraphLinkedSkill]
    skill_course_mappings: list[GraphSkillCourseMapping]

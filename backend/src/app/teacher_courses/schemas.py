"""Schemas for the teacher-facing course workspace.

In this UI, a course is an existing root knowledge point.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.common.data_visibility import VisibilityScope
from app.questions.schemas import QuestionResponse


class CourseSemesterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    start_date: date | None = None
    end_date: date | None = None


class CourseSemesterResponse(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    name: str
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    exam_count: int = 0
    assignment_count: int = 0
    created_at: datetime
    updated_at: datetime


class ExamSemesterArchiveRequest(BaseModel):
    semester_id: uuid.UUID | None = None  # null clears the assignment


class TeacherCourseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class TeacherCourseSummary(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None = None
    major_id: uuid.UUID | None = None
    major_name: str | None = None
    direction_id: uuid.UUID | None = None
    direction_name: str | None = None
    display_path: str
    is_major_direct: bool = False
    owner_id: uuid.UUID | None = None
    visibility: VisibilityScope = VisibilityScope.PRIVATE
    can_write: bool = False
    material_count: int = 0
    exam_count: int = 0
    assignment_count: int = 0
    question_count: int = 0
    pending_count: int = 0
    updated_at: datetime
    deleted_at: datetime | None = None
    is_deleted: bool = False


class TeacherCourseDetail(TeacherCourseSummary):
    tags: list[str] = Field(default_factory=list)
    difficulty: str | None = None


class TeacherCourseMaterial(BaseModel):
    id: uuid.UUID
    node_id: uuid.UUID
    node_name: str | None = None
    resource_type: str
    title: str
    url: str | None = None
    description: str | None = None
    source: str | None = None
    file_path: str | None = None
    created_at: datetime
    updated_at: datetime


class TeacherCourseExamKnowledgePoint(BaseModel):
    id: uuid.UUID
    name: str


class TeacherCourseExam(BaseModel):
    id: uuid.UUID
    category: str
    course_kp_id: uuid.UUID | None = None
    title: str
    description: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    status: str
    total_questions: int = 0
    total_score: float = 0
    total_students: int = 0
    submitted_count: int = 0
    pending_count: int = 0
    has_student_history: bool = False
    knowledge_points: list[TeacherCourseExamKnowledgePoint] = Field(default_factory=list)
    semester_id: uuid.UUID | None = None
    semester_name: str | None = None
    created_at: datetime
    updated_at: datetime


class TeacherCourseQuestion(QuestionResponse):
    pass


class CourseKnowledgeNode(BaseModel):
    """One node of the course knowledge tree. Counts are rolled up over descendants."""

    id: uuid.UUID
    name: str
    question_count: int = 0
    material_count: int = 0
    children: list["CourseKnowledgeNode"] = Field(default_factory=list)

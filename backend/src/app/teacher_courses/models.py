"""Course-level semester models.

A course (root knowledge point) can run across multiple terms. Each
``CourseSemester`` is one of those terms. Exams and practices are bound to
at most one (course, semester) via ``ExamSemesterAssignment``.

Why a join table instead of a column on ``Exam``: adding a nullable column
on the existing ``exams`` table needs an Alembic migration; a new join
table is created automatically by ``Base.metadata.create_all`` on startup.
"""

import uuid
from datetime import date

from sqlalchemy import JSON, Date, ForeignKey, Index, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.data_visibility import OwnerMixin
from app.models import Base, BaseModel, TimestampMixin


class CourseSemester(OwnerMixin, BaseModel):
    __tablename__ = "course_semesters"

    course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    semester_major_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    semester_major_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    class_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Teaching-target profile for this semester; used to prefill question-gen templates.
    student_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_course_semesters_course_id_deleted_at", "course_id", "deleted_at"),
        UniqueConstraint("course_id", "name", "deleted_at", name="uq_course_semester_name"),
    )


class CourseGradeWeight(BaseModel):
    """课程成绩权重配置（课程级，每门课一条）。

    weights 存各计分项的百分比，当前版本支持：章节任务点 / 章节测试 / 作业 / 考试。
    表结构同时由 Alembic 管理，启动时的 ``create_all`` 仅作为开发环境兜底。
    """

    __tablename__ = "course_grade_weights"

    course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id"), nullable=False, unique=True, index=True
    )
    weights: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class CourseStudentGrade(BaseModel):
    """Manual course-grade overrides, grouped by semester context per student."""

    __tablename__ = "course_student_grades"

    course_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    semester_scores: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("course_id", "student_id", name="uq_course_student_grade"),
        Index("ix_course_student_grades_course_id", "course_id"),
        Index("ix_course_student_grades_student_id", "student_id"),
    )


class ExamSemesterAssignment(Base, TimestampMixin):
    """Pin one Exam (or practice) into exactly one (course, semester) bucket."""

    __tablename__ = "exam_semester_assignments"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id"), primary_key=True
    )
    course_semester_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("course_semesters.id"), nullable=False, index=True
    )

    semester: Mapped[CourseSemester] = relationship("CourseSemester", lazy="joined")

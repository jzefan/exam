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

from sqlalchemy import Date, ForeignKey, Index, String, Text, UniqueConstraint, Uuid
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
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    __table_args__ = (
        Index("ix_course_semesters_course_id_deleted_at", "course_id", "deleted_at"),
        UniqueConstraint("course_id", "name", "deleted_at", name="uq_course_semester_name"),
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

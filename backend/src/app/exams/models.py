"""Exam, ExamQuestion, ExamStudent, and Position models."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, BaseModel, TimestampMixin


class ExamStatus(str, enum.Enum):
    DRAFT = "draft"
    UPCOMING = "upcoming"
    ONGOING = "ongoing"
    COMPLETED = "completed"
    CLOSED = "closed"


class Position(BaseModel):
    __tablename__ = "positions"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    creator: Mapped["app.auth.models.User"] = relationship(  # type: ignore[name-defined]
        "User", foreign_keys=[created_by], lazy="joined"
    )

    __table_args__ = (
        UniqueConstraint("name", "created_by", name="uq_position_name_creator"),
    )


class ExamQuestion(Base, TimestampMixin):
    __tablename__ = "exam_questions"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), primary_key=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True
    )
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    score_override: Mapped[float | None] = mapped_column(Float, nullable=True)

    question: Mapped["app.questions.models.Question"] = relationship(  # type: ignore[name-defined]
        "Question", lazy="joined"
    )


class ExamStudent(Base, TimestampMixin):
    __tablename__ = "exam_students"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["app.auth.models.User"] = relationship(  # type: ignore[name-defined]
        "User", foreign_keys=[student_id], lazy="joined"
    )


class Exam(BaseModel):
    __tablename__ = "exams"

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    total_score: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ExamStatus.DRAFT.value
    )
    position_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("positions.id"), nullable=True
    )
    max_switch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    show_result: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)

    creator: Mapped["app.auth.models.User"] = relationship(  # type: ignore[name-defined]
        "User", foreign_keys=[created_by], lazy="joined"
    )
    position: Mapped["Position | None"] = relationship(
        "Position", foreign_keys=[position_id], lazy="joined"
    )
    exam_questions: Mapped[list[ExamQuestion]] = relationship(
        "ExamQuestion", cascade="all, delete-orphan", lazy="selectin"
    )
    exam_students: Mapped[list[ExamStudent]] = relationship(
        "ExamStudent", cascade="all, delete-orphan", lazy="selectin"
    )

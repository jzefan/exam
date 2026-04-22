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
    JSON,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.data_visibility import OwnerMixin
from app.models import Base, BaseModel, TimestampMixin


class ExamStatus(str, enum.Enum):
    DRAFT = "draft"
    UPCOMING = "upcoming"
    ONGOING = "ongoing"
    COMPLETED = "completed"
    CLOSED = "closed"


class AppealStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class GradingStatus(str, enum.Enum):
    PENDING_AI = "pending_ai"
    AI_SCORED = "ai_scored"
    REVIEWED = "reviewed"


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
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    saved_answers: Mapped[dict[str, dict] | None] = mapped_column(JSON, nullable=True, default=dict)
    switch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    submission_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latest_submission_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("student_exam_submissions.id", ondelete="SET NULL"), nullable=True
    )
    grading_status: Mapped[str] = mapped_column(String(20), nullable=False, default=GradingStatus.REVIEWED.value)
    objective_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    subjective_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_scored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["app.auth.models.User"] = relationship(  # type: ignore[name-defined]
        "User", foreign_keys=[student_id], lazy="joined"
    )


class StudentExamSubmission(BaseModel):
    __tablename__ = "student_exam_submissions"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    grading_status: Mapped[str] = mapped_column(String(20), nullable=False, default=GradingStatus.REVIEWED.value)
    objective_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    subjective_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("exam_id", "student_id", "attempt_no", name="uq_student_exam_submission_attempt"),
    )


class StudentExamSubmissionAnswer(BaseModel):
    __tablename__ = "student_exam_submission_answers"

    submission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("student_exam_submissions.id", ondelete="CASCADE"), nullable=False
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    answer_content: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    score_awarded: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    feedback: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("submission_id", "question_id", name="uq_student_exam_submission_answer"),
    )


class StudentExamAnswer(BaseModel):
    __tablename__ = "student_exam_answers"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    answer_content: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    score_awarded: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    feedback: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("exam_id", "student_id", "question_id", name="uq_student_exam_answer"),
    )


class StudentExamAppeal(BaseModel):
    __tablename__ = "student_exam_appeals"

    exam_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=AppealStatus.PENDING.value)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    teacher_reply: Mapped[str | None] = mapped_column(Text, nullable=True)


class StudentQuestionProgress(BaseModel):
    __tablename__ = "student_question_progress"

    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    last_exam_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="SET NULL"), nullable=True
    )
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_wrong_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mastered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mastered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StudentNotification(BaseModel):
    __tablename__ = "student_notifications"

    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    related_exam_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="SET NULL"), nullable=True
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Exam(OwnerMixin, BaseModel):
    __tablename__ = "exams"

    category: Mapped[str] = mapped_column(String(20), nullable=False, default="exam")
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
    allow_retake: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    show_result: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    question_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
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

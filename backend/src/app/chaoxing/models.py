"""Local teacher grading records; deliberately independent of student accounts."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models import BaseModel


class ExternalExam(BaseModel):
    __tablename__ = "chaoxing_grading_exams"
    __table_args__ = (
        UniqueConstraint("owner_id", "account_key", "course_key", "source_exam_id", name="uq_cx_exam_source"),
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    account_key: Mapped[str] = mapped_column(String(64))
    course_key: Mapped[str] = mapped_column(String(255))
    source_exam_id: Mapped[str] = mapped_column(String(128))
    course_title: Mapped[str] = mapped_column(String(300))
    title: Mapped[str] = mapped_column(String(300))
    expected_submitted: Mapped[int | None] = mapped_column(Integer)


class ExternalCandidate(BaseModel):
    __tablename__ = "chaoxing_grading_candidates"
    __table_args__ = (UniqueConstraint("exam_id", "source_candidate_id", name="uq_cx_candidate_source"),)
    exam_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("chaoxing_grading_exams.id"), index=True)
    source_candidate_id: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(200))
    student_no: Mapped[str] = mapped_column(String(100))
    source_score: Mapped[float | None] = mapped_column(Float)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    declared_max_score: Mapped[float | None] = mapped_column(Float)
    completeness_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)


class ExternalItem(BaseModel):
    __tablename__ = "chaoxing_grading_items"
    __table_args__ = (UniqueConstraint("candidate_id", "revision", "question_id", name="uq_cx_item_version"),)
    candidate_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("chaoxing_grading_candidates.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    question_id: Mapped[str] = mapped_column(String(128))
    position: Mapped[int] = mapped_column(Integer)
    question_type: Mapped[str] = mapped_column(String(100))
    content: Mapped[str] = mapped_column(Text)
    student_answer: Mapped[str] = mapped_column(Text)
    reference_answer: Mapped[str] = mapped_column(Text)
    max_score: Mapped[float | None] = mapped_column(Float)
    objective: Mapped[bool] = mapped_column(Boolean)
    requires_manual_review: Mapped[bool] = mapped_column(Boolean)
    source_score: Mapped[float | None] = mapped_column(Float)
    task_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("grading_tasks.id"), unique=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    ai_score: Mapped[float | None] = mapped_column(Float)
    confirmed_score: Mapped[float | None] = mapped_column(Float)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id"))
    comment: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(String(300), default="")


class ExternalAudit(BaseModel):
    __tablename__ = "chaoxing_grading_audits"
    candidate_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("chaoxing_grading_candidates.id"), index=True)
    item_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("chaoxing_grading_items.id"))
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(50))
    details: Mapped[dict] = mapped_column(JSON, default=dict)

"""Question, Tag, and KnowledgePoint models."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Enum, Float, ForeignKey, Index, Integer, String, Table, Text, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.data_visibility import OwnerMixin, VisibilityMixin
from app.models import Base, BaseModel, TimestampMixin


class QuestionType(str, enum.Enum):
    CHOICE = "choice"
    TRUE_FALSE = "true_false"
    FILL_IN = "fill_in"
    SHORT_ANSWER = "short_answer"
    ESSAY = "essay"
    CODE = "code"


class TagType(str, enum.Enum):
    KNOWLEDGE = "knowledge"
    SUBJECT = "subject"
    PURPOSE = "purpose"
    CUSTOM = "custom"


class QuestionImportJobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL_FAILED = "partial_failed"


# Association tables
question_tags = Table(
    "question_tags",
    Base.metadata,
    Column("question_id", Uuid, ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Uuid, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)

question_knowledge_points = Table(
    "question_knowledge_points",
    Base.metadata,
    Column("question_id", Uuid, ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True),
    Column("knowledge_point_id", Uuid, ForeignKey("knowledge_points.id", ondelete="CASCADE"), primary_key=True),
    Column("weight", Float, default=1.0),
)

class Tag(BaseModel):
    __tablename__ = "tags"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    type: Mapped[TagType] = mapped_column(Enum(TagType), nullable=False)

    questions: Mapped[list["Question"]] = relationship(secondary=question_tags, back_populates="tags")


# KnowledgePoint has moved to app.learning.models — re-export for backward compatibility
from app.learning.models import KnowledgePoint as KnowledgePoint  # noqa: E402,F401


class QuestionBank(OwnerMixin, VisibilityMixin, BaseModel):
    __tablename__ = "question_banks"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    questions: Mapped[list["Question"]] = relationship(back_populates="question_bank")


class Question(OwnerMixin, BaseModel):
    __tablename__ = "questions"

    json_field = JSON().with_variant(JSONB, "postgresql")

    type: Mapped[QuestionType] = mapped_column(Enum(QuestionType), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    content: Mapped[dict] = mapped_column(json_field, nullable=False)
    options: Mapped[dict | None] = mapped_column(json_field, nullable=True)
    answer: Mapped[dict] = mapped_column(json_field, nullable=False)
    analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[float] = mapped_column(Float, default=10.0, nullable=False)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    question_bank_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("question_banks.id"), nullable=True)

    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])  # type: ignore[name-defined]
    question_bank: Mapped["QuestionBank | None"] = relationship(back_populates="questions")
    tags: Mapped[list[Tag]] = relationship(secondary=question_tags, back_populates="questions", lazy="selectin")
    knowledge_points: Mapped[list[KnowledgePoint]] = relationship(
        secondary=question_knowledge_points, back_populates="questions", lazy="selectin"
    )

    __table_args__ = (
        Index("ix_questions_owner_id_deleted_at", "owner_id", "deleted_at"),
        Index("ix_questions_question_bank_id_deleted_at", "question_bank_id", "deleted_at"),
    )


class UserKnowledgePointUsage(BaseModel):
    __tablename__ = "user_knowledge_point_usage"
    __table_args__ = (UniqueConstraint("user_id", "knowledge_point_id", name="uq_user_kp_usage_user_kp"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    knowledge_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False
    )
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    user: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
    knowledge_point: Mapped[KnowledgePoint] = relationship("KnowledgePoint")


class QuestionImportJob(Base, TimestampMixin):
    __tablename__ = "question_import_jobs"

    json_field = JSON().with_variant(JSONB, "postgresql")

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[QuestionImportJobStatus] = mapped_column(
        Enum(QuestionImportJobStatus, name="questionimportjobstatus", create_type=False),
        nullable=False,
        default=QuestionImportJobStatus.PENDING,
    )
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    matched_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unmatched_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_question_ids: Mapped[list[str]] = mapped_column(json_field, nullable=False, default=list)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

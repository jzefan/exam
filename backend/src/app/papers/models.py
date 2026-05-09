"""Reusable paper asset models."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, JSON, String, Text, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.data_visibility import OwnerMixin
from app.models import Base, BaseModel, TimestampMixin


class PaperSourceType(str, enum.Enum):
    MANUAL = "manual"
    IMPORT = "import"
    AI_GENERATED = "ai_generated"


class Paper(OwnerMixin, BaseModel):
    __tablename__ = "papers"

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[PaperSourceType] = mapped_column(String(30), nullable=False, default=PaperSourceType.MANUAL.value)
    source_paper_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("papers.id", ondelete="SET NULL"), nullable=True
    )
    root_knowledge_point_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id", ondelete="SET NULL"), nullable=True
    )
    is_reusable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)

    creator: Mapped["app.auth.models.User"] = relationship("User", foreign_keys=[created_by], lazy="joined")  # type: ignore[name-defined]
    root_knowledge_point: Mapped["app.learning.models.KnowledgePoint | None"] = relationship("KnowledgePoint", lazy="joined")  # type: ignore[name-defined]
    source_paper: Mapped["Paper | None"] = relationship("Paper", remote_side="Paper.id", lazy="joined")
    paper_questions: Mapped[list["PaperQuestion"]] = relationship(
        "PaperQuestion", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        Index("ix_papers_owner_deleted_created", "owner_id", "deleted_at", "created_at"),
        Index("ix_papers_source_type", "source_type"),
        Index("ix_papers_root_knowledge_point_id", "root_knowledge_point_id"),
    )


class PaperQuestion(Base, TimestampMixin):
    __tablename__ = "paper_questions"

    paper_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="RESTRICT"), primary_key=True
    )
    order: Mapped[int] = mapped_column(nullable=False, default=0)
    score_override: Mapped[float | None] = mapped_column(Float, nullable=True)

    question: Mapped["app.questions.models.Question"] = relationship("Question", lazy="joined")  # type: ignore[name-defined]

    __table_args__ = (
        UniqueConstraint("paper_id", "order", name="uq_paper_questions_paper_order"),
        Index("ix_paper_questions_question_id", "question_id"),
    )


class PaperImportSession(BaseModel):
    __tablename__ = "paper_import_sessions"

    json_field = JSON().with_variant(JSONB, "postgresql")

    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_format: Mapped[str] = mapped_column(String(20), nullable=False)
    root_knowledge_point_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id", ondelete="SET NULL"), nullable=True
    )
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_payload: Mapped[dict] = mapped_column(json_field, nullable=False, default=dict)
    created_paper_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("papers.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)

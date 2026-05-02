"""Exam invitations for external candidate access."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models import BaseModel


class ExamInvitation(BaseModel):
    __tablename__ = "exam_invitations"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("exam_id", "user_id", name="uq_invitation_exam_user"),
        Index("ix_exam_invitations_token_hash", "token_hash"),
    )


class ExamPublicLink(BaseModel):
    __tablename__ = "exam_public_links"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    __table_args__ = (
        Index("ix_exam_public_links_token_hash", "token_hash"),
    )

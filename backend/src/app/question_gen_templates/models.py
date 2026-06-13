"""ORM models for course question-generation templates."""

from __future__ import annotations

import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.data_visibility import OwnerMixin
from app.models import BaseModel


class QuestionGenTemplate(BaseModel, OwnerMixin):
    """A reusable question-generation recipe scoped to one course (root KP)."""

    __tablename__ = "question_gen_templates"

    # Course identity reuses the root knowledge point (see teacher_courses).
    course_kp_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Teaching-target profile (knowledge level, ability targets, style, avoid…).
    student_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Seed questions: ids referencing the course bank + free-text samples.
    seed_question_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    manual_seed_questions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    # Generation rules: type distribution, difficulty distribution, style rules…
    gen_rules: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    materials: Mapped[list["QuestionGenTemplateMaterial"]] = relationship(
        back_populates="template",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class QuestionGenTemplateMaterial(BaseModel):
    """A text snapshot of one course material, captured when the template is saved."""

    __tablename__ = "question_gen_template_materials"

    template_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("question_gen_templates.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    resource_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # File hash at snapshot time → lets the UI flag "material changed, refresh snapshot".
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    template: Mapped[QuestionGenTemplate] = relationship(back_populates="materials")


class QuestionGenRun(BaseModel, OwnerMixin):
    """Audit record of one generation run (resolved snapshot + outcome)."""

    __tablename__ = "question_gen_runs"

    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("question_gen_templates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    course_kp_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    # Resolved-at-run snapshot: template name, type distribution, difficulty,
    # scope KP ids, prompt/material sizes — small, no full material text.
    resolved_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    generated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

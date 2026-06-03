"""Job competency model SQLAlchemy models."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, BaseModel, TimestampMixin


class JobModel(BaseModel):
    __tablename__ = "job_models"

    job_role: Mapped[str] = mapped_column(String(200), nullable=False)
    model_type: Mapped[str] = mapped_column(String(20), default="standard", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    job_family: Mapped[str | None] = mapped_column(String(100), nullable=True)
    industry_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    industry_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    direction_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    direction_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    origin_standard_model_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("job_models.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # `current_version_id` always points at `job_model_versions.id`.
    # `versions` must stay keyed by `job_model_id` only to avoid drifting joins.
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("job_model_versions.id", ondelete="SET NULL"), nullable=True
    )
    current_version: Mapped["JobModelVersion | None"] = relationship(
        "JobModelVersion",
        foreign_keys=[current_version_id],
        post_update=True,
    )
    versions: Mapped[list["JobModelVersion"]] = relationship(
        "JobModelVersion",
        foreign_keys="JobModelVersion.job_model_id",
        back_populates="job_model",
        cascade="all, delete-orphan",
        order_by="JobModelVersion.version",
    )
    source_documents: Mapped[list["SourceDocument"]] = relationship(
        "SourceDocument",
        back_populates="job_model",
        cascade="all, delete-orphan",
        foreign_keys="SourceDocument.job_model_id",
    )


class JobModelVersion(BaseModel):
    __tablename__ = "job_model_versions"

    job_model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_models.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    version_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    raw_content: Mapped[dict | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    job_model: Mapped[JobModel] = relationship(
        "JobModel", back_populates="versions", foreign_keys=[job_model_id]
    )
    dimensions: Mapped[list["CompetencyDimension"]] = relationship(
        "CompetencyDimension",
        back_populates="model_version",
        cascade="all, delete-orphan",
        order_by="CompetencyDimension.sort_order",
    )
    source_documents: Mapped[list["SourceDocument"]] = relationship(
        "SourceDocument",
        back_populates="job_model_version",
        foreign_keys="SourceDocument.job_model_version_id",
    )


class CompetencyDimension(BaseModel):
    __tablename__ = "competency_dimensions"

    model_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_model_versions.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    model_version: Mapped[JobModelVersion] = relationship(
        "JobModelVersion", back_populates="dimensions"
    )
    skills: Mapped[list["Skill"]] = relationship(
        "Skill",
        back_populates="dimension",
        cascade="all, delete-orphan",
        order_by="Skill.sort_order",
    )


class Skill(BaseModel):
    __tablename__ = "skills"

    dimension_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("competency_dimensions.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_source: Mapped[str] = mapped_column(String(30), default="standard", nullable=False)
    change_type: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    dimension: Mapped[CompetencyDimension] = relationship("CompetencyDimension", back_populates="skills")
    knowledge_points: Mapped[list["SkillKnowledgePoint"]] = relationship(
        "SkillKnowledgePoint",
        back_populates="skill",
        cascade="all, delete-orphan",
        order_by="SkillKnowledgePoint.sort_order",
    )
    course_mappings: Mapped[list["SkillCourseMapping"]] = relationship(
        "SkillCourseMapping",
        back_populates="skill",
        cascade="all, delete-orphan",
    )


class SkillKnowledgePoint(BaseModel):
    __tablename__ = "skill_knowledge_points"

    skill_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    teaching_suggestion: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(10), nullable=True)
    item_source: Mapped[str] = mapped_column(String(30), default="standard", nullable=False)
    change_type: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    skill: Mapped[Skill] = relationship("Skill", back_populates="knowledge_points")
    kp_mappings: Mapped[list["SkillKpMapping"]] = relationship(
        "SkillKpMapping", back_populates="skill_kp", cascade="all, delete-orphan"
    )


class LearningResource(BaseModel):
    """Learning resources (videos, documents, links) attached to any node."""

    __tablename__ = "learning_resources"

    node_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    node_type: Mapped[str] = mapped_column(String(20), nullable=False)  # dimension, skill, kp
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)  # video, document, link
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(50), nullable=True)  # manual, bilibili, upload
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class SkillKpMapping(Base, TimestampMixin):
    __tablename__ = "skill_kp_mappings"

    skill_kp_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("skill_knowledge_points.id", ondelete="CASCADE"), primary_key=True
    )
    knowledge_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id", ondelete="CASCADE"), primary_key=True
    )
    match_type: Mapped[str] = mapped_column(String(10), default="manual", nullable=False)
    relation_type: Mapped[str] = mapped_column(String(20), default="required", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="confirmed", nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)

    skill_kp: Mapped[SkillKnowledgePoint] = relationship(
        "SkillKnowledgePoint", back_populates="kp_mappings"
    )


class SkillCourseMapping(BaseModel):
    """Graph edge connecting a job skill to a root knowledge point course."""

    __tablename__ = "skill_course_mappings"

    skill_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_root_knowledge_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False, index=True
    )
    relation_type: Mapped[str] = mapped_column(String(20), default="required", nullable=False)
    match_type: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="confirmed", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    skill: Mapped[Skill] = relationship("Skill", back_populates="course_mappings")


class JobModelGraphLayout(BaseModel):
    """Shared graph layout persisted for an organization or a job model version."""

    __tablename__ = "job_model_graph_layouts"

    scope_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    scope_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    layout_json: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), default=dict, nullable=False
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class SourceDocument(BaseModel):
    __tablename__ = "source_documents"

    job_model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_models.id", ondelete="CASCADE"), nullable=False
    )
    job_model_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("job_model_versions.id", ondelete="SET NULL"), nullable=True
    )
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    job_model: Mapped[JobModel] = relationship(
        "JobModel",
        back_populates="source_documents",
        foreign_keys=[job_model_id],
    )
    job_model_version: Mapped[JobModelVersion | None] = relationship(
        "JobModelVersion",
        back_populates="source_documents",
        foreign_keys=[job_model_version_id],
    )


class JobModelTemplate(BaseModel):
    __tablename__ = "job_model_templates"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    template_data: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=False
    )
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

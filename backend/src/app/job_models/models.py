"""Job competency model SQLAlchemy models."""

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, JSON, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, BaseModel, TimestampMixin


class JobModelProject(BaseModel):
    __tablename__ = "job_model_projects"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)

    models: Mapped[list["JobModel"]] = relationship(
        "JobModel", back_populates="project", cascade="all, delete-orphan"
    )
    documents: Mapped[list["SourceDocument"]] = relationship(
        "SourceDocument", back_populates="project", cascade="all, delete-orphan"
    )


class JobModel(BaseModel):
    __tablename__ = "job_models"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_model_projects.id", ondelete="CASCADE"), nullable=False
    )
    job_role: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    version_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    raw_content: Mapped[dict | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )

    project: Mapped[JobModelProject] = relationship("JobModelProject", back_populates="models")
    dimensions: Mapped[list["CompetencyDimension"]] = relationship(
        "CompetencyDimension",
        back_populates="model",
        cascade="all, delete-orphan",
        order_by="CompetencyDimension.sort_order",
    )


class CompetencyDimension(BaseModel):
    __tablename__ = "competency_dimensions"

    model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_models.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    model: Mapped[JobModel] = relationship("JobModel", back_populates="dimensions")
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
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    dimension: Mapped[CompetencyDimension] = relationship("CompetencyDimension", back_populates="skills")
    knowledge_points: Mapped[list["SkillKnowledgePoint"]] = relationship(
        "SkillKnowledgePoint",
        back_populates="skill",
        cascade="all, delete-orphan",
        order_by="SkillKnowledgePoint.sort_order",
    )


class SkillKnowledgePoint(BaseModel):
    __tablename__ = "skill_knowledge_points"

    skill_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("skills.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    teaching_suggestion: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(10), nullable=True)
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
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)

    skill_kp: Mapped[SkillKnowledgePoint] = relationship(
        "SkillKnowledgePoint", back_populates="kp_mappings"
    )


class SourceDocument(BaseModel):
    __tablename__ = "source_documents"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_model_projects.id", ondelete="CASCADE"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    project: Mapped[JobModelProject] = relationship("JobModelProject", back_populates="documents")


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

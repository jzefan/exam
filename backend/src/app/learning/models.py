"""Models for knowledge management: Major, Direction, KnowledgePoint, KnowledgePointPrerequisite."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.common.data_visibility import OwnerMixin, VisibilityMixin
from app.models import Base, BaseModel

if TYPE_CHECKING:
    from app.questions.models import Question


json_list = JSON().with_variant(JSONB, "postgresql")


class Major(BaseModel):
    __tablename__ = "major"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    directions: Mapped[list["Direction"]] = relationship(
        back_populates="major", cascade="all, delete-orphan"
    )


class Direction(BaseModel):
    __tablename__ = "direction"

    major_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("major.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    major: Mapped["Major"] = relationship(back_populates="directions")
    knowledge_points: Mapped[list["KnowledgePoint"]] = relationship(back_populates="direction")


class KnowledgePoint(OwnerMixin, VisibilityMixin, BaseModel):
    """Extended knowledge point with direction, tags, and difficulty."""

    __tablename__ = "knowledge_points"
    __table_args__ = (
        CheckConstraint("difficulty IN ('入门','初级','中级','高级','困难')", name="ck_kp_difficulty"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=True
    )
    # 同级排序位；目录树按 (sort_order, created_at) 展示，同值回退到创建时间。
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    direction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("direction.id", ondelete="SET NULL"), nullable=True
    )
    tags: Mapped[list[str]] = mapped_column(json_list, default=list, server_default="[]")
    difficulty: Mapped[str | None] = mapped_column(String(10), nullable=True)

    direction: Mapped["Direction | None"] = relationship(back_populates="knowledge_points")
    parent: Mapped["KnowledgePoint | None"] = relationship(
        remote_side="KnowledgePoint.id", back_populates="children"
    )
    children: Mapped[list["KnowledgePoint"]] = relationship(back_populates="parent")
    questions: Mapped[list["Question"]] = relationship(
        "Question", secondary="question_knowledge_points", back_populates="knowledge_points"
    )
    prerequisites: Mapped[list["KnowledgePointPrerequisite"]] = relationship(
        foreign_keys="KnowledgePointPrerequisite.to_id",
        back_populates="target",
        cascade="all, delete-orphan",
    )


class KnowledgePointPrerequisite(Base):
    """A directed edge: to_id requires from_id first. Lightweight with only an id."""

    __tablename__ = "knowledge_point_prerequisite"
    __table_args__ = (UniqueConstraint("from_id", "to_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    from_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False
    )
    to_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=False
    )

    source: Mapped["KnowledgePoint"] = relationship(foreign_keys=[from_id])
    target: Mapped["KnowledgePoint"] = relationship(
        foreign_keys=[to_id], back_populates="prerequisites"
    )

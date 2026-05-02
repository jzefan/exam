"""RBAC models: Organization, Role, Permission, and association tables."""

import enum
import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, BaseModel, TimestampMixin


class OrgType(str, enum.Enum):
    ENTERPRISE = "enterprise"
    SCHOOL = "school"


class Organization(BaseModel):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Class(BaseModel):
    __tablename__ = "classes"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    organization: Mapped[Organization] = relationship("Organization", foreign_keys=[org_id])
    students: Mapped[list["app.auth.models.User"]] = relationship(
        "User", back_populates="student_class", lazy="selectin", foreign_keys="User.class_id"
    )
    creator: Mapped["app.auth.models.User | None"] = relationship(
        "User", foreign_keys=[created_by], lazy="joined"
    )


class Permission(BaseModel):
    __tablename__ = "permissions"

    resource: Mapped[str] = mapped_column(String(50), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("resource", "action", name="uq_permission_resource_action"),
    )


class Role(BaseModel):
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )

    organization: Mapped["Organization | None"] = relationship(
        "Organization", foreign_keys=[org_id], lazy="joined"
    )
    role_permissions: Mapped[list["RolePermission"]] = relationship(
        "RolePermission", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        UniqueConstraint("name", "org_id", name="uq_role_name_org"),
    )


class RolePermission(Base, TimestampMixin):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )

    permission: Mapped[Permission] = relationship("Permission", lazy="joined")


class UserOrganization(Base, TimestampMixin):
    __tablename__ = "user_organizations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("roles.id", ondelete="RESTRICT"), primary_key=True
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_primary_role: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    organization: Mapped[Organization] = relationship("Organization", lazy="joined")
    role: Mapped[Role] = relationship("Role", lazy="joined")


class TeacherStudent(Base, TimestampMixin):
    __tablename__ = "teacher_students"

    teacher_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )

    teacher: Mapped["app.auth.models.User"] = relationship(
        "User", foreign_keys=[teacher_id], lazy="joined"
    )
    student: Mapped["app.auth.models.User"] = relationship(
        "User", foreign_keys=[student_id], lazy="joined"
    )

    __table_args__ = (
        Index("ix_teacher_students_student_id", "student_id"),
    )

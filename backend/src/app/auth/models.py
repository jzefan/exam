import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import BaseModel


class User(BaseModel):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    student_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True
    )
    owner_teacher_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    user_type: Mapped[str] = mapped_column(String(20), nullable=False, default="internal")
    persona: Mapped[str] = mapped_column(String(20), nullable=False, default="teacher")
    primary_org_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )

    student_class: Mapped["app.rbac.models.Class | None"] = relationship(
        "Class",
        back_populates="students",
        lazy="joined",
        foreign_keys=[class_id],
    )
    owner_teacher: Mapped["User | None"] = relationship("User", remote_side="User.id")

    __table_args__ = (
        Index("ix_users_username_active", "username", unique=True, postgresql_where="deleted_at IS NULL"),
        Index("ix_users_email_active", "email", unique=True, postgresql_where="deleted_at IS NULL"),
        Index("ix_users_phone_active", "phone", unique=True, postgresql_where="deleted_at IS NULL AND phone IS NOT NULL"),
        Index(
            "ix_users_phone_org_external",
            "phone",
            "primary_org_id",
            unique=True,
            postgresql_where="deleted_at IS NULL AND user_type = 'external_guest' AND phone IS NOT NULL",
        ),
    )


class PasswordResetToken(BaseModel):
    __tablename__ = "password_reset_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User")

    __table_args__ = (
        Index("ix_password_reset_tokens_token_hash", "token_hash"),
        Index("ix_password_reset_tokens_user_id", "user_id"),
    )

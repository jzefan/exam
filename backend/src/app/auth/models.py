import uuid
from sqlalchemy import Boolean, ForeignKey, Index, String, Uuid
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
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    student_class: Mapped["app.rbac.models.Class | None"] = relationship(
        "Class", back_populates="students", lazy="joined"
    )

    __table_args__ = (
        Index("ix_users_username_active", "username", unique=True, postgresql_where="deleted_at IS NULL"),
        Index("ix_users_email_active", "email", unique=True, postgresql_where="deleted_at IS NULL"),
        Index("ix_users_phone_active", "phone", unique=True, postgresql_where="deleted_at IS NULL AND phone IS NOT NULL"),
    )

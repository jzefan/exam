"""add teacher student association table

Revision ID: 20260411_teacher_students
Revises: 20260411_teacher_owner
Create Date: 2026-04-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260411_teacher_students"
down_revision = "20260411_teacher_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_students",
        sa.Column("teacher_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("teacher_id", "student_id"),
    )
    op.execute(
        """
        INSERT INTO teacher_students (teacher_id, student_id, created_at, updated_at)
        SELECT owner_teacher_id, id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM users
        WHERE owner_teacher_id IS NOT NULL
        ON CONFLICT (teacher_id, student_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("teacher_students")

"""add class creator ownership

Revision ID: 20260411_class_creator_ownership
Revises: 20260411_teacher_student_association
Create Date: 2026-04-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260411_class_creator_ownership"
down_revision = "20260411_teacher_student_association"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("classes", sa.Column("created_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_classes_created_by_users",
        "classes",
        "users",
        ["created_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE classes c
        SET created_by = links.teacher_id
        FROM (
            SELECT u.class_id, (ARRAY_AGG(ts.teacher_id ORDER BY ts.teacher_id))[1] AS teacher_id
            FROM users u
            JOIN teacher_students ts ON ts.student_id = u.id
            WHERE u.class_id IS NOT NULL
            GROUP BY u.class_id
            HAVING COUNT(DISTINCT ts.teacher_id) = 1
        ) AS links
        WHERE c.id = links.class_id
          AND c.created_by IS NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_classes_created_by_users", "classes", type_="foreignkey")
    op.drop_column("classes", "created_by")

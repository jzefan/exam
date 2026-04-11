"""Add teacher data visibility primitives.

Revision ID: 20260411_teacher_data_visibility_primitives
Revises: ext_grading_task_src_id
Create Date: 2026-04-11 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260411_teacher_data_visibility_primitives"
down_revision: Union[str, None] = "ext_grading_task_src_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


visibility_scope = sa.Enum("private", "platform", name="visibilityscope")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        visibility_scope.create(bind, checkfirst=True)

    op.add_column("question_banks", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_question_banks_owner_id_users",
        "question_banks",
        "users",
        ["owner_id"],
        ["id"],
    )
    op.add_column(
        "question_banks",
        sa.Column(
            "visibility",
            visibility_scope,
            nullable=False,
            server_default="private",
        ),
    )
    op.add_column("questions", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_questions_owner_id_users",
        "questions",
        "users",
        ["owner_id"],
        ["id"],
    )
    op.add_column("knowledge_points", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_knowledge_points_owner_id_users",
        "knowledge_points",
        "users",
        ["owner_id"],
        ["id"],
    )
    op.add_column(
        "knowledge_points",
        sa.Column(
            "visibility",
            visibility_scope,
            nullable=False,
            server_default="private",
        ),
    )
    op.add_column("exams", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_exams_owner_id_users",
        "exams",
        "users",
        ["owner_id"],
        ["id"],
    )

    op.execute("UPDATE questions SET owner_id = created_by WHERE owner_id IS NULL")
    op.execute("UPDATE exams SET owner_id = created_by WHERE owner_id IS NULL")
    op.execute(
        """
        UPDATE question_banks
        SET owner_id = COALESCE(
            (
                SELECT q.created_by
                FROM questions AS q
                WHERE q.question_bank_id = question_banks.id
                ORDER BY q.created_by ASC
                LIMIT 1
            ),
            (
                SELECT u.id
                FROM users AS u
                ORDER BY u.created_at ASC, u.id ASC
                LIMIT 1
            )
        )
        WHERE owner_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE knowledge_points
        SET owner_id = COALESCE(
            (
                SELECT q.created_by
                FROM questions AS q
                JOIN question_knowledge_points AS qkp
                    ON qkp.question_id = q.id
                WHERE qkp.knowledge_point_id = knowledge_points.id
                ORDER BY q.created_by ASC
                LIMIT 1
            ),
            (
                SELECT u.id
                FROM users AS u
                ORDER BY u.created_at ASC, u.id ASC
                LIMIT 1
            )
        )
        WHERE owner_id IS NULL
        """
    )
    op.execute("UPDATE question_banks SET visibility = 'private' WHERE visibility IS NULL")
    op.execute("UPDATE knowledge_points SET visibility = 'private' WHERE visibility IS NULL")

    op.alter_column("question_banks", "owner_id", nullable=False)
    op.alter_column("questions", "owner_id", nullable=False)
    op.alter_column("knowledge_points", "owner_id", nullable=False)
    op.alter_column("exams", "owner_id", nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_constraint("fk_exams_owner_id_users", "exams", type_="foreignkey")
    op.drop_column("exams", "owner_id")
    op.drop_constraint("fk_knowledge_points_owner_id_users", "knowledge_points", type_="foreignkey")
    op.drop_column("knowledge_points", "visibility")
    op.drop_column("knowledge_points", "owner_id")
    op.drop_constraint("fk_questions_owner_id_users", "questions", type_="foreignkey")
    op.drop_column("questions", "owner_id")
    op.drop_constraint("fk_question_banks_owner_id_users", "question_banks", type_="foreignkey")
    op.drop_column("question_banks", "visibility")
    op.drop_column("question_banks", "owner_id")
    if bind.dialect.name == "postgresql":
        visibility_scope.drop(bind, checkfirst=True)

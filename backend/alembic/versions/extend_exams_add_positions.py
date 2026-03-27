"""extend_exams_add_positions_exam_questions_exam_students

Revision ID: extend_exams_add_positions
Revises: add_knowledge_management
Create Date: 2026-03-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "extend_exams_add_positions"
down_revision: Union[str, None] = "add_knowledge_management"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── positions table ──
    op.create_table(
        "positions",
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", "created_by", name="uq_position_name_creator"),
    )

    # ── extend exams table ──
    op.add_column("exams", sa.Column("status", sa.String(20), nullable=False, server_default="draft"))
    op.add_column("exams", sa.Column("position_id", sa.UUID(), nullable=True))
    op.add_column("exams", sa.Column("max_switch_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("exams", sa.Column("show_result", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("exams", sa.Column("notes_template", sa.Text(), nullable=True))

    # Make start_time and end_time nullable (draft exams may not have times set)
    op.alter_column("exams", "start_time", existing_type=sa.DateTime(timezone=True), nullable=True)
    op.alter_column("exams", "end_time", existing_type=sa.DateTime(timezone=True), nullable=True)

    op.create_foreign_key("fk_exams_position_id", "exams", "positions", ["position_id"], ["id"])

    # ── exam_questions table ──
    op.create_table(
        "exam_questions",
        sa.Column("exam_id", sa.UUID(), nullable=False),
        sa.Column("question_id", sa.UUID(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score_override", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("exam_id", "question_id"),
    )

    # ── exam_students table ──
    op.create_table(
        "exam_students",
        sa.Column("exam_id", sa.UUID(), nullable=False),
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("exam_id", "student_id"),
    )

    # ── Migrate existing exam statuses based on time ──
    op.execute("""
        UPDATE exams SET status = CASE
            WHEN start_time IS NOT NULL AND start_time > now() THEN 'upcoming'
            WHEN start_time IS NOT NULL AND end_time IS NOT NULL AND start_time <= now() AND end_time >= now() THEN 'ongoing'
            WHEN end_time IS NOT NULL AND end_time < now() THEN 'completed'
            ELSE 'draft'
        END
    """)


def downgrade() -> None:
    op.drop_table("exam_students")
    op.drop_table("exam_questions")
    op.drop_constraint("fk_exams_position_id", "exams", type_="foreignkey")
    op.drop_column("exams", "notes_template")
    op.drop_column("exams", "show_result")
    op.drop_column("exams", "max_switch_count")
    op.drop_column("exams", "position_id")
    op.drop_column("exams", "status")
    op.alter_column("exams", "start_time", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.alter_column("exams", "end_time", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.drop_table("positions")

"""add question import jobs

Revision ID: 20260420_q_import_jobs
Revises: 20260420_add_notifications
Create Date: 2026-04-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260420_q_import_jobs"
down_revision: Union[str, None] = "20260420_add_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if bind.dialect.name == "postgresql":
        # Create the enum explicitly once, then reuse it in the table definition
        # without letting create_table emit a second CREATE TYPE.
        question_import_job_status = postgresql.ENUM(
            "PENDING",
            "RUNNING",
            "COMPLETED",
            "FAILED",
            "PARTIAL_FAILED",
            name="questionimportjobstatus",
            create_type=False,
        )
        question_import_job_status.create(bind, checkfirst=True)
    else:
        question_import_job_status = sa.Enum(
            "PENDING",
            "RUNNING",
            "COMPLETED",
            "FAILED",
            "PARTIAL_FAILED",
            name="questionimportjobstatus",
        )
    if not inspector.has_table("question_import_jobs"):
        op.create_table(
            "question_import_jobs",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("status", question_import_job_status, nullable=False),
            sa.Column("total_count", sa.Integer(), nullable=False),
            sa.Column("processed_count", sa.Integer(), nullable=False),
            sa.Column("matched_count", sa.Integer(), nullable=False),
            sa.Column("unmatched_count", sa.Integer(), nullable=False),
            sa.Column("failed_count", sa.Integer(), nullable=False),
            sa.Column("created_question_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    op.drop_table("question_import_jobs")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="questionimportjobstatus").drop(bind, checkfirst=True)

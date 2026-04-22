"""fix question import job completed_at type

Revision ID: 20260420_fix_question_import_job_completed_at
Revises: 20260420_add_question_import_jobs
Create Date: 2026-04-20
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260420_fix_question_import_job_completed_at"
down_revision: Union[str, None] = "20260420_add_question_import_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("question_import_jobs"):
        return

    columns = {column["name"]: column for column in inspector.get_columns("question_import_jobs")}
    completed_at = columns.get("completed_at")
    if completed_at is None:
        op.add_column(
            "question_import_jobs",
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        return

    if not isinstance(completed_at["type"], sa.DateTime):
        op.execute(
            """
            ALTER TABLE question_import_jobs
            ALTER COLUMN completed_at TYPE TIMESTAMP WITH TIME ZONE
            USING CASE
                WHEN completed_at IS NULL OR completed_at::text = 'null' THEN NULL
                ELSE trim(both '"' from completed_at::text)::timestamp with time zone
            END
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("question_import_jobs"):
        return

    columns = {column["name"]: column for column in inspector.get_columns("question_import_jobs")}
    completed_at = columns.get("completed_at")
    if completed_at is not None and isinstance(completed_at["type"], sa.DateTime):
        op.execute(
            """
            ALTER TABLE question_import_jobs
            ALTER COLUMN completed_at TYPE JSON
            USING to_json(completed_at)
            """
        )

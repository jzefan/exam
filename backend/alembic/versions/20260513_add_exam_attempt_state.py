"""add_exam_attempt_state

Revision ID: 20260513_attempt_state
Revises: 20260512_add_dimension_comments_to_grading_snapshots
Create Date: 2026-05-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260513_attempt_state"
down_revision: Union[str, None] = "20260512_add_dimension_comments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ATTEMPT_STATES = ("created", "in_progress", "expired", "submitted", "graded")


def upgrade() -> None:
    op.add_column(
        "exam_students",
        sa.Column(
            "attempt_state",
            sa.String(length=20),
            nullable=True,
            server_default="created",
        ),
    )
    # Note: server_default='created' fills all existing rows with 'created' on Postgres,
    # so we match on 'created' (not IS NULL) for the backfill.
    op.execute("""
        DO $$
        DECLARE cutoff timestamptz := now();
        BEGIN
            -- Already defaulted to 'created' by server_default; rows with
            -- started_at IS NOT NULL need promotion to in_progress or expired.

            UPDATE exam_students es SET attempt_state = 'in_progress'
              FROM exams e
              WHERE es.exam_id = e.id
                AND es.attempt_state = 'created'
                AND es.started_at IS NOT NULL
                AND es.submitted_at IS NULL
                AND (e.end_time IS NULL OR e.end_time > cutoff);

            UPDATE exam_students es SET attempt_state = 'expired'
              FROM exams e
              WHERE es.exam_id = e.id
                AND es.attempt_state = 'created'
                AND es.started_at IS NOT NULL
                AND es.submitted_at IS NULL
                AND e.end_time IS NOT NULL
                AND e.end_time <= cutoff;

            UPDATE exam_students SET attempt_state = 'submitted'
              WHERE attempt_state = 'created'
                AND submitted_at IS NOT NULL
                AND grading_status <> 'reviewed';

            UPDATE exam_students SET attempt_state = 'graded'
              WHERE attempt_state = 'created'
                AND submitted_at IS NOT NULL
                AND grading_status = 'reviewed';
        END $$;
    """)
    op.alter_column("exam_students", "attempt_state", nullable=False)
    op.create_index(
        "ix_exam_students_student_attempt_state",
        "exam_students",
        ["student_id", "attempt_state"],
    )


def downgrade() -> None:
    op.drop_index("ix_exam_students_student_attempt_state", "exam_students")
    op.drop_column("exam_students", "attempt_state")

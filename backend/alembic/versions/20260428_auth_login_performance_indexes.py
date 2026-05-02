"""auth login performance indexes

Revision ID: 20260428_auth_login_perf
Revises: 20260428_add_user_persona
Create Date: 2026-04-28 20:35:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260428_auth_login_perf"
down_revision: Union[str, None] = "20260428_add_user_persona"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_teacher_students_student_id", "teacher_students", ["student_id"])
    op.create_index("ix_exams_owner_id_deleted_at", "exams", ["owner_id", "deleted_at"])
    op.create_index("ix_exams_created_by_deleted_at", "exams", ["created_by", "deleted_at"])
    op.create_index("ix_questions_owner_id_deleted_at", "questions", ["owner_id", "deleted_at"])
    op.create_index(
        "ix_questions_question_bank_id_deleted_at",
        "questions",
        ["question_bank_id", "deleted_at"],
    )
    op.create_index("ix_grading_tasks_source_business_id", "grading_tasks", ["source_business_id"])
    op.create_index(
        "ix_grading_tasks_source_business_id_status",
        "grading_tasks",
        ["source_business_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_grading_tasks_source_business_id_status", table_name="grading_tasks")
    op.drop_index("ix_grading_tasks_source_business_id", table_name="grading_tasks")
    op.drop_index("ix_questions_question_bank_id_deleted_at", table_name="questions")
    op.drop_index("ix_questions_owner_id_deleted_at", table_name="questions")
    op.drop_index("ix_exams_created_by_deleted_at", table_name="exams")
    op.drop_index("ix_exams_owner_id_deleted_at", table_name="exams")
    op.drop_index("ix_teacher_students_student_id", table_name="teacher_students")

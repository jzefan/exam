"""add exam remedial practice columns (origin_exam_id, hidden_from_list)

Revision ID: 20260919_add_exam_remedial_practice
Revises: 20260719_add_exam_show_score
Create Date: 2026-09-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260919_add_exam_remedial_practice"
down_revision: str | Sequence[str] | None = "20260719_add_exam_show_score"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    exam_columns = {column["name"] for column in inspector.get_columns("exams")}

    if "origin_exam_id" not in exam_columns:
        op.add_column("exams", sa.Column("origin_exam_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            "fk_exams_origin_exam_id_exams",
            "exams",
            "exams",
            ["origin_exam_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index("ix_exams_origin_exam_id", "exams", ["origin_exam_id"])

    if "hidden_from_list" not in exam_columns:
        op.add_column(
            "exams",
            sa.Column("hidden_from_list", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    exam_columns = {column["name"] for column in inspector.get_columns("exams")}

    if "hidden_from_list" in exam_columns:
        op.drop_column("exams", "hidden_from_list")

    if "origin_exam_id" in exam_columns:
        op.drop_index("ix_exams_origin_exam_id", table_name="exams")
        op.drop_constraint("fk_exams_origin_exam_id_exams", "exams", type_="foreignkey")
        op.drop_column("exams", "origin_exam_id")

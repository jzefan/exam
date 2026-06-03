"""Add job-course graph mappings and shared layouts.

Revision ID: 20260602_job_course_graph
Revises: 20260530_exam_course_kp
Create Date: 2026-06-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260602_job_course_graph"
down_revision: Union[str, None] = "20260530_exam_course_kp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    if not _has_table("skill_course_mappings"):
        op.create_table(
            "skill_course_mappings",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("skill_id", sa.Uuid(), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
            sa.Column(
                "course_root_knowledge_point_id",
                sa.Uuid(),
                sa.ForeignKey("knowledge_points.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("relation_type", sa.String(20), nullable=False, server_default="required"),
            sa.Column("match_type", sa.String(20), nullable=False, server_default="manual"),
            sa.Column("status", sa.String(20), nullable=False, server_default="confirmed"),
            sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
    _create_index_if_missing("ix_skill_course_mappings_skill_id", "skill_course_mappings", ["skill_id"])
    _create_index_if_missing(
        "ix_skill_course_mappings_course_root_knowledge_point_id",
        "skill_course_mappings",
        ["course_root_knowledge_point_id"],
    )
    _create_index_if_missing(
        "ix_skill_course_mappings_active_pair",
        "skill_course_mappings",
        ["skill_id", "course_root_knowledge_point_id", "deleted_at"],
    )

    if not _has_table("job_model_graph_layouts"):
        op.create_table(
            "job_model_graph_layouts",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("scope_type", sa.String(40), nullable=False),
            sa.Column("scope_id", sa.Uuid(), nullable=False),
            sa.Column("layout_json", sa.JSON(), nullable=False),
            sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
    _create_index_if_missing("ix_job_model_graph_layouts_scope_type", "job_model_graph_layouts", ["scope_type"])
    _create_index_if_missing("ix_job_model_graph_layouts_scope_id", "job_model_graph_layouts", ["scope_id"])
    _create_index_if_missing(
        "ix_job_model_graph_layouts_active_scope",
        "job_model_graph_layouts",
        ["scope_type", "scope_id", "deleted_at"],
    )

    if not _has_column("skill_kp_mappings", "relation_type"):
        op.add_column(
            "skill_kp_mappings",
            sa.Column("relation_type", sa.String(20), nullable=False, server_default="required"),
        )
    if not _has_column("skill_kp_mappings", "status"):
        op.add_column(
            "skill_kp_mappings",
            sa.Column("status", sa.String(20), nullable=False, server_default="confirmed"),
        )
    if not _has_column("skill_kp_mappings", "created_by"):
        op.add_column(
            "skill_kp_mappings",
            sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        )
    if not _has_column("skill_kp_mappings", "deleted_at"):
        op.add_column(
            "skill_kp_mappings",
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("skill_kp_mappings", "deleted_at")
    op.drop_column("skill_kp_mappings", "created_by")
    op.drop_column("skill_kp_mappings", "status")
    op.drop_column("skill_kp_mappings", "relation_type")

    op.drop_index("ix_job_model_graph_layouts_active_scope", table_name="job_model_graph_layouts")
    op.drop_index("ix_job_model_graph_layouts_scope_id", table_name="job_model_graph_layouts")
    op.drop_index("ix_job_model_graph_layouts_scope_type", table_name="job_model_graph_layouts")
    op.drop_table("job_model_graph_layouts")

    op.drop_index("ix_skill_course_mappings_active_pair", table_name="skill_course_mappings")
    op.drop_index(
        "ix_skill_course_mappings_course_root_knowledge_point_id",
        table_name="skill_course_mappings",
    )
    op.drop_index("ix_skill_course_mappings_skill_id", table_name="skill_course_mappings")
    op.drop_table("skill_course_mappings")

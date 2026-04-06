"""add grading trust core tables

Revision ID: add_grading_trust_core
Revises: 280f461072d3
Create Date: 2026-04-04
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "add_grading_trust_core"
down_revision: Union[str, None] = "280f461072d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "grading_provider_configs",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("provider_type", sa.String(length=50), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("credential_env", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )

    op.create_table(
        "grading_model_configs",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("model_name", sa.String(length=150), nullable=False),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["provider_id"], ["grading_provider_configs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )

    op.create_table(
        "grading_role_bindings",
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("grader_model_id", sa.Uuid(), nullable=False),
        sa.Column("reviewer_model_id", sa.Uuid(), nullable=False),
        sa.Column("arbiter_model_id", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["arbiter_model_id"], ["grading_model_configs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grader_model_id"], ["grading_model_configs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_model_id"], ["grading_model_configs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("version", name="uq_grading_role_bindings_version"),
    )

    op.create_table(
        "grading_tasks",
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("source_business_id", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("question_type", sa.String(length=50), nullable=False),
        sa.Column("question_content", sa.Text(), nullable=False),
        sa.Column("subject", sa.String(length=100), nullable=True),
        sa.Column("language", sa.String(length=50), nullable=True),
        sa.Column("max_score", sa.Integer(), nullable=False),
        sa.Column("knowledge_tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("fatal_rule_enabled", sa.Boolean(), nullable=False),
        sa.Column("student_answer_raw", sa.Text(), nullable=False),
        sa.Column("student_answer_structured", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ocr_raw_text", sa.Text(), nullable=True),
        sa.Column("ocr_repaired_text", sa.Text(), nullable=True),
        sa.Column("attachment_refs", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("standard_answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("rubric_definition", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("scoring_points", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("dimension_weights", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("deduction_rules", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("fatal_error_rules", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("prompt_template_version", sa.String(length=100), nullable=True),
        sa.Column("role_binding_version", sa.Integer(), nullable=False),
        sa.Column("programming_language", sa.String(length=50), nullable=True),
        sa.Column("execution_env", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("test_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("compile_result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("runtime_result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("runtime_logs", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("resource_limit_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("latest_primary_snapshot_id", sa.Uuid(), nullable=True),
        sa.Column("latest_review_snapshot_id", sa.Uuid(), nullable=True),
        sa.Column("latest_arbitration_snapshot_id", sa.Uuid(), nullable=True),
        sa.Column("latest_final_snapshot_id", sa.Uuid(), nullable=True),
        sa.Column("latest_manual_snapshot_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["role_binding_version"], ["grading_role_bindings.version"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "grading_result_snapshots",
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_type", sa.String(length=50), nullable=False),
        sa.Column("score_total", sa.Float(), nullable=False),
        sa.Column("dimension_scores", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("deduction_reasons", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("strengths", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("improvement_suggestions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("evidence_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("risk_flags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("provider_config_id", sa.Uuid(), nullable=True),
        sa.Column("model_config_id", sa.Uuid(), nullable=True),
        sa.Column("prompt_template_version", sa.String(length=100), nullable=True),
        sa.Column("role_binding_version", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["model_config_id"], ["grading_model_configs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["provider_config_id"], ["grading_provider_configs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["role_binding_version"], ["grading_role_bindings.version"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["task_id"], ["grading_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "id", name="uq_grading_result_snapshots_task_id_id"),
    )

    op.create_table(
        "grading_audit_events",
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("event_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("operator_type", sa.String(length=50), nullable=False),
        sa.Column("operator_id", sa.String(length=100), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["grading_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_foreign_key(
        "fk_grading_tasks_latest_primary_snapshot_id",
        "grading_tasks",
        "grading_result_snapshots",
        ["latest_primary_snapshot_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_primary_snapshot_owner",
        "grading_tasks",
        "grading_result_snapshots",
        ["id", "latest_primary_snapshot_id"],
        ["task_id", "id"],
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_review_snapshot_id",
        "grading_tasks",
        "grading_result_snapshots",
        ["latest_review_snapshot_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_review_snapshot_owner",
        "grading_tasks",
        "grading_result_snapshots",
        ["id", "latest_review_snapshot_id"],
        ["task_id", "id"],
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_arbitration_snapshot_id",
        "grading_tasks",
        "grading_result_snapshots",
        ["latest_arbitration_snapshot_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_arbitration_snapshot_owner",
        "grading_tasks",
        "grading_result_snapshots",
        ["id", "latest_arbitration_snapshot_id"],
        ["task_id", "id"],
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_final_snapshot_id",
        "grading_tasks",
        "grading_result_snapshots",
        ["latest_final_snapshot_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_final_snapshot_owner",
        "grading_tasks",
        "grading_result_snapshots",
        ["id", "latest_final_snapshot_id"],
        ["task_id", "id"],
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_manual_snapshot_id",
        "grading_tasks",
        "grading_result_snapshots",
        ["latest_manual_snapshot_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_grading_tasks_latest_manual_snapshot_owner",
        "grading_tasks",
        "grading_result_snapshots",
        ["id", "latest_manual_snapshot_id"],
        ["task_id", "id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_grading_tasks_latest_manual_snapshot_owner", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_manual_snapshot_id", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_final_snapshot_owner", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_final_snapshot_id", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_arbitration_snapshot_owner", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_arbitration_snapshot_id", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_review_snapshot_owner", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_review_snapshot_id", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_primary_snapshot_owner", "grading_tasks", type_="foreignkey")
    op.drop_constraint("fk_grading_tasks_latest_primary_snapshot_id", "grading_tasks", type_="foreignkey")
    op.drop_table("grading_audit_events")
    op.drop_table("grading_result_snapshots")
    op.drop_table("grading_tasks")
    op.drop_table("grading_role_bindings")
    op.drop_table("grading_model_configs")
    op.drop_table("grading_provider_configs")

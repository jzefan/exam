"""add job model tables

Revision ID: a1b2c3d4e5f6
Revises: add_grading_trust_core
Create Date: 2026-04-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "add_grading_trust_core"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "job_model_projects",
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("industry", sa.String(100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("org_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(20), server_default="draft", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_model_projects_org_id", "job_model_projects", ["org_id"])

    op.create_table(
        "job_models",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("job_role", sa.String(200), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("version_note", sa.Text(), nullable=True),
        sa.Column("is_current", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("source_type", sa.String(20), server_default="manual", nullable=False),
        sa.Column("raw_content", sa.JSON(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["job_model_projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_models_project_id", "job_models", ["project_id"])

    op.create_table(
        "competency_dimensions",
        sa.Column("model_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["model_id"], ["job_models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_competency_dimensions_model_id", "competency_dimensions", ["model_id"])

    op.create_table(
        "skills",
        sa.Column("dimension_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("level", sa.String(10), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["dimension_id"], ["competency_dimensions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_skills_dimension_id", "skills", ["dimension_id"])

    op.create_table(
        "skill_knowledge_points",
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("teaching_suggestion", sa.Text(), nullable=True),
        sa.Column("difficulty", sa.String(10), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_skill_knowledge_points_skill_id", "skill_knowledge_points", ["skill_id"])

    op.create_table(
        "skill_kp_mappings",
        sa.Column("skill_kp_id", sa.Uuid(), nullable=False),
        sa.Column("knowledge_point_id", sa.Uuid(), nullable=False),
        sa.Column("match_type", sa.String(10), server_default="manual", nullable=False),
        sa.Column("confidence", sa.Float(), server_default="1.0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["skill_kp_id"], ["skill_knowledge_points.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["knowledge_point_id"], ["knowledge_points.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("skill_kp_id", "knowledge_point_id"),
    )

    op.create_table(
        "source_documents",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("file_name", sa.String(500), nullable=False),
        sa.Column("file_path", sa.String(1000), nullable=False),
        sa.Column("file_type", sa.String(20), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["job_model_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_source_documents_project_id", "source_documents", ["project_id"])

    op.create_table(
        "job_model_templates",
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("industry", sa.String(100), nullable=True),
        sa.Column("template_data", sa.JSON(), nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("usage_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("job_model_templates")
    op.drop_index("ix_source_documents_project_id", table_name="source_documents")
    op.drop_table("source_documents")
    op.drop_table("skill_kp_mappings")
    op.drop_index("ix_skill_knowledge_points_skill_id", table_name="skill_knowledge_points")
    op.drop_table("skill_knowledge_points")
    op.drop_index("ix_skills_dimension_id", table_name="skills")
    op.drop_table("skills")
    op.drop_index("ix_competency_dimensions_model_id", table_name="competency_dimensions")
    op.drop_table("competency_dimensions")
    op.drop_index("ix_job_models_project_id", table_name="job_models")
    op.drop_table("job_models")
    op.drop_index("ix_job_model_projects_org_id", table_name="job_model_projects")
    op.drop_table("job_model_projects")

"""add job model standard and enterprise metadata

Revision ID: 20260412_job_model_fast_create_phase1
Revises: 20260411_class_creator_ownership
Create Date: 2026-04-12
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260412_job_model_fast_create_phase1"
down_revision: Union[str, None] = "20260411_class_creator_ownership"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "job_models",
        sa.Column("model_type", sa.String(length=20), nullable=False, server_default=sa.text("'standard'")),
    )
    op.add_column(
        "job_models",
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'draft'")),
    )
    op.add_column("job_models", sa.Column("job_family", sa.String(length=100), nullable=True))
    op.add_column("job_models", sa.Column("industry_code", sa.String(length=50), nullable=True))
    op.add_column("job_models", sa.Column("industry_name", sa.String(length=100), nullable=True))
    op.add_column("job_models", sa.Column("direction_code", sa.String(length=50), nullable=True))
    op.add_column("job_models", sa.Column("direction_name", sa.String(length=100), nullable=True))
    op.add_column("job_models", sa.Column("origin_standard_model_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_job_models_origin_standard_model_id_job_models",
        "job_models",
        "job_models",
        ["origin_standard_model_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "skills",
        sa.Column("item_source", sa.String(length=30), nullable=False, server_default=sa.text("'standard'")),
    )
    op.add_column(
        "skills",
        sa.Column("change_type", sa.String(length=20), nullable=False, server_default=sa.text("'none'")),
    )
    op.add_column("skills", sa.Column("evidence_summary", sa.Text(), nullable=True))
    op.add_column("skills", sa.Column("source_excerpt", sa.Text(), nullable=True))
    op.add_column(
        "skill_knowledge_points",
        sa.Column("item_source", sa.String(length=30), nullable=False, server_default=sa.text("'standard'")),
    )
    op.add_column(
        "skill_knowledge_points",
        sa.Column("change_type", sa.String(length=20), nullable=False, server_default=sa.text("'none'")),
    )
    op.add_column("skill_knowledge_points", sa.Column("evidence_summary", sa.Text(), nullable=True))
    op.add_column("skill_knowledge_points", sa.Column("source_excerpt", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("skill_knowledge_points", "source_excerpt")
    op.drop_column("skill_knowledge_points", "evidence_summary")
    op.drop_column("skill_knowledge_points", "change_type")
    op.drop_column("skill_knowledge_points", "item_source")
    op.drop_column("skills", "source_excerpt")
    op.drop_column("skills", "evidence_summary")
    op.drop_column("skills", "change_type")
    op.drop_column("skills", "item_source")
    op.drop_constraint(
        "fk_job_models_origin_standard_model_id_job_models",
        "job_models",
        type_="foreignkey",
    )
    op.drop_column("job_models", "origin_standard_model_id")
    op.drop_column("job_models", "direction_name")
    op.drop_column("job_models", "direction_code")
    op.drop_column("job_models", "industry_name")
    op.drop_column("job_models", "industry_code")
    op.drop_column("job_models", "job_family")
    op.drop_column("job_models", "status")
    op.drop_column("job_models", "model_type")

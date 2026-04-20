"""job_models list perf indexes

Revision ID: 20260420_job_models_list_indexes
Revises: 20260417_add_exam_category
Create Date: 2026-04-20
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260420_job_models_list_indexes"
down_revision: Union[str, None] = "20260417_add_exam_category"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Covering index for the list endpoint: filter by org + soft-delete, sort by updated_at desc.
    op.create_index(
        "ix_job_models_org_updated",
        "job_models",
        ["org_id", "deleted_at", "updated_at"],
    )
    # Speeds up facets aggregation by industry/direction.
    op.create_index(
        "ix_job_models_org_industry_direction",
        "job_models",
        ["org_id", "industry_name", "direction_name"],
    )
    # current_version selectinload joins by job_model_versions.id which is already PK,
    # but versions lookup by job_model_id needs coverage for version history endpoints.
    op.create_index(
        "ix_job_model_versions_jm_deleted",
        "job_model_versions",
        ["job_model_id", "deleted_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_job_model_versions_jm_deleted", table_name="job_model_versions")
    op.drop_index("ix_job_models_org_industry_direction", table_name="job_models")
    op.drop_index("ix_job_models_org_updated", table_name="job_models")

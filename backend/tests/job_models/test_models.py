from datetime import datetime, timezone
import uuid
from pathlib import Path

from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB

from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelTemplate,
    JobModelVersion,
    SourceDocument,
)


def test_job_model_has_main_entity_fields_and_version_link() -> None:
    columns = JobModel.__table__.c

    assert "job_role" in columns
    assert "model_type" in columns
    assert "job_family" in columns
    assert "industry_code" in columns
    assert "industry_name" in columns
    assert "direction_code" in columns
    assert "direction_name" in columns
    assert "status" in columns
    assert "origin_standard_model_id" in columns
    assert "org_id" in columns
    assert "created_by" in columns
    assert "current_version_id" in columns

    assert "versions" in JobModel.__dict__
    assert list(columns.current_version_id.foreign_keys)[0].target_fullname == "job_model_versions.id"
    assert list(columns.origin_standard_model_id.foreign_keys)[0].target_fullname == "job_models.id"
    assert JobModel.__mapper__.relationships["versions"]._user_defined_foreign_keys == {
        JobModelVersion.__table__.c.job_model_id
    }


def test_job_model_version_is_lean_and_version_scoped() -> None:
    columns = JobModelVersion.__table__.c

    assert "job_model_id" in columns
    assert "version" in columns
    assert "version_note" in columns
    assert "source_type" in columns
    assert "raw_content" in columns
    assert "is_current" in columns
    assert "created_by" in columns
    assert "published_at" in columns
    assert isinstance(columns.raw_content.type.dialect_impl(postgresql.dialect()), JSONB)
    assert "job_role" not in columns
    assert "model_type" not in columns
    assert "job_family" not in columns
    assert "origin_standard_model_id" not in columns


def test_competency_dimension_points_to_version() -> None:
    columns = CompetencyDimension.__table__.c

    assert "model_version_id" in columns
    assert "model_id" not in columns
    assert list(columns.model_version_id.foreign_keys)[0].target_fullname == "job_model_versions.id"
    assert "model_version" in CompetencyDimension.__dict__


def test_job_model_version_supports_content_metadata() -> None:
    version = JobModelVersion(
        id=uuid.uuid4(),
        job_model_id=uuid.uuid4(),
        version=2,
        version_note="Rebased from standard template",
        source_type="standard_based",
        raw_content={"dimensions": []},
        is_current=True,
        created_by=uuid.uuid4(),
        published_at=datetime.now(timezone.utc),
    )

    assert version.version == 2
    assert version.source_type == "standard_based"
    assert version.raw_content == {"dimensions": []}
    assert version.created_by is not None
    assert version.published_at is not None


def test_source_document_prefers_job_model_attachment() -> None:
    columns = SourceDocument.__table__.c

    assert "job_model_id" in columns
    assert "job_model_version_id" in columns
    assert list(columns.job_model_id.foreign_keys)[0].target_fullname == "job_models.id"
    assert list(columns.job_model_version_id.foreign_keys)[0].target_fullname == "job_model_versions.id"
    assert "job_model" in SourceDocument.__dict__
    assert "job_model_version" in SourceDocument.__dict__
    assert "source_documents" in JobModel.__dict__
    assert SourceDocument.__mapper__.relationships["job_model"].mapper.class_ is JobModel
    assert SourceDocument.__mapper__.relationships["job_model_version"].mapper.class_ is JobModelVersion
    assert "delete-orphan" not in SourceDocument.__mapper__.relationships["job_model_version"].cascade


def test_job_model_template_still_supports_templates() -> None:
    template = JobModelTemplate(
        id=uuid.uuid4(),
        name="Software Engineer Template",
        industry="Technology",
        template_data={"dimensions": []},
        created_by=uuid.uuid4(),
    )

    assert template.id is not None
    assert template.template_data == {"dimensions": []}


def test_migration_avoids_duplicate_origin_fk_and_restores_plain_json() -> None:
    migration = Path("/Users/jzefan/work/proj/exam/backend/alembic/versions/20260413_job_model_deproject.py").read_text()
    upgrade_text, downgrade_text = migration.split("def downgrade() -> None:")

    assert "fk_job_models_origin_standard_model_id_job_models" not in upgrade_text
    assert "sa.JSON().with_variant(JSONB, \"postgresql\")" not in downgrade_text
    assert "sa.JSON(), nullable=True" in downgrade_text
    assert "fk_job_models_origin_standard_model_id_job_models" in downgrade_text

"""Tests for job_models service layer."""

import uuid

import pytest

from app.job_models.models import CompetencyDimension, JobModel, JobModelVersion, Skill, SkillKnowledgePoint, SourceDocument
from app.job_models.schemas import (
    DimensionCreate,
    JobModelCreate,
    SkillCreate,
    SkillKnowledgePointCreate,
    SourceDocumentResponse,
)
from app.job_models.service import (
    create_job_model,
    delete_job_model,
    get_job_model_by_id,
    list_all_job_models,
    publish_new_version,
    save_model_as_template,
)


def _job_model_payload(
    job_role: str = "Backend Engineer",
    model_type: str = "standard",
    origin_standard_model_id: uuid.UUID | None = None,
) -> JobModelCreate:
    return JobModelCreate(
        job_role=job_role,
        model_type=model_type,
        origin_standard_model_id=origin_standard_model_id,
        dimensions=[
            DimensionCreate(
                name="Programming",
                sort_order=1,
                skills=[
                    SkillCreate(
                        name="Python",
                        level="L3",
                        sort_order=1,
                        knowledge_points=[
                            SkillKnowledgePointCreate(name="Decorators", difficulty="中级"),
                            SkillKnowledgePointCreate(name="Async/Await", difficulty="高级"),
                        ],
                    )
                ],
            )
        ],
    )


class FakeSession:
    def __init__(self, *, models: list[JobModel] | None = None) -> None:
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.models = models or []
        self.statements: list[str] = []

    def add(self, obj) -> None:
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def refresh(self, _obj) -> None:
        return None

    async def delete(self, obj) -> None:
        self.deleted.append(obj)

    async def execute(self, stmt):
        sql = str(stmt)
        sql_lower = sql.lower()
        self.statements.append(sql)

        active_models = [m for m in self.models if getattr(m, "deleted_at", None) is None]
        deleted_models = [m for m in self.models if getattr(m, "deleted_at", None) is not None]
        source_documents = [d for d in getattr(self, "source_documents", []) if getattr(d, "deleted_at", None) is None]

        if "count(" in sql_lower:
            return _Result(count=len(active_models))

        if "order by" in sql_lower or "limit" in sql_lower or "offset" in sql_lower:
            return _Result(models=active_models)

        if "source_documents" in sql_lower:
            return _Result(models=source_documents)

        if "job_models.id" in sql_lower or "job_models" in sql_lower:
            if "deleted_at is null" in sql_lower:
                return _Result(model=active_models[0] if active_models else None)
            return _Result(model=(deleted_models[0] if deleted_models else active_models[0] if active_models else None))

        return _Result(models=active_models)


class _Result:
    def __init__(self, *, model=None, models=None, count: int | None = None) -> None:
        self._model = model
        self._models = models or []
        self._count = count

    def scalar_one_or_none(self):
        return self._model

    def scalar_one(self):
        return self._count

    def scalars(self):
        return self

    def all(self):
        return self._models


@pytest.mark.asyncio
async def test_module_no_longer_exposes_project_compatibility_apis() -> None:
    from app.job_models import models as job_model_models
    from app.job_models import schemas as job_model_schemas
    from app.job_models import service as job_model_service

    assert not hasattr(job_model_models, "JobModelProject")
    assert not hasattr(job_model_schemas, "ProjectCreate")
    assert not hasattr(job_model_schemas, "ProjectResponse")
    assert not hasattr(job_model_schemas, "ProjectUpdate")
    assert "job_model_id" in SourceDocumentResponse.model_fields
    assert "project_id" not in SourceDocumentResponse.model_fields


@pytest.mark.asyncio
async def test_create_job_model_auto_creates_initial_current_version(monkeypatch) -> None:
    from app.job_models import service as job_model_service

    async def fake_load_job_model(_db, _model_id):
        return None

    monkeypatch.setattr(job_model_service, "_load_job_model", fake_load_job_model)

    db = FakeSession()
    model = await create_job_model(db, uuid.uuid4(), uuid.uuid4(), _job_model_payload())

    assert model.id is not None
    assert model.current_version_id is not None
    assert model.current_version is not None
    assert model.current_version.version == 1
    assert model.current_version.is_current is True
    assert any(isinstance(obj, CompetencyDimension) and obj.name == "Programming" for obj in db.added)
    assert any(isinstance(obj, Skill) and obj.name == "Python" for obj in db.added)
    assert sum(isinstance(obj, SkillKnowledgePoint) for obj in db.added) == 2


@pytest.mark.asyncio
async def test_create_job_model_preserves_origin_standard_model_id(monkeypatch) -> None:
    from app.job_models import service as job_model_service

    async def fake_load_job_model(_db, _model_id):
        return None

    monkeypatch.setattr(job_model_service, "_load_job_model", fake_load_job_model)

    db = FakeSession()
    origin_standard_model_id = uuid.uuid4()
    model = await create_job_model(
        db,
        uuid.uuid4(),
        uuid.uuid4(),
        _job_model_payload(origin_standard_model_id=origin_standard_model_id),
    )

    assert model.origin_standard_model_id == origin_standard_model_id


@pytest.mark.asyncio
async def test_delete_job_model_soft_deletes_model_and_version() -> None:
    db = FakeSession()
    model = JobModel(
        id=uuid.uuid4(),
        job_role="To Delete",
        model_type="standard",
        status="draft",
        org_id=uuid.uuid4(),
    )
    version = JobModelVersion(
        id=uuid.uuid4(),
        job_model_id=model.id,
        version=1,
        is_current=True,
        source_type="manual",
    )
    old_version = JobModelVersion(
        id=uuid.uuid4(),
        job_model_id=model.id,
        version=0,
        is_current=False,
        source_type="manual",
    )
    dim = CompetencyDimension(id=uuid.uuid4(), model_version_id=version.id, name="Dim", sort_order=0)
    skill = Skill(id=uuid.uuid4(), dimension_id=dim.id, name="Skill", sort_order=0)
    kp = SkillKnowledgePoint(id=uuid.uuid4(), skill_id=skill.id, name="KP", sort_order=0)
    skill.knowledge_points = [kp]
    dim.skills = [skill]
    old_dim = CompetencyDimension(id=uuid.uuid4(), model_version_id=old_version.id, name="Old Dim", sort_order=0)
    old_skill = Skill(id=uuid.uuid4(), dimension_id=old_dim.id, name="Old Skill", sort_order=0)
    old_kp = SkillKnowledgePoint(id=uuid.uuid4(), skill_id=old_skill.id, name="Old KP", sort_order=0)
    old_skill.knowledge_points = [old_kp]
    old_dim.skills = [old_skill]
    version.dimensions = [dim]
    old_version.dimensions = [old_dim]
    model.current_version = version
    model.current_version_id = version.id
    model.versions = [version, old_version]
    docs = [
        SourceDocument(
            id=uuid.uuid4(),
            job_model_id=model.id,
            job_model_version_id=version.id,
            file_name="jd-1.pdf",
            file_path="/tmp/jd-1.pdf",
            file_type="pdf",
        ),
        SourceDocument(
            id=uuid.uuid4(),
            job_model_id=model.id,
            job_model_version_id=version.id,
            file_name="jd-2.pdf",
            file_path="/tmp/jd-2.pdf",
            file_type="pdf",
        ),
    ]
    db.source_documents = docs

    await delete_job_model(db, model)

    assert db.deleted == []
    assert model.deleted_at is not None
    assert version.deleted_at is not None
    assert old_version.deleted_at is not None
    assert dim.deleted_at is not None
    assert old_dim.deleted_at is not None
    assert skill.deleted_at is not None
    assert old_skill.deleted_at is not None
    assert kp.deleted_at is not None
    assert old_kp.deleted_at is not None
    assert all(doc.deleted_at is not None for doc in docs)


@pytest.mark.asyncio
async def test_soft_deleted_model_is_filtered_out_by_get_and_list() -> None:
    active = JobModel(
        id=uuid.uuid4(),
        job_role="Active",
        model_type="standard",
        status="draft",
        org_id=uuid.uuid4(),
    )
    active.deleted_at = None
    deleted = JobModel(
        id=uuid.uuid4(),
        job_role="Deleted",
        model_type="standard",
        status="draft",
        org_id=active.org_id,
    )
    deleted.deleted_at = object()

    db = FakeSession(models=[active, deleted])

    fetched = await get_job_model_by_id(db, deleted.id)
    models, total = await list_all_job_models(db, org_id=active.org_id)

    assert fetched is active
    assert total == 1
    assert len(models) == 1
    assert models[0].id == active.id
    assert any("deleted_at is null" in stmt.lower() for stmt in db.statements)


@pytest.mark.asyncio
async def test_publish_new_version_preserves_skill_diff_metadata(monkeypatch) -> None:
    from app.job_models import service as job_model_service

    job_model_id = uuid.uuid4()
    version_id = uuid.uuid4()
    current_version = JobModelVersion(
        id=version_id,
        job_model_id=job_model_id,
        version=1,
        version_note="标准岗位草案",
        is_current=True,
        source_type="manual",
        raw_content={"dimensions": []},
    )
    dimension = CompetencyDimension(
        id=uuid.uuid4(),
        model_version_id=version_id,
        name="Engineering",
        sort_order=0,
    )
    skill = Skill(
        id=uuid.uuid4(),
        dimension_id=dimension.id,
        name="Internal Middleware",
        item_source="enterprise_added",
        change_type="added",
        evidence_summary="JD 多次提及内部中台能力",
        source_excerpt="负责内部中台组件开发与维护",
        sort_order=0,
    )
    kp = SkillKnowledgePoint(
        id=uuid.uuid4(),
        skill_id=skill.id,
        name="Service Mesh",
        item_source="enterprise_added",
        change_type="added",
        evidence_summary="JD 多次提及内部中台能力",
        source_excerpt="理解 Service Mesh 和内部治理平台",
        sort_order=0,
    )
    skill.knowledge_points = [kp]
    dimension.skills = [skill]
    current_version.dimensions = [dimension]

    base_model = JobModel(
        id=job_model_id,
        job_role="Platform Engineer",
        model_type="enterprise",
        status="draft",
        org_id=uuid.uuid4(),
        current_version_id=version_id,
    )
    base_model.current_version = current_version

    fake_session = FakeSession(models=[base_model])

    async def fake_load_job_model(_db, _model_id):
        return base_model

    monkeypatch.setattr(job_model_service, "_load_job_model", fake_load_job_model)

    new_model = await publish_new_version(fake_session, base_model, version_note="校准后发布")
    copied_skill = next(obj for obj in fake_session.added if isinstance(obj, Skill) and obj.name == "Internal Middleware")
    copied_kp = next(obj for obj in fake_session.added if isinstance(obj, SkillKnowledgePoint) and obj.name == "Service Mesh")

    assert new_model.current_version is not None
    assert new_model.current_version.version == 2
    assert new_model.current_version.is_current is True
    assert new_model.current_version.version_note == "校准后发布"
    assert copied_skill.item_source == "enterprise_added"
    assert copied_skill.change_type == "added"
    assert copied_skill.evidence_summary == "JD 多次提及内部中台能力"
    assert copied_skill.source_excerpt == "负责内部中台组件开发与维护"
    assert copied_kp.item_source == "enterprise_added"
    assert copied_kp.change_type == "added"
    assert copied_kp.evidence_summary == "JD 多次提及内部中台能力"
    assert copied_kp.source_excerpt == "理解 Service Mesh 和内部治理平台"


@pytest.mark.asyncio
async def test_save_model_as_template(monkeypatch) -> None:
    from app.job_models import service as job_model_service

    job_model_id = uuid.uuid4()
    current_version = JobModelVersion(
        id=uuid.uuid4(),
        job_model_id=job_model_id,
        version=1,
        is_current=True,
        source_type="manual",
        raw_content={"dimensions": []},
    )
    dimension = CompetencyDimension(
        id=uuid.uuid4(),
        model_version_id=current_version.id,
        name="Infrastructure",
        description="Infra",
        sort_order=0,
    )
    skill = Skill(
        id=uuid.uuid4(),
        dimension_id=dimension.id,
        name="Docker",
        description="Containers",
        sort_order=0,
    )
    kp = SkillKnowledgePoint(
        id=uuid.uuid4(),
        skill_id=skill.id,
        name="Containers",
        teaching_suggestion="Use Docker well",
        difficulty="初级",
        sort_order=0,
    )
    skill.knowledge_points = [kp]
    dimension.skills = [skill]
    current_version.dimensions = [dimension]

    model = JobModel(
        id=job_model_id,
        job_role="DevOps Engineer",
        model_type="enterprise",
        status="draft",
        org_id=uuid.uuid4(),
        current_version_id=current_version.id,
    )
    model.current_version = current_version

    async def fake_load_job_model(_db, _model_id):
        return model

    monkeypatch.setattr(job_model_service, "_load_job_model", fake_load_job_model)

    template = await save_model_as_template(FakeSession(), model, name="DevOps Template", user_id=uuid.uuid4())

    assert template.id is not None
    assert template.name == "DevOps Template"
    assert template.template_data is not None
    assert template.template_data["job_role"] == "DevOps Engineer"
    assert len(template.template_data["dimensions"]) == 1
    assert template.template_data["dimensions"][0]["name"] == "Infrastructure"
    assert template.template_data["dimensions"][0]["skills"][0]["name"] == "Docker"

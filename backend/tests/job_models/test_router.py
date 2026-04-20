"""Integration tests for job model API routes."""

from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

import pytest


def test_router_module_no_longer_exposes_project_router() -> None:
    from app.job_models import router as job_model_router

    assert not hasattr(job_model_router, "project_router")


@pytest.mark.asyncio
async def test_list_all_models_passes_model_type_filter(monkeypatch) -> None:
    from app.job_models import router as job_model_router

    captured: dict[str, object] = {}

    async def fake_list_all_job_models(db, org_id, skip, limit, model_type=None):
        captured["model_type"] = model_type
        now = datetime.now(timezone.utc)
        model = SimpleNamespace(
            id=uuid.uuid4(),
            current_version_id=uuid.uuid4(),
            job_role="Java 后端工程师",
            model_type="standard",
            status="published",
            job_family="后端开发",
            industry_code=None,
            industry_name="软件和信息服务",
            direction_code=None,
            direction_name="工业软件",
            origin_standard_model_id=None,
            org_id=org_id,
            created_by=None,
            current_version=SimpleNamespace(
                id=uuid.uuid4(),
                job_model_id=uuid.uuid4(),
                version=1,
                version_note=None,
                is_current=True,
                source_type="manual",
                raw_content={"dimensions": []},
                created_by=None,
                published_at=None,
                created_at=now,
                updated_at=now,
            ),
            created_at=now,
            updated_at=now,
        )
        return [model], 1

    class FakeResponse:
        def __init__(self) -> None:
            self.headers: dict[str, str] = {}

    monkeypatch.setattr(job_model_router, "list_all_job_models", fake_list_all_job_models)

    response = FakeResponse()
    body = await job_model_router.list_all_models(
        db=object(),
        _user=SimpleNamespace(id=uuid.uuid4()),
        org_id=uuid.uuid4(),
        _start=0,
        _end=20,
        model_type="standard",
        response=response,
    )

    assert captured["model_type"] == "standard"
    assert response.headers["X-Total-Count"] == "1"
    assert body[0].model_type == "standard"
    assert body[0].current_version_id is not None
    assert body[0].current_version is not None
    assert body[0].current_version.version == 1


@pytest.mark.asyncio
async def test_create_model_directly_returns_current_version(monkeypatch) -> None:
    from app.job_models import router as job_model_router

    now = datetime.now(timezone.utc)
    returned = SimpleNamespace(
        id=uuid.uuid4(),
        current_version_id=uuid.uuid4(),
        job_role="Software Engineer",
        model_type="standard",
        status="draft",
        job_family=None,
        industry_code=None,
        industry_name=None,
        direction_code=None,
        direction_name=None,
        origin_standard_model_id=None,
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        current_version=SimpleNamespace(
            id=uuid.uuid4(),
            job_model_id=uuid.uuid4(),
            version=1,
            version_note=None,
            is_current=True,
            source_type="manual",
            raw_content={"dimensions": []},
            created_by=None,
            published_at=now,
            created_at=now,
            updated_at=now,
            dimensions=[
                SimpleNamespace(
                    id=uuid.uuid4(),
                    model_version_id=uuid.uuid4(),
                    name="Technical Skills",
                    description=None,
                    sort_order=0,
                    skills=[],
                    created_at=now,
                    updated_at=now,
                )
            ],
        ),
        created_at=now,
        updated_at=now,
    )

    async def fake_create_job_model(db, org_id, user_id, body):
        assert body.job_role == "Software Engineer"
        assert org_id is not None
        assert user_id is not None
        return returned

    async def fake_get_job_model_by_id(db, model_id):
        return returned

    class FakeDB:
        async def commit(self) -> None:
            return None

    monkeypatch.setattr(job_model_router, "create_job_model", fake_create_job_model)
    monkeypatch.setattr(job_model_router, "get_job_model_by_id", fake_get_job_model_by_id)

    response = await job_model_router.create_model(
        body=job_model_router.JobModelCreate(job_role="Software Engineer", source_type="manual"),
        db=FakeDB(),
        user=SimpleNamespace(id=uuid.uuid4()),
        org_id=uuid.uuid4(),
    )

    assert response.current_version_id is not None
    assert response.current_version is not None
    assert response.current_version.version == 1
    assert response.current_version.is_current is True


@pytest.mark.asyncio
async def test_get_model_detail_returns_current_version(monkeypatch) -> None:
    from app.job_models import router as job_model_router

    now = datetime.now(timezone.utc)
    model = SimpleNamespace(
        id=uuid.uuid4(),
        current_version_id=uuid.uuid4(),
        job_role="Data Analyst",
        model_type="standard",
        status="draft",
        job_family=None,
        industry_code=None,
        industry_name=None,
        direction_code=None,
        direction_name=None,
        origin_standard_model_id=None,
        org_id=uuid.uuid4(),
        created_by=None,
        current_version=SimpleNamespace(
            id=uuid.uuid4(),
            job_model_id=uuid.uuid4(),
            version=1,
            version_note=None,
            is_current=True,
            source_type="manual",
            raw_content={"dimensions": []},
            created_by=None,
            published_at=now,
            created_at=now,
            updated_at=now,
            dimensions=[],
        ),
        created_at=now,
        updated_at=now,
    )

    async def fake_get_job_model_by_id(_db, _model_id):
        return model

    monkeypatch.setattr(job_model_router, "get_job_model_by_id", fake_get_job_model_by_id)

    detail = await job_model_router.get_model_detail(
        model_id=uuid.uuid4(),
        db=object(),
        _user=SimpleNamespace(id=uuid.uuid4()),
    )

    assert detail.id == model.id
    assert detail.current_version_id == model.current_version_id
    assert detail.current_version is not None
    assert detail.current_version.version == 1
    assert detail.current_version.is_current is True


@pytest.mark.asyncio
async def test_delete_model_returns_204(monkeypatch) -> None:
    from app.job_models import router as job_model_router

    deleted: list[object] = []

    model = SimpleNamespace(
        id=uuid.uuid4(),
        deleted_at=None,
        current_version=SimpleNamespace(
            deleted_at=None,
            dimensions=[],
        ),
    )

    async def fake_get_job_model_by_id(_db, _model_id):
        return model

    async def fake_delete_job_model(_db, obj):
        obj.deleted_at = datetime.now(timezone.utc)
        deleted.append(obj)

    class FakeDB:
        async def commit(self) -> None:
            return None

    monkeypatch.setattr(job_model_router, "get_job_model_by_id", fake_get_job_model_by_id)
    monkeypatch.setattr(job_model_router, "delete_job_model", fake_delete_job_model)

    response = await job_model_router.delete_model(
        model_id=model.id,
        db=FakeDB(),
        _user=SimpleNamespace(id=uuid.uuid4()),
    )

    assert response.status_code == 204
    assert deleted
    assert model.deleted_at is not None


@pytest.mark.asyncio
async def test_create_enterprise_copy_returns_job_model_and_version(monkeypatch) -> None:
    from app.job_models import router as job_model_router

    now = datetime.now(timezone.utc)
    org_id = uuid.uuid4()
    standard = SimpleNamespace(
        id=uuid.uuid4(),
        model_type="standard",
        current_version_id=uuid.uuid4(),
        org_id=org_id,
    )
    created_model = SimpleNamespace(id=uuid.uuid4())
    created_version = SimpleNamespace(id=uuid.uuid4(), created_at=now, updated_at=now)

    async def fake_get_job_model_by_id(_db, _model_id):
        return standard

    async def fake_create_enterprise_model_from_standard(*args, **kwargs):
        return created_model, created_version

    class FakeDB:
        async def commit(self) -> None:
            return None

    monkeypatch.setattr(job_model_router, "get_job_model_by_id", fake_get_job_model_by_id)
    monkeypatch.setattr(
        job_model_router,
        "create_enterprise_model_from_standard",
        fake_create_enterprise_model_from_standard,
    )

    response = await job_model_router.create_enterprise_copy(
        model_id=standard.id,
        body=job_model_router.EnterpriseCopyCreate(
            enterprise_name="某企业 Java 后端工程师",
            version_note="企业校准初版",
        ),
        db=FakeDB(),
        user=SimpleNamespace(id=uuid.uuid4()),
        org_id=org_id,
    )

    assert response.job_model_id == created_model.id
    assert response.version_id == created_version.id

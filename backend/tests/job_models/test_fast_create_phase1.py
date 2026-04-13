"""Phase 1 tests for standard recommendation and enterprise copy flows."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.job_models.models import CompetencyDimension, JobModel, JobModelVersion, Skill, SkillKnowledgePoint
from app.job_models.service import (
    create_enterprise_model_from_standard,
    get_job_model_by_id,
    recommend_standard_model,
)
from app.rbac.models import Organization


async def _create_standard_model(
    db_session: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    job_role: str,
    industry_name: str,
    direction_name: str,
) -> JobModel:
    model = JobModel(
        job_role=job_role,
        model_type="standard",
        status="published",
        job_family="后端开发",
        industry_name=industry_name,
        direction_name=direction_name,
        org_id=org_id,
        created_by=user_id,
    )
    db_session.add(model)
    await db_session.flush()

    version = JobModelVersion(
        job_model_id=model.id,
        version=1,
        version_note="标准岗位草案",
        is_current=True,
        source_type="manual",
    )
    db_session.add(version)
    await db_session.flush()
    model.current_version_id = version.id
    model.current_version = version
    await db_session.flush()

    dim = CompetencyDimension(
        model_version_id=version.id,
        name="核心技能",
        description="核心技能维度",
        sort_order=0,
    )
    db_session.add(dim)
    await db_session.flush()

    skill = Skill(
        dimension_id=dim.id,
        name="Java",
        level="L3",
        description="Java 核心开发能力",
        sort_order=0,
    )
    db_session.add(skill)
    await db_session.flush()

    kp = SkillKnowledgePoint(
        skill_id=skill.id,
        name="Spring Boot",
        teaching_suggestion="掌握基础工程搭建",
        difficulty="中级",
        sort_order=0,
    )
    db_session.add(kp)
    await db_session.flush()
    await db_session.refresh(model)
    return model


async def _get_router_org(db_session: AsyncSession) -> Organization:
    result = await db_session.execute(
        select(Organization).order_by(Organization.created_at.desc()).limit(1)
    )
    org = result.scalar_one()
    return org


@pytest.mark.asyncio
async def test_recommend_standard_model_returns_best_match(
    db_session: AsyncSession,
    org: Organization,
    user_id: uuid.UUID,
) -> None:
    await _create_standard_model(
        db_session,
        org_id=org.id,
        user_id=user_id,
        job_role="Python 开发工程师",
        industry_name="软件和信息服务",
        direction_name="AI 应用开发",
    )
    expected = await _create_standard_model(
        db_session,
        org_id=org.id,
        user_id=user_id,
        job_role="Java 后端工程师",
        industry_name="软件和信息服务",
        direction_name="工业软件",
    )

    model = await recommend_standard_model(
        db_session,
        "负责 Java 后端开发，熟悉 Spring Boot、MySQL、接口设计",
        org.id,
    )

    assert model is not None
    assert model.id == expected.id
    assert model.job_role == "Java 后端工程师"
    assert model.direction_name == "工业软件"


@pytest.mark.asyncio
async def test_create_enterprise_model_from_standard_copies_dimensions(
    db_session: AsyncSession,
    org: Organization,
    user_id: uuid.UUID,
) -> None:
    standard = await _create_standard_model(
        db_session,
        org_id=org.id,
        user_id=user_id,
        job_role="Java 后端工程师",
        industry_name="软件和信息服务",
        direction_name="工业软件",
    )

    created, created_version = await create_enterprise_model_from_standard(
        db_session,
        standard,
        enterprise_name="某企业后端岗位",
        org_id=org.id,
        user_id=user_id,
        version_note="初始企业版",
    )

    assert created is not None
    assert created.model_type == "enterprise"
    assert created.origin_standard_model_id == standard.id
    assert created_version.source_type == "standard_based"
    assert created_version.version == 1
    assert created_version.version_note == "初始企业版"

    loaded = await get_job_model_by_id(db_session, created.id)
    assert loaded is not None
    assert loaded.model_type == "enterprise"
    assert loaded.origin_standard_model_id == standard.id
    assert loaded.current_version is not None
    assert len(loaded.current_version.dimensions) == 1
    assert loaded.current_version.dimensions[0].name == "核心技能"
    assert len(loaded.current_version.dimensions[0].skills) == 1
    assert loaded.current_version.dimensions[0].skills[0].name == "Java"


@pytest.mark.asyncio
async def test_recommend_standard_endpoint_returns_best_match(
    admin_client: AsyncClient,
    router_db_session: AsyncSession,
) -> None:
    org = await _get_router_org(router_db_session)
    await _create_standard_model(
        router_db_session,
        org_id=org.id,
        user_id=uuid.uuid4(),
        job_role="Java 后端工程师",
        industry_name="软件和信息服务",
        direction_name="工业软件",
    )

    response = await admin_client.post(
        "/api/job-models/models/recommend-standard",
        json={"job_text": "负责 Java 后端开发，熟悉 Spring Boot、MySQL、接口设计"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["job_role"] == "Java 后端工程师"
    assert body["direction_name"] == "工业软件"
    assert body["model_type"] == "standard"


@pytest.mark.asyncio
async def test_create_enterprise_copy_endpoint_clones_standard_model(
    admin_client: AsyncClient,
    router_db_session: AsyncSession,
) -> None:
    org = await _get_router_org(router_db_session)
    standard = await _create_standard_model(
        router_db_session,
        org_id=org.id,
        user_id=uuid.uuid4(),
        job_role="Java 后端工程师",
        industry_name="软件和信息服务",
        direction_name="工业软件",
    )

    response = await admin_client.post(
        f"/api/job-models/models/{standard.id}/create-enterprise-copy",
        json={"enterprise_name": "某企业后端岗位", "version_note": "初始企业版"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["job_model_id"]
    assert body["version_id"]
    assert "project_id" not in body

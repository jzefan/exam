"""Integration tests for agent-facing job model APIs."""

import uuid

import pytest
from sqlalchemy import select

from app.job_models.schemas import (
    DimensionCreate,
    JobModelCreate,
    SkillCreate,
    SkillKnowledgePointCreate,
)
from app.job_models.service import create_job_model
from app.rbac.models import UserOrganization


async def _primary_org_id(db_session, user_id: uuid.UUID) -> uuid.UUID:
    result = await db_session.execute(
        select(UserOrganization.org_id).where(
            UserOrganization.user_id == user_id,
            UserOrganization.is_primary.is_(True),
        )
    )
    return result.scalar_one()


async def _first_user_id_for_org(db_session, org_id: uuid.UUID) -> uuid.UUID:
    result = await db_session.execute(
        select(UserOrganization.user_id).where(UserOrganization.org_id == org_id)
    )
    return result.scalar_one()


async def _create_agent_model(db_session, org_id: uuid.UUID, user_id: uuid.UUID):
    model = await create_job_model(
        db_session,
        org_id=org_id,
        user_id=user_id,
        data=JobModelCreate(
            job_role="低空大数据分析师",
            model_type="standard",
            status="published",
            industry_name="低空产业",
            direction_name="数据应用类",
            source_type="manual",
            dimensions=[
                DimensionCreate(
                    name="数据分析能力",
                    description="面向低空业务场景的数据处理与洞察能力。",
                    sort_order=1,
                    skills=[
                        SkillCreate(
                            name="航飞数据治理",
                            level="L3",
                            description="清洗、标注、整合低空航飞数据。",
                            sort_order=1,
                            knowledge_points=[
                                SkillKnowledgePointCreate(
                                    name="轨迹数据清洗",
                                    difficulty="中级",
                                    teaching_suggestion="结合真实飞行轨迹样本进行异常点识别。",
                                    sort_order=1,
                                )
                            ],
                        )
                    ],
                )
            ],
        ),
    )
    await db_session.commit()
    return model


@pytest.mark.asyncio
async def test_agent_search_job_models_returns_compact_results(admin_client, router_db_session):
    org_id = router_db_session.info["current_org_id"]
    user_id = await _first_user_id_for_org(router_db_session, org_id)
    await _create_agent_model(router_db_session, org_id, user_id)

    response = await admin_client.get("/api/agent/job-models?q=低空大数据")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] >= 1
    first = body["items"][0]
    assert first["job_role"] == "低空大数据分析师"
    assert first["industry_name"] == "低空产业"
    assert first["direction_name"] == "数据应用类"
    assert first["current_version"]["version"] == 1


@pytest.mark.asyncio
async def test_agent_get_job_model_returns_nested_competency_tree(admin_client, router_db_session):
    org_id = router_db_session.info["current_org_id"]
    user_id = await _first_user_id_for_org(router_db_session, org_id)
    model = await _create_agent_model(router_db_session, org_id, user_id)

    response = await admin_client.get(f"/api/agent/job-models/{model.id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job_role"] == "低空大数据分析师"
    dimensions = body["current_version"]["dimensions"]
    assert dimensions[0]["name"] == "数据分析能力"
    assert dimensions[0]["skills"][0]["name"] == "航飞数据治理"
    assert dimensions[0]["skills"][0]["knowledge_points"][0]["name"] == "轨迹数据清洗"


@pytest.mark.asyncio
async def test_agent_export_job_model_as_markdown(admin_client, router_db_session):
    org_id = router_db_session.info["current_org_id"]
    user_id = await _first_user_id_for_org(router_db_session, org_id)
    model = await _create_agent_model(router_db_session, org_id, user_id)

    response = await admin_client.get(f"/api/agent/job-models/{model.id}/export?format=markdown")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/markdown")
    assert "# 低空大数据分析师" in response.text
    assert "## 数据分析能力" in response.text
    assert "- **航飞数据治理**" in response.text
    assert "轨迹数据清洗" in response.text


@pytest.mark.asyncio
async def test_agent_recommend_standard_model(monkeypatch, admin_client, router_db_session):
    from app.job_models import agent_router

    org_id = router_db_session.info["current_org_id"]
    user_id = await _first_user_id_for_org(router_db_session, org_id)
    model = await _create_agent_model(router_db_session, org_id, user_id)

    async def fake_recommend_standard_model(_db, text, requested_org_id):
        assert "大数据" in text
        assert requested_org_id == org_id
        loaded = await agent_router.get_job_model_by_id(_db, model.id)
        return loaded, "命中低空数据分析关键词", 0.87, ["大数据", "低空"]

    monkeypatch.setattr(agent_router, "recommend_standard_model", fake_recommend_standard_model)

    response = await admin_client.post(
        "/api/agent/job-models/recommend-standard",
        json={"job_text": "需要负责低空产业大数据分析和数据治理。"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model"]["job_role"] == "低空大数据分析师"
    assert body["confidence"] == 0.87
    assert body["matched_keywords"] == ["大数据", "低空"]


def test_agent_job_model_paths_are_in_openapi_schema():
    from app.main import app

    paths = app.openapi()["paths"]
    assert "/api/agent/job-models" in paths
    assert "/api/agent/job-models/{model_id}" in paths
    assert "/api/agent/job-models/{model_id}/export" in paths
    assert "/api/agent/job-models/drafts" in paths
    assert "/api/agent/job-models/{model_id}/publish" in paths
    assert "/api/agent/job-models/{model_id}/structure-preview" in paths
    assert "/api/agent/job-models/{model_id}/structure" in paths


@pytest.mark.asyncio
async def test_agent_create_draft_job_model(admin_client):
    response = await admin_client.post(
        "/api/agent/job-models/drafts",
        json={
            "job_role": "企业人工智能算法工程师",
            "model_type": "enterprise",
            "industry_name": "人工智能",
            "direction_name": "算法研发",
            "dimensions": [
                {
                    "name": "算法工程能力",
                    "description": "面向业务场景完成模型研发和工程化。",
                    "skills": [
                        {
                            "name": "深度学习模型训练",
                            "level": "L3",
                            "knowledge_points": [
                                {"name": "PyTorch 训练流程", "difficulty": "中级"}
                            ],
                        }
                    ],
                }
            ],
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["job_role"] == "企业人工智能算法工程师"
    assert body["status"] == "draft"
    assert body["model_type"] == "enterprise"
    assert body["current_version"]["dimensions"][0]["skills"][0]["knowledge_points"][0]["name"] == "PyTorch 训练流程"


@pytest.mark.asyncio
async def test_agent_publish_job_model_creates_new_current_version(admin_client, router_db_session):
    org_id = router_db_session.info["current_org_id"]
    user_id = await _first_user_id_for_org(router_db_session, org_id)
    model = await _create_agent_model(router_db_session, org_id, user_id)

    response = await admin_client.post(
        f"/api/agent/job-models/{model.id}/publish",
        json={"version_note": "agent reviewed"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "published"
    assert body["current_version"]["version"] == 2
    assert body["current_version"]["version_note"] == "agent reviewed"


@pytest.mark.asyncio
async def test_agent_structure_preview_does_not_modify_model(admin_client, router_db_session):
    org_id = router_db_session.info["current_org_id"]
    user_id = await _first_user_id_for_org(router_db_session, org_id)
    model = await _create_agent_model(router_db_session, org_id, user_id)

    response = await admin_client.post(
        f"/api/agent/job-models/{model.id}/structure-preview",
        json={
            "dimensions": [
                {
                    "name": "新能力维度",
                    "skills": [
                        {
                            "name": "新增技能",
                            "knowledge_points": [
                                {"name": "新增知识点"},
                                {"name": "另一个知识点"},
                            ],
                        }
                    ],
                }
            ]
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["current"] == {"dimensions": 1, "skills": 1, "knowledge_points": 1}
    assert body["proposed"] == {"dimensions": 1, "skills": 1, "knowledge_points": 2}
    assert body["will_write"] is False

    detail = await admin_client.get(f"/api/agent/job-models/{model.id}")
    assert detail.json()["current_version"]["dimensions"][0]["name"] == "数据分析能力"


@pytest.mark.asyncio
async def test_agent_apply_structure_replaces_draft_model_tree(admin_client):
    create_response = await admin_client.post(
        "/api/agent/job-models/drafts",
        json={
            "job_role": "企业大数据开发工程师",
            "model_type": "enterprise",
            "dimensions": [{"name": "旧维度", "skills": [{"name": "旧技能"}]}],
        },
    )
    model_id = create_response.json()["id"]

    response = await admin_client.put(
        f"/api/agent/job-models/{model_id}/structure",
        json={
            "dimensions": [
                {
                    "name": "数据平台开发",
                    "skills": [
                        {
                            "name": "Flink 实时计算",
                            "level": "L3",
                            "knowledge_points": [{"name": "窗口计算"}],
                        }
                    ],
                }
            ]
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    dimensions = body["current_version"]["dimensions"]
    assert len(dimensions) == 1
    assert dimensions[0]["name"] == "数据平台开发"
    assert dimensions[0]["skills"][0]["name"] == "Flink 实时计算"
    assert dimensions[0]["skills"][0]["knowledge_points"][0]["name"] == "窗口计算"


@pytest.mark.asyncio
async def test_agent_apply_structure_rejects_published_model(admin_client, router_db_session):
    org_id = router_db_session.info["current_org_id"]
    user_id = await _first_user_id_for_org(router_db_session, org_id)
    model = await _create_agent_model(router_db_session, org_id, user_id)

    response = await admin_client.put(
        f"/api/agent/job-models/{model.id}/structure",
        json={"dimensions": [{"name": "不应写入"}]},
    )

    assert response.status_code == 409
    assert "draft" in response.json()["detail"]

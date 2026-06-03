"""Integration tests for the job-course graph API."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelGraphLayout,
    JobModelVersion,
    Skill,
    SkillCourseMapping,
    SkillKpMapping,
    SkillKnowledgePoint,
)
from app.learning.models import Direction, KnowledgePoint, Major
from app.rbac.models import Organization, UserOrganization


async def _router_org(db: AsyncSession) -> Organization:
    org_id = db.info.get("current_org_id")
    assert org_id is not None
    org = await db.get(Organization, org_id)
    assert org is not None
    return org


async def _router_user_id(db: AsyncSession) -> uuid.UUID:
    org = await _router_org(db)
    result = await db.execute(
        select(UserOrganization.user_id).where(UserOrganization.org_id == org.id).limit(1)
    )
    user_id = result.scalar_one()
    return user_id


async def _create_graph_fixture(db: AsyncSession) -> dict[str, uuid.UUID]:
    org = await _router_org(db)
    user_id = await _router_user_id(db)

    model = JobModel(
        job_role="大数据开发工程师",
        model_type="enterprise",
        status="published",
        industry_name="软件和信息服务",
        direction_name="大数据",
        org_id=org.id,
        created_by=user_id,
    )
    db.add(model)
    await db.flush()

    version = JobModelVersion(
        job_model_id=model.id,
        version=1,
        version_note="图谱测试版本",
        is_current=True,
        source_type="manual",
        created_by=user_id,
    )
    db.add(version)
    await db.flush()
    model.current_version_id = version.id

    dimension = CompetencyDimension(
        model_version_id=version.id,
        name="数据处理",
        description="数据平台核心能力",
        sort_order=0,
    )
    db.add(dimension)
    await db.flush()

    skill = Skill(
        dimension_id=dimension.id,
        name="Spark 数据处理",
        level="L3",
        description="使用 Spark 完成批处理任务",
        sort_order=0,
    )
    db.add(skill)
    await db.flush()

    skill_kp = SkillKnowledgePoint(
        skill_id=skill.id,
        name="Spark SQL 优化",
        difficulty="中级",
        sort_order=0,
    )
    db.add(skill_kp)

    major = Major(name="计算机科学与技术", owner_id=user_id)
    db.add(major)
    await db.flush()

    direction = Direction(major_id=major.id, name="大数据技术", owner_id=user_id)
    db.add(direction)
    await db.flush()

    course = KnowledgePoint(
        name="大数据处理技术",
        parent_id=None,
        direction_id=direction.id,
        owner_id=user_id,
        tags=["课程"],
        difficulty="中级",
    )
    db.add(course)
    await db.flush()

    child = KnowledgePoint(
        name="Spark SQL",
        parent_id=course.id,
        direction_id=direction.id,
        owner_id=user_id,
        tags=["子知识点"],
        difficulty="中级",
    )
    db.add(child)
    await db.commit()

    return {
        "model_id": model.id,
        "version_id": version.id,
        "skill_id": skill.id,
        "skill_kp_id": skill_kp.id,
        "course_id": course.id,
        "course_kp_id": child.id,
    }


@pytest.mark.asyncio
async def test_graph_overview_returns_jobs_courses_and_empty_mappings(
    admin_client: AsyncClient,
    router_db_session: AsyncSession,
) -> None:
    ids = await _create_graph_fixture(router_db_session)

    response = await admin_client.get("/api/job-models/graph/overview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["layout"] is None
    assert payload["skill_course_mappings"] == []
    assert payload["jobs"] == [
        {
            "id": str(ids["model_id"]),
            "current_version_id": str(ids["version_id"]),
            "job_role": "大数据开发工程师",
            "model_type": "enterprise",
            "status": "published",
            "industry_name": "软件和信息服务",
            "direction_name": "大数据",
            "skill_count": 1,
            "version": 1,
        }
    ]
    assert payload["skills"] == [
        {
            "id": str(ids["skill_id"]),
            "job_model_id": str(ids["model_id"]),
            "dimension_name": "数据处理",
            "name": "Spark 数据处理",
            "level": "L3",
            "knowledge_point_count": 1,
            "course_mapping_count": 0,
        }
    ]
    assert payload["courses"] == [
        {
            "id": str(ids["course_id"]),
            "name": "大数据处理技术",
            "major_name": "计算机科学与技术",
            "direction_name": "大数据技术",
            "child_knowledge_point_count": 1,
            "mapped_skill_count": 0,
            "resource_count": 0,
        }
    ]


@pytest.mark.asyncio
async def test_create_skill_course_mapping_updates_overview(
    admin_client: AsyncClient,
    router_db_session: AsyncSession,
) -> None:
    ids = await _create_graph_fixture(router_db_session)

    create_response = await admin_client.post(
        "/api/job-models/graph/skill-course-mappings",
        json={
            "skill_id": str(ids["skill_id"]),
            "course_root_knowledge_point_id": str(ids["course_id"]),
            "relation_type": "required",
        },
    )

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["skill_id"] == str(ids["skill_id"])
    assert created["course_root_knowledge_point_id"] == str(ids["course_id"])
    assert created["status"] == "confirmed"
    assert created["match_type"] == "manual"

    overview_response = await admin_client.get("/api/job-models/graph/overview")
    assert overview_response.status_code == 200
    overview = overview_response.json()
    assert overview["skill_course_mappings"] == [
        {
            "id": created["id"],
            "skill_id": str(ids["skill_id"]),
            "course_root_knowledge_point_id": str(ids["course_id"]),
            "relation_type": "required",
            "match_type": "manual",
            "status": "confirmed",
            "source_type": "skill",
            "target_type": "course",
        }
    ]
    skill_card = next(item for item in overview["skills"] if item["id"] == str(ids["skill_id"]))
    course_card = next(item for item in overview["courses"] if item["id"] == str(ids["course_id"]))
    assert skill_card["course_mapping_count"] == 1
    assert course_card["mapped_skill_count"] == 1


@pytest.mark.asyncio
async def test_delete_skill_course_mapping_soft_deletes_related_kp_mappings(
    admin_client: AsyncClient,
    router_db_session: AsyncSession,
) -> None:
    ids = await _create_graph_fixture(router_db_session)
    user_id = await _router_user_id(router_db_session)

    mapping = SkillCourseMapping(
        skill_id=ids["skill_id"],
        course_root_knowledge_point_id=ids["course_id"],
        relation_type="required",
        match_type="manual",
        status="confirmed",
        created_by=user_id,
    )
    router_db_session.add(mapping)
    kp_mapping = SkillKpMapping(
        skill_kp_id=ids["skill_kp_id"],
        knowledge_point_id=ids["course_kp_id"],
        match_type="manual",
        relation_type="required",
        status="confirmed",
        confidence=1.0,
        created_by=user_id,
    )
    router_db_session.add(kp_mapping)
    await router_db_session.commit()

    delete_response = await admin_client.delete(
        f"/api/job-models/graph/skill-course-mappings/{mapping.id}"
    )

    assert delete_response.status_code == 204
    deleted_mapping = await router_db_session.get(SkillCourseMapping, mapping.id)
    assert deleted_mapping is not None
    assert deleted_mapping.deleted_at is not None
    result = await router_db_session.execute(
        select(SkillKpMapping).where(
            SkillKpMapping.skill_kp_id == ids["skill_kp_id"],
            SkillKpMapping.knowledge_point_id == ids["course_kp_id"],
        )
    )
    deleted_kp_mapping = result.scalar_one()
    assert deleted_kp_mapping.deleted_at is not None


@pytest.mark.asyncio
async def test_save_org_overview_layout_round_trips(
    admin_client: AsyncClient,
    router_db_session: AsyncSession,
) -> None:
    ids = await _create_graph_fixture(router_db_session)
    org = await _router_org(router_db_session)
    layout_json = {
        "nodes": {
            f"job:{ids['model_id']}": {"x": 120, "y": 80},
            f"course:{ids['course_id']}": {"x": 720, "y": 120},
        }
    }

    save_response = await admin_client.put(
        f"/api/job-models/graph/layouts/org_overview/{org.id}",
        json={"layout_json": layout_json},
    )

    assert save_response.status_code == 200
    saved = save_response.json()
    assert saved["scope_type"] == "org_overview"
    assert saved["scope_id"] == str(org.id)
    assert saved["layout_json"] == layout_json

    overview_response = await admin_client.get("/api/job-models/graph/overview")
    assert overview_response.status_code == 200
    assert overview_response.json()["layout"]["layout_json"] == layout_json

    result = await router_db_session.execute(
        select(JobModelGraphLayout).where(
            JobModelGraphLayout.scope_type == "org_overview",
            JobModelGraphLayout.scope_id == org.id,
        )
    )
    assert len(result.scalars().all()) == 1


@pytest.mark.asyncio
async def test_job_focus_flattens_dimensions_into_skills_and_knowledge_points(
    admin_client: AsyncClient,
    router_db_session: AsyncSession,
) -> None:
    ids = await _create_graph_fixture(router_db_session)
    user_id = await _router_user_id(router_db_session)
    mapping = SkillCourseMapping(
        skill_id=ids["skill_id"],
        course_root_knowledge_point_id=ids["course_id"],
        relation_type="required",
        match_type="manual",
        status="confirmed",
        created_by=user_id,
    )
    router_db_session.add(mapping)
    await router_db_session.commit()

    response = await admin_client.get(f"/api/job-models/graph/jobs/{ids['model_id']}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["job"]["id"] == str(ids["model_id"])
    assert payload["skills"] == [
        {
            "id": str(ids["skill_id"]),
            "job_model_id": str(ids["model_id"]),
            "dimension_name": "数据处理",
            "name": "Spark 数据处理",
            "level": "L3",
            "knowledge_point_count": 1,
            "course_mapping_count": 1,
        }
    ]
    assert payload["skill_knowledge_points"] == [
        {
            "id": str(ids["skill_kp_id"]),
            "skill_id": str(ids["skill_id"]),
            "name": "Spark SQL 优化",
            "difficulty": "中级",
        }
    ]
    assert payload["skill_course_mappings"][0]["id"] == str(mapping.id)


@pytest.mark.asyncio
async def test_course_focus_returns_first_level_children_and_linked_skills(
    admin_client: AsyncClient,
    router_db_session: AsyncSession,
) -> None:
    ids = await _create_graph_fixture(router_db_session)
    user_id = await _router_user_id(router_db_session)
    mapping = SkillCourseMapping(
        skill_id=ids["skill_id"],
        course_root_knowledge_point_id=ids["course_id"],
        relation_type="required",
        match_type="manual",
        status="confirmed",
        created_by=user_id,
    )
    router_db_session.add(mapping)
    router_db_session.add(
        SkillKpMapping(
            skill_kp_id=ids["skill_kp_id"],
            knowledge_point_id=ids["course_kp_id"],
            match_type="manual",
            relation_type="required",
            status="confirmed",
            confidence=1.0,
            created_by=user_id,
        )
    )
    await router_db_session.commit()

    response = await admin_client.get(f"/api/job-models/graph/courses/{ids['course_id']}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["course"]["id"] == str(ids["course_id"])
    assert payload["course"]["mapped_skill_count"] == 1
    assert payload["child_knowledge_points"] == [
        {
            "id": str(ids["course_kp_id"]),
            "course_root_id": str(ids["course_id"]),
            "parent_id": str(ids["course_id"]),
            "name": "Spark SQL",
            "mapped_skill_knowledge_point_count": 1,
        }
    ]
    assert payload["linked_skills"] == [
        {
            "skill_id": str(ids["skill_id"]),
            "skill_name": "Spark 数据处理",
            "job_model_id": str(ids["model_id"]),
            "job_role": "大数据开发工程师",
            "dimension_name": "数据处理",
        }
    ]

"""Tests for job_models service layer."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.rbac.models import Organization
from app.job_models.models import JobModelProject
from app.job_models.schemas import (
    DimensionCreate,
    JobModelCreate,
    ProjectCreate,
    ProjectUpdate,
    SkillCreate,
    SkillKnowledgePointCreate,
    TemplateCreate,
)
from app.job_models.service import (
    create_job_model,
    create_project,
    create_template,
    delete_project,
    get_job_model_by_id,
    get_project_by_id,
    get_template_by_id,
    list_projects,
    list_templates,
    publish_new_version,
    save_model_as_template,
    update_project,
)


@pytest.mark.asyncio
async def test_create_and_get_project(
    db_session: AsyncSession,
    org: Organization,
    user_id: uuid.UUID,
) -> None:
    project = await create_project(
        db_session,
        ProjectCreate(name="My Project", industry="Finance", description="A test project"),
        org_id=org.id,
        user_id=user_id,
    )
    assert project.id is not None
    assert project.name == "My Project"
    assert project.industry == "Finance"
    assert project.org_id == org.id
    assert project.created_by == user_id

    fetched = await get_project_by_id(db_session, project.id)
    assert fetched is not None
    assert fetched.id == project.id


@pytest.mark.asyncio
async def test_list_projects(
    db_session: AsyncSession,
    org: Organization,
    user_id: uuid.UUID,
) -> None:
    org2 = Organization(name="Other Org", type="enterprise", is_active=True)
    db_session.add(org2)
    await db_session.flush()

    await create_project(db_session, ProjectCreate(name="P1"), org_id=org.id, user_id=user_id)
    await create_project(db_session, ProjectCreate(name="P2"), org_id=org.id, user_id=user_id)
    await create_project(db_session, ProjectCreate(name="P3"), org_id=org2.id, user_id=user_id)

    projects, total = await list_projects(db_session, org_id=org.id)
    # There may be projects from other fixtures, just check at least 2 from this org
    assert total >= 2
    assert len(projects) >= 2
    assert all(p.org_id == org.id for p in projects)


@pytest.mark.asyncio
async def test_update_project(
    db_session: AsyncSession,
    project: JobModelProject,
) -> None:
    updated = await update_project(
        db_session,
        project,
        ProjectUpdate(name="Updated Name", status="published"),
    )
    assert updated.name == "Updated Name"
    assert updated.status == "published"


@pytest.mark.asyncio
async def test_soft_delete_project(
    db_session: AsyncSession,
    org: Organization,
    user_id: uuid.UUID,
) -> None:
    project = await create_project(
        db_session,
        ProjectCreate(name="To Delete"),
        org_id=org.id,
        user_id=user_id,
    )
    project_id = project.id
    await delete_project(db_session, project)

    fetched = await get_project_by_id(db_session, project_id)
    assert fetched is None


@pytest.mark.asyncio
async def test_create_job_model_with_hierarchy(
    db_session: AsyncSession,
    project: JobModelProject,
) -> None:
    data = JobModelCreate(
        job_role="Backend Engineer",
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
    model = await create_job_model(db_session, project.id, data)
    assert model.id is not None
    assert model.version == 1
    assert model.is_current is True

    loaded = await get_job_model_by_id(db_session, model.id)
    assert loaded is not None
    assert len(loaded.dimensions) == 1
    assert loaded.dimensions[0].name == "Programming"
    assert len(loaded.dimensions[0].skills) == 1
    assert loaded.dimensions[0].skills[0].name == "Python"
    assert len(loaded.dimensions[0].skills[0].knowledge_points) == 2


@pytest.mark.asyncio
async def test_publish_new_version(
    db_session: AsyncSession,
    project: JobModelProject,
) -> None:
    data = JobModelCreate(
        job_role="Data Scientist",
        dimensions=[
            DimensionCreate(
                name="Statistics",
                skills=[
                    SkillCreate(
                        name="Regression",
                        knowledge_points=[SkillKnowledgePointCreate(name="Linear Regression")],
                    )
                ],
            )
        ],
    )
    v1 = await create_job_model(db_session, project.id, data)
    assert v1.version == 1
    assert v1.is_current is True

    v2 = await publish_new_version(db_session, v1, version_note="Updated hierarchy")
    assert v2.version == 2
    assert v2.is_current is True
    assert v2.version_note == "Updated hierarchy"

    # Reload v1 to verify it's no longer current
    await db_session.refresh(v1)
    assert v1.is_current is False

    # v2 should have copied hierarchy
    loaded_v2 = await get_job_model_by_id(db_session, v2.id)
    assert loaded_v2 is not None
    assert len(loaded_v2.dimensions) == 1
    assert loaded_v2.dimensions[0].name == "Statistics"
    assert len(loaded_v2.dimensions[0].skills) == 1


@pytest.mark.asyncio
async def test_template_crud(
    db_session: AsyncSession,
    user_id: uuid.UUID,
) -> None:
    t1 = await create_template(
        db_session,
        TemplateCreate(name="Tech Template", industry="Technology", template_data={"dimensions": []}),
        user_id=user_id,
    )
    t2 = await create_template(
        db_session,
        TemplateCreate(name="Finance Template", industry="Finance", template_data={"dimensions": []}),
        user_id=user_id,
    )

    all_templates = await list_templates(db_session)
    assert len(all_templates) >= 2

    tech_templates = await list_templates(db_session, industry="Technology")
    assert any(t.id == t1.id for t in tech_templates)
    assert all(t.industry == "Technology" for t in tech_templates)

    finance_templates = await list_templates(db_session, industry="Finance")
    assert any(t.id == t2.id for t in finance_templates)

    fetched = await get_template_by_id(db_session, t1.id)
    assert fetched is not None
    assert fetched.name == "Tech Template"


@pytest.mark.asyncio
async def test_save_model_as_template(
    db_session: AsyncSession,
    project: JobModelProject,
    user_id: uuid.UUID,
) -> None:
    data = JobModelCreate(
        job_role="DevOps Engineer",
        dimensions=[
            DimensionCreate(
                name="Infrastructure",
                skills=[
                    SkillCreate(
                        name="Docker",
                        knowledge_points=[SkillKnowledgePointCreate(name="Containers")],
                    )
                ],
            )
        ],
    )
    model = await create_job_model(db_session, project.id, data)
    template = await save_model_as_template(db_session, model, name="DevOps Template", user_id=user_id)

    assert template.id is not None
    assert template.name == "DevOps Template"
    assert template.template_data is not None
    assert "dimensions" in template.template_data
    assert len(template.template_data["dimensions"]) == 1
    assert template.template_data["dimensions"][0]["name"] == "Infrastructure"
    assert len(template.template_data["dimensions"][0]["skills"]) == 1

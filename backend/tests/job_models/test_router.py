"""Integration tests for job model API routes."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_and_list_projects(admin_client: AsyncClient) -> None:
    # Create a project
    resp = await admin_client.post(
        "/api/job-models/projects",
        json={"name": "Test Project", "industry": "Tech", "description": "A test project"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Project"
    project_id = data["id"]

    # List projects
    resp = await admin_client.get("/api/job-models/projects")
    assert resp.status_code == 200
    projects = resp.json()
    ids = [p["id"] for p in projects]
    assert project_id in ids


@pytest.mark.asyncio
async def test_create_model_with_hierarchy(admin_client: AsyncClient) -> None:
    # Create project first
    resp = await admin_client.post(
        "/api/job-models/projects",
        json={"name": "Hierarchy Project"},
    )
    assert resp.status_code == 201
    project_id = resp.json()["id"]

    # Create model with nested dimensions/skills/kps
    model_payload = {
        "job_role": "Software Engineer",
        "source_type": "manual",
        "dimensions": [
            {
                "name": "Technical Skills",
                "sort_order": 0,
                "skills": [
                    {
                        "name": "Python",
                        "level": "L3",
                        "sort_order": 0,
                        "knowledge_points": [
                            {"name": "Async Programming", "difficulty": "中级", "sort_order": 0}
                        ],
                    }
                ],
            }
        ],
    }
    resp = await admin_client.post(
        f"/api/job-models/projects/{project_id}/models",
        json=model_payload,
    )
    assert resp.status_code == 201
    model_data = resp.json()
    assert model_data["job_role"] == "Software Engineer"
    assert len(model_data["dimensions"]) == 1
    dim = model_data["dimensions"][0]
    assert dim["name"] == "Technical Skills"
    assert len(dim["skills"]) == 1
    skill = dim["skills"][0]
    assert skill["name"] == "Python"
    assert len(skill["knowledge_points"]) == 1
    assert skill["knowledge_points"][0]["name"] == "Async Programming"


@pytest.mark.asyncio
async def test_get_model_detail(admin_client: AsyncClient) -> None:
    # Create project + model
    resp = await admin_client.post(
        "/api/job-models/projects",
        json={"name": "Detail Project"},
    )
    project_id = resp.json()["id"]

    resp = await admin_client.post(
        f"/api/job-models/projects/{project_id}/models",
        json={"job_role": "Data Analyst", "source_type": "manual"},
    )
    assert resp.status_code == 201
    model_id = resp.json()["id"]

    # GET model detail
    resp = await admin_client.get(f"/api/job-models/models/{model_id}")
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["id"] == model_id
    assert detail["job_role"] == "Data Analyst"
    assert detail["version"] == 1
    assert detail["is_current"] is True


@pytest.mark.asyncio
async def test_publish_new_version(admin_client: AsyncClient) -> None:
    # Create project + model
    resp = await admin_client.post(
        "/api/job-models/projects",
        json={"name": "Publish Project"},
    )
    project_id = resp.json()["id"]

    resp = await admin_client.post(
        f"/api/job-models/projects/{project_id}/models",
        json={"job_role": "DevOps Engineer", "source_type": "manual"},
    )
    model_id = resp.json()["id"]
    original_version = resp.json()["version"]

    # Publish new version
    resp = await admin_client.post(
        f"/api/job-models/models/{model_id}/publish",
        params={"version_note": "Added CI/CD skills"},
    )
    assert resp.status_code == 200
    new_model = resp.json()
    assert new_model["version"] == original_version + 1
    assert new_model["is_current"] is True


@pytest.mark.asyncio
async def test_template_crud(admin_client: AsyncClient) -> None:
    # Create template
    resp = await admin_client.post(
        "/api/job-models/templates",
        json={
            "name": "Backend Engineer Template",
            "industry": "Tech",
            "template_data": {"job_role": "Backend Engineer", "dimensions": []},
        },
    )
    assert resp.status_code == 201
    template_id = resp.json()["id"]

    # List templates
    resp = await admin_client.get("/api/job-models/templates")
    assert resp.status_code == 200
    templates = resp.json()
    ids = [t["id"] for t in templates]
    assert template_id in ids
    assert len(templates) >= 1


@pytest.mark.asyncio
async def test_project_not_found(admin_client: AsyncClient) -> None:
    import uuid

    fake_id = str(uuid.uuid4())
    resp = await admin_client.get(f"/api/job-models/projects/{fake_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_unauthenticated_request(client: AsyncClient) -> None:
    resp = await client.get("/api/job-models/projects")
    assert resp.status_code in (401, 403)

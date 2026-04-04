"""Integration tests for the AI pipeline router."""

import uuid
from io import BytesIO
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_pipeline.pipeline import PipelineStatus
from app.job_models.models import JobModelProject
from app.rbac.models import Organization


@pytest.fixture
async def org(db_session: AsyncSession) -> Organization:
    organization = Organization(name="Router Test Org", type="enterprise", is_active=True)
    db_session.add(organization)
    await db_session.flush()
    return organization


@pytest.fixture
async def project(db_session: AsyncSession, org: Organization, admin_token: str) -> JobModelProject:
    # We need the admin user's org_id to match. Get user org from admin_token.
    # Instead, create project with org from conftest admin fixture.
    # Query the org created by admin_token fixture.
    from sqlalchemy import select
    from app.rbac.models import UserOrganization

    result = await db_session.execute(select(UserOrganization).limit(1))
    user_org = result.scalar_one_or_none()

    if user_org is None:
        proj = JobModelProject(name="Test Project", org_id=org.id, created_by=None)
    else:
        proj = JobModelProject(name="Test Project", org_id=user_org.org_id, created_by=None)

    db_session.add(proj)
    await db_session.flush()
    await db_session.commit()
    return proj


@pytest.mark.asyncio
async def test_upload_document_success(admin_client: AsyncClient, project: JobModelProject) -> None:
    """POST /upload with valid file + project_id returns 202 with document_id."""
    test_file_content = b"Job Title: Software Engineer\nRequirements: Python, FastAPI"

    with patch("app.ai_pipeline.router.process_document_background"):
        resp = await admin_client.post(
            "/api/ai-pipeline/documents/upload",
            params={"project_id": str(project.id)},
            files={"file": ("test.txt", BytesIO(test_file_content), "text/plain")},
        )

    assert resp.status_code == 202, resp.text
    data = resp.json()
    assert "document_id" in data
    assert data["status"] == "extracting"
    assert data["message"] == "Document processing started"
    # Validate document_id is a valid UUID
    uuid.UUID(data["document_id"])


@pytest.mark.asyncio
async def test_upload_document_no_file(admin_client: AsyncClient, project: JobModelProject) -> None:
    """POST /upload without file returns 422 (missing required field)."""
    resp = await admin_client.post(
        "/api/ai-pipeline/documents/upload",
        params={"project_id": str(project.id)},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_document_project_not_found(admin_client: AsyncClient) -> None:
    """POST /upload with invalid project_id returns 404."""
    test_file_content = b"Some JD content"
    non_existent_project_id = uuid.uuid4()

    resp = await admin_client.post(
        "/api/ai-pipeline/documents/upload",
        params={"project_id": str(non_existent_project_id)},
        files={"file": ("test.txt", BytesIO(test_file_content), "text/plain")},
    )

    assert resp.status_code == 404
    assert "Project not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_get_progress_success(admin_client: AsyncClient) -> None:
    """GET /progress returns ProgressResponse with status/step/progress."""
    document_id = uuid.uuid4()
    PipelineStatus.create_job(document_id)
    PipelineStatus.update_job(document_id, "llm_extract", 30, status="processing")

    resp = await admin_client.get(f"/api/ai-pipeline/documents/{document_id}/progress")

    assert resp.status_code == 200
    data = resp.json()
    assert data["document_id"] == str(document_id)
    assert data["step"] == "llm_extract"
    assert data["progress"] == 30
    assert data["status"] == "processing"

    # Cleanup
    PipelineStatus.clear_job(document_id)


@pytest.mark.asyncio
async def test_get_progress_not_found(admin_client: AsyncClient) -> None:
    """GET /progress for non-existent document_id returns 404."""
    non_existent_id = uuid.uuid4()
    resp = await admin_client.get(f"/api/ai-pipeline/documents/{non_existent_id}/progress")

    assert resp.status_code == 404
    assert "Document not found" in resp.json()["detail"]

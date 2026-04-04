"""Unit tests for AI pipeline Pydantic schemas."""

import uuid

import pytest

from app.ai_pipeline.schemas import DocumentUploadResponse, GeneratedModelResponse, ProgressResponse


@pytest.mark.unit
def test_document_upload_response() -> None:
    doc_id = uuid.uuid4()
    response = DocumentUploadResponse(document_id=doc_id, status="extracting", message="Document processing started")
    assert response.document_id == doc_id
    assert response.status == "extracting"
    assert response.message == "Document processing started"


@pytest.mark.unit
def test_progress_response_processing() -> None:
    doc_id = uuid.uuid4()
    response = ProgressResponse(
        document_id=doc_id,
        step="llm_extract",
        progress=30,
        status="processing",
    )
    assert response.document_id == doc_id
    assert response.step == "llm_extract"
    assert response.progress == 30
    assert response.status == "processing"
    assert response.result is None
    assert response.error_message is None


@pytest.mark.unit
def test_progress_response_error() -> None:
    doc_id = uuid.uuid4()
    response = ProgressResponse(
        document_id=doc_id,
        step="error",
        progress=50,
        status="error",
        error_message="LLM API timeout",
    )
    assert response.status == "error"
    assert response.error_message == "LLM API timeout"
    assert response.step == "error"

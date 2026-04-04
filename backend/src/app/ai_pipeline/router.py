"""FastAPI router for AI pipeline document upload and processing."""

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_pipeline.extraction import DocumentExtractor
from app.ai_pipeline.llm_service import LLMClient, LLMPipeline
from app.ai_pipeline.pipeline import DocumentProcessingPipeline, PipelineStatus
from app.ai_pipeline.schemas import DocumentUploadResponse, ProgressResponse
from app.ai_pipeline.vector_search import VectorSearchService
from app.auth.dependencies import CurrentUser
from app.config import settings
from app.database import get_db
from app.job_models.models import JobModelProject, SourceDocument
from app.rbac.dependencies import CurrentOrgId

router = APIRouter()


async def process_document_background(
    document_id: uuid.UUID,
    file_content: bytes,
    file_name: str,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """Background task for document processing."""
    from io import BytesIO

    from fastapi import UploadFile as FUploadFile

    upload_file = FUploadFile(filename=file_name, file=BytesIO(file_content))
    try:
        llm_client = LLMClient(
            api_key=settings.deepseek_api_key or "",
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model_name,
        )

        pipeline = DocumentProcessingPipeline(
            extractor=DocumentExtractor(),
            llm_pipeline=LLMPipeline(llm_client, db),
            vector_search=VectorSearchService(db),
            db=db,
        )

        await pipeline.process_document(
            document_id=document_id,
            upload_file=upload_file,
            project_id=project_id,
            user_id=user_id,
        )

        await db.commit()
    except Exception as e:
        await db.rollback()
        PipelineStatus.update_job(
            document_id,
            "error",
            0,
            status="error",
            error_message=str(e),
        )


@router.post(
    "/documents/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    project_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File(...)],
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: CurrentOrgId,
) -> DocumentUploadResponse:
    """
    Upload a JD document and start async processing.

    Returns: 202 Accepted with document_id and status "extracting"

    Supported formats: .pdf, .docx, .doc, .png, .jpg, .jpeg
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must have a filename",
        )

    # Verify project exists and belongs to org
    result = await db.execute(
        select(JobModelProject).where(
            JobModelProject.id == project_id,
            JobModelProject.org_id == org_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found or access denied",
        )

    # Create SourceDocument record
    doc_id = uuid.uuid4()
    file_ext = file.filename.split(".")[-1].lower() if "." in file.filename else "unknown"
    src_doc = SourceDocument(
        id=doc_id,
        project_id=project_id,
        file_name=file.filename,
        file_path=f"/uploads/{doc_id}/{file.filename}",
        file_type=file_ext,
        uploaded_by=user.id,
    )
    db.add(src_doc)
    await db.flush()
    await db.commit()

    # Read file contents before background task (UploadFile may not be readable after response)
    file_content = await file.read()

    # Start async processing in background
    background_tasks.add_task(
        process_document_background,
        doc_id,
        file_content,
        file.filename,
        project_id,
        user.id,
        db,
    )

    return DocumentUploadResponse(
        document_id=doc_id,
        status="extracting",
        message="Document processing started",
    )


@router.get("/documents/{document_id}/progress", response_model=ProgressResponse)
async def get_progress(
    document_id: uuid.UUID,
    user: CurrentUser,
) -> ProgressResponse:
    """
    Poll for document processing progress.

    Returns current step, progress percentage, and status (processing/success/error).
    """
    job = PipelineStatus.get_job(document_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found or not yet started",
        )

    return ProgressResponse(
        document_id=document_id,
        step=job["step"],
        progress=job["progress"],
        status=job["status"],
        result=job["result"],
        error_message=job["error_message"],
    )

from io import BytesIO
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import UploadFile

from app.ai_pipeline.extraction import DocumentExtractor


@pytest.mark.asyncio
async def test_extract_pdf_success() -> None:
    with patch("pdfplumber.open") as mock_pdf:
        mock_page = Mock()
        mock_page.extract_text.return_value = "Job: Software Engineer"
        mock_pdf.return_value.__enter__.return_value.pages = [mock_page]

        result = await DocumentExtractor.extract_text_from_pdf(b"fake pdf")
        assert "Software Engineer" in result


@pytest.mark.asyncio
async def test_extract_pdf_error() -> None:
    with patch("pdfplumber.open", side_effect=Exception("corrupt file")):
        with pytest.raises(ValueError, match="PDF extraction failed"):
            await DocumentExtractor.extract_text_from_pdf(b"bad pdf")


@pytest.mark.asyncio
async def test_extract_docx_success() -> None:
    with patch("app.ai_pipeline.extraction.Document") as mock_doc_cls:
        mock_para1 = Mock()
        mock_para1.text = "Senior Python Developer"
        mock_para2 = Mock()
        mock_para2.text = "5+ years experience required"
        mock_doc_cls.return_value.paragraphs = [mock_para1, mock_para2]

        result = await DocumentExtractor.extract_text_from_docx(b"fake docx")
        assert "Senior Python Developer" in result
        assert "5+ years experience required" in result


@pytest.mark.asyncio
async def test_extract_docx_error() -> None:
    with patch("app.ai_pipeline.extraction.Document", side_effect=Exception("invalid docx")):
        with pytest.raises(ValueError, match="DOCX extraction failed"):
            await DocumentExtractor.extract_text_from_docx(b"bad docx")


@pytest.mark.asyncio
async def test_extract_unsupported_file_type() -> None:
    upload_file = Mock(spec=UploadFile)
    upload_file.filename = "resume.txt"
    upload_file.read = AsyncMock(return_value=b"plain text content")

    with pytest.raises(ValueError, match="Unsupported file type"):
        await DocumentExtractor.extract_text(upload_file)

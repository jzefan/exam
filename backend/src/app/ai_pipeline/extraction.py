import io
from pathlib import Path

import pdfplumber
from docx import Document
from fastapi import UploadFile


class DocumentExtractor:
    """Service for extracting text from various document formats."""

    @staticmethod
    async def extract_text_from_pdf(file_bytes: bytes) -> str:
        """Extract text from PDF using pdfplumber."""
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            return text.strip()
        except Exception as e:
            raise ValueError(f"PDF extraction failed: {str(e)}")

    @staticmethod
    async def extract_text_from_docx(file_bytes: bytes) -> str:
        """Extract text from Word document (.docx or .doc)."""
        try:
            doc = Document(io.BytesIO(file_bytes))
            text = "\n".join(para.text for para in doc.paragraphs)
            return text.strip()
        except Exception as e:
            raise ValueError(f"DOCX extraction failed: {str(e)}")

    @staticmethod
    async def extract_text_from_image(file_bytes: bytes) -> str:
        """Extract text from image using LLM vision (DeepSeek-VL/Qwen-VL)."""
        # Phase 3 v1: Return placeholder message
        # Phase 4+: implement actual multi-modal LLM call
        return "[Image OCR not yet implemented - please convert image to PDF or Word format]"

    @staticmethod
    async def extract_text(upload_file: UploadFile) -> str:
        """
        Main extraction method: routes to appropriate extractor based on file type.
        Supported: .pdf, .docx, .doc, .png, .jpg, .jpeg
        """
        if not upload_file.filename:
            raise ValueError("File must have a filename")

        file_bytes = await upload_file.read()
        if not file_bytes:
            raise ValueError("File is empty")

        file_ext = Path(upload_file.filename).suffix.lower()

        if file_ext == ".pdf":
            return await DocumentExtractor.extract_text_from_pdf(file_bytes)
        elif file_ext in (".docx", ".doc"):
            return await DocumentExtractor.extract_text_from_docx(file_bytes)
        elif file_ext in (".png", ".jpg", ".jpeg"):
            return await DocumentExtractor.extract_text_from_image(file_bytes)
        else:
            raise ValueError(
                f"Unsupported file type: {file_ext}. Supported: .pdf, .docx, .doc, .png, .jpg, .jpeg"
            )

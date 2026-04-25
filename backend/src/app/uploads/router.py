import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse


router = APIRouter()

UPLOAD_DIR = Path(__file__).resolve().parents[3] / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
ALLOWED_DOC_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_FILE_TYPES = ALLOWED_IMAGE_TYPES | ALLOWED_DOC_TYPES
MAX_FILE_SIZE = 10 * 1024 * 1024


@router.post("/image")
async def upload_image(file: UploadFile) -> dict[str, str]:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {file.content_type}。支持: png, jpeg, gif, webp",
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="文件大小不能超过 10MB")

    ext = Path(file.filename or "image.png").suffix or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(contents)

    return {"url": f"/api/uploads/files/{filename}"}


@router.post("/file")
async def upload_file(file: UploadFile) -> dict[str, str]:
    if file.content_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="不支持的文件类型，仅支持图片与 Word(docx) 文件。",
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="文件大小不能超过 10MB")

    ext = Path(file.filename or "attachment").suffix or (
        ".docx" if file.content_type in ALLOWED_DOC_TYPES else ".png"
    )
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(contents)

    return {"url": f"/api/uploads/files/{filename}"}


@router.get("/files/{filename}")
async def serve_file(filename: str) -> FileResponse:
    safe_name = Path(filename).name
    filepath = UPLOAD_DIR / safe_name
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(filepath)

"""OCR adapter for knowledge catalog import."""

import asyncio
import base64
import os
import tempfile
from pathlib import Path
from typing import Any


class OCREngineUnavailable(RuntimeError):
    """Raised when the backend OCR engine is not installed or cannot start."""


_paddle_ocr: Any | None = None
_ocr_semaphore: asyncio.Semaphore | None = None
_DEFAULT_OCR_CACHE_DIR = "/tmp/exam-paddleocr-cache"


def _strip_image_data_url(image: str) -> str:
    if "," in image and image.strip().lower().startswith("data:"):
        return image.split(",", 1)[1]
    return image


def _get_paddle_ocr() -> Any:
    global _paddle_ocr
    if _paddle_ocr is not None:
        return _paddle_ocr

    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", _DEFAULT_OCR_CACHE_DIR)
    os.environ.setdefault("PADDLE_HOME", _DEFAULT_OCR_CACHE_DIR)
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise OCREngineUnavailable("PaddleOCR is not installed") from exc

    try:
        _paddle_ocr = PaddleOCR(
            lang="ch",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=True,
        )
    except TypeError:
        _paddle_ocr = PaddleOCR(use_angle_cls=True, lang="ch")
    except Exception as exc:
        raise OCREngineUnavailable("PaddleOCR failed to initialize") from exc
    return _paddle_ocr


def _get_ocr_semaphore() -> asyncio.Semaphore:
    global _ocr_semaphore
    if _ocr_semaphore is None:
        concurrency = max(1, int(os.environ.get("PADDLE_OCR_MAX_CONCURRENCY", "3")))
        _ocr_semaphore = asyncio.Semaphore(concurrency)
    return _ocr_semaphore


def _collect_paddle_text(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        texts: list[str] = []
        for key in ("rec_texts", "texts"):
            items = value.get(key)
            if isinstance(items, list):
                texts.extend(str(item).strip() for item in items if str(item).strip())
        text = value.get("text")
        if isinstance(text, str) and text.strip():
            texts.append(text.strip())
        for item in value.values():
            texts.extend(_collect_paddle_text(item))
        return texts
    if isinstance(value, tuple) and len(value) >= 2:
        maybe_text = value[0]
        if isinstance(maybe_text, str) and maybe_text.strip():
            return [maybe_text.strip()]
        maybe_pair = value[1]
        if isinstance(maybe_pair, tuple) and maybe_pair and isinstance(maybe_pair[0], str):
            return [maybe_pair[0].strip()]
    if isinstance(value, list):
        texts: list[str] = []
        for item in value:
            texts.extend(_collect_paddle_text(item))
        return texts
    return []


def _recognize_image_text_sync(image: str) -> str:
    image_bytes = base64.b64decode(_strip_image_data_url(image), validate=False)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
        temp_file.write(image_bytes)
        temp_path = Path(temp_file.name)

    try:
        ocr = _get_paddle_ocr()
        try:
            result = ocr.ocr(str(temp_path), cls=True)
        except TypeError:
            result = ocr.ocr(str(temp_path))
        return "\n".join(dict.fromkeys(_collect_paddle_text(result))).strip()
    finally:
        temp_path.unlink(missing_ok=True)


async def recognize_image_text(image: str) -> str:
    """Recognize text from a base64 image using PaddleOCR."""

    async with _get_ocr_semaphore():
        return await asyncio.to_thread(_recognize_image_text_sync, image)


async def warmup_ocr_engine() -> None:
    """Best-effort OCR model warmup to avoid a cold first request."""

    try:
        async with _get_ocr_semaphore():
            await asyncio.to_thread(_get_paddle_ocr)
    except OCREngineUnavailable:
        return

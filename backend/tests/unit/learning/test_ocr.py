import asyncio

import pytest

from app.learning import ocr


@pytest.mark.asyncio
async def test_warmup_ocr_engine_initializes_paddle_in_background_thread(monkeypatch) -> None:
    calls: list[str] = []

    def fake_get_paddle_ocr():
        calls.append("get")
        return object()

    async def fake_to_thread(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    monkeypatch.setattr(ocr, "_get_paddle_ocr", fake_get_paddle_ocr)
    monkeypatch.setattr(ocr.asyncio, "to_thread", fake_to_thread)

    await ocr.warmup_ocr_engine()

    assert calls == ["get"]


@pytest.mark.asyncio
async def test_recognize_image_text_limits_concurrency_to_one(monkeypatch) -> None:
    current = 0
    max_seen = 0
    ocr._ocr_semaphore = asyncio.Semaphore(1)

    def fake_recognize_sync(image: str) -> str:
        return image

    async def fake_to_thread(fn, *args, **kwargs):
        nonlocal current, max_seen
        current += 1
        max_seen = max(max_seen, current)
        try:
            await asyncio.sleep(0.01)
            return fn(*args, **kwargs)
        finally:
            current -= 1

    monkeypatch.setattr(ocr, "_recognize_image_text_sync", fake_recognize_sync)
    monkeypatch.setattr(ocr.asyncio, "to_thread", fake_to_thread)

    results = await asyncio.gather(
        ocr.recognize_image_text("image-a"),
        ocr.recognize_image_text("image-b"),
    )

    assert results == ["image-a", "image-b"]
    assert max_seen == 1

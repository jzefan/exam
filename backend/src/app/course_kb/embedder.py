"""Text embedder for the course knowledge base.

Calls an OpenAI-compatible ``/embeddings`` endpoint (default: Qwen/DashScope
``text-embedding-v3``, 1024 dims — credentials reused from existing settings).
Batches ≤16 texts per call with exponential-backoff retries, mirroring the
ArkLoop Embedder contract: texts in → vectors out.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_BATCH_SIZE = 16
_MAX_RETRIES = 3
_MAX_CHARS_PER_TEXT = 6000  # provider input limit guard


class EmbeddingUnavailable(Exception):
    """Raised when no embedding credentials are configured or calls keep failing."""


def _resolve_endpoint() -> tuple[str, str]:
    """Return (embeddings_url, api_key) from settings, provider-aware."""
    base_url = settings.kb_embedding_base_url.strip()
    api_key = settings.kb_embedding_api_key.strip()
    if not base_url or not api_key:
        provider = settings.kb_embedding_provider.strip().lower()
        if provider == "doubao":
            base_url = base_url or settings.doubao_base_url
            api_key = api_key or (settings.doubao_api_key or "")
        else:  # default qwen / dashscope
            base_url = base_url or settings.qwen_base_url
            api_key = api_key or (settings.qwen_api_key or "")
    if not api_key:
        raise EmbeddingUnavailable("未配置可用的 embedding API Key（kb_embedding_* 或 qwen/doubao）。")
    normalized = base_url.rstrip("/")
    if not normalized.endswith("/embeddings"):
        normalized = f"{normalized}/embeddings"
    return normalized, api_key


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts in order. Raises EmbeddingUnavailable when the provider fails."""
    if not texts:
        return []
    url, api_key = _resolve_endpoint()
    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        for start in range(0, len(texts), _BATCH_SIZE):
            batch = [t[:_MAX_CHARS_PER_TEXT] for t in texts[start : start + _BATCH_SIZE]]
            vectors.extend(await _embed_batch(client, url, api_key, batch))
    return vectors


async def _embed_batch(client: httpx.AsyncClient, url: str, api_key: str, batch: list[str]) -> list[list[float]]:
    last_error: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": settings.kb_embedding_model, "input": batch, "encoding_format": "float"},
            )
            response.raise_for_status()
            payload = response.json()
            rows = sorted(payload.get("data", []), key=lambda item: item.get("index", 0))
            if len(rows) != len(batch):
                raise EmbeddingUnavailable(f"embedding 返回数量不符：{len(rows)} != {len(batch)}")
            return [row["embedding"] for row in rows]
        except (httpx.HTTPError, KeyError, ValueError) as exc:  # noqa: PERF203
            last_error = exc
            logger.warning("embedding batch failed (attempt %d/%d): %s", attempt + 1, _MAX_RETRIES, exc)
            await asyncio.sleep(1.5**attempt)
    raise EmbeddingUnavailable(f"embedding 调用失败：{last_error}")


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = num_a = num_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        num_a += x * x
        num_b += y * y
    if num_a <= 0.0 or num_b <= 0.0:
        return 0.0
    return dot / ((num_a**0.5) * (num_b**0.5))

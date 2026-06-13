"""Course KB service: ingestion pipeline + scoped RAG retrieval.

Ingest:   chunk → embed → replace chunks for the material → mark status.
Retrieve: embed query → cosine top-k over scoped chunks (keyword fallback
          when embeddings are unavailable), formatted with provenance.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.course_kb.chunker import chunk_material, estimate_tokens
from app.course_kb.embedder import EmbeddingUnavailable, cosine_similarity, embed_texts
from app.course_kb.models import CourseMaterialChunk
from app.database import async_session
from app.job_models.models import LearningResource
from app.learning.models import KnowledgePoint

logger = logging.getLogger(__name__)

_MAX_TREE_DEPTH = 16
_DEFAULT_TOP_K = 12
_CHUNK_TYPE_LABEL = {"text": "正文", "code": "代码", "formula": "公式", "table": "表格"}


# --------------------------------------------------------------------------- #
# Ingestion
# --------------------------------------------------------------------------- #
async def ingest_material_text(
    *,
    resource_id: uuid.UUID,
    course_kp_id: uuid.UUID,
    material_text: str,
    session_factory=async_session,
) -> None:
    """Run the full ingest pipeline in its own sessions (safe as a background task).

    ``session_factory`` is injectable for tests; defaults to the app sessionmaker.
    """
    async with session_factory() as db:
        resource = await db.get(LearningResource, resource_id)
        if resource is None:
            return
        resource.kb_status = "processing"
        resource.kb_error = None
        await db.commit()

    try:
        chunks = chunk_material(material_text)
        embeddings: list[list[float] | None]
        embedding_model: str | None = settings.kb_embedding_model
        try:
            embeddings = list(await embed_texts([chunk.text for chunk in chunks]))
        except EmbeddingUnavailable as exc:
            # Chunks remain usable through the keyword fallback ranking.
            logger.warning("KB ingest: embeddings unavailable for %s: %s", resource_id, exc)
            embeddings = [None] * len(chunks)
            embedding_model = None

        async with session_factory() as db:
            resource = await db.get(LearningResource, resource_id)
            if resource is None:
                return
            await db.execute(delete(CourseMaterialChunk).where(CourseMaterialChunk.resource_id == resource_id))
            db.add_all(
                CourseMaterialChunk(
                    resource_id=resource_id,
                    course_kp_id=course_kp_id,
                    node_id=resource.node_id,
                    ordinal=chunk.ordinal,
                    heading_path=list(chunk.heading_path),
                    chunk_type=chunk.chunk_type,
                    text=chunk.text,
                    token_count=chunk.token_count,
                    embedding=embeddings[index],
                    embedding_model=embedding_model if embeddings[index] is not None else None,
                )
                for index, chunk in enumerate(chunks)
            )
            resource.kb_status = "ready"
            resource.kb_error = None if embedding_model else "向量化暂不可用，已按关键词检索降级"
            resource.kb_chunk_count = len(chunks)
            await db.commit()
        logger.info(
            "KB ingest done: resource=%s chunks=%d embedded=%s", resource_id, len(chunks), bool(embedding_model)
        )
    except Exception as exc:  # noqa: BLE001 - pipeline failure must land on the material
        logger.exception("KB ingest failed for %s", resource_id)
        async with session_factory() as db:
            resource = await db.get(LearningResource, resource_id)
            if resource is not None:
                resource.kb_status = "failed"
                resource.kb_error = str(exc)[:500]
                await db.commit()


# --------------------------------------------------------------------------- #
# Retrieval
# --------------------------------------------------------------------------- #
@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    text: str
    heading_path: tuple[str, ...]
    chunk_type: str
    resource_id: uuid.UUID
    score: float


async def course_node_ids(db: AsyncSession, course_kp_id: uuid.UUID) -> list[uuid.UUID]:
    """The course root + all descendant knowledge-point ids."""
    node_ids: list[uuid.UUID] = [course_kp_id]
    seen = {course_kp_id}
    frontier = [course_kp_id]
    for _ in range(_MAX_TREE_DEPTH):
        if not frontier:
            break
        rows = (
            (
                await db.execute(
                    select(KnowledgePoint.id).where(
                        KnowledgePoint.parent_id.in_(frontier), KnowledgePoint.deleted_at.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        frontier = [row for row in rows if row not in seen]
        seen.update(frontier)
        node_ids.extend(frontier)
    return node_ids


def _keyword_score(query: str, text: str) -> float:
    """Cheap fallback ranking: fraction of query bigrams present in the text."""
    grams = {query[i : i + 2] for i in range(len(query) - 1) if query[i : i + 2].strip()}
    if not grams:
        return 0.0
    hits = sum(1 for gram in grams if gram in text)
    return hits / len(grams)


async def search_chunks(
    db: AsyncSession,
    *,
    course_kp_id: uuid.UUID,
    query: str,
    k: int = _DEFAULT_TOP_K,
    scope_node_ids: list[uuid.UUID] | None = None,
) -> list[RetrievedChunk]:
    """Top-k chunks for the query, scoped to the course (or given chapter nodes)."""
    node_ids = scope_node_ids if scope_node_ids else await course_node_ids(db, course_kp_id)
    stmt = select(CourseMaterialChunk).where(
        CourseMaterialChunk.course_kp_id == course_kp_id,
        CourseMaterialChunk.node_id.in_(node_ids),
        CourseMaterialChunk.deleted_at.is_(None),
    )
    chunks = list((await db.execute(stmt)).scalars().all())
    if not chunks:
        return []

    query_vector: list[float] | None = None
    if any(chunk.embedding for chunk in chunks):
        try:
            query_vector = (await embed_texts([query]))[0]
        except EmbeddingUnavailable:
            query_vector = None

    scored: list[tuple[float, CourseMaterialChunk]] = []
    for chunk in chunks:
        if query_vector is not None and chunk.embedding:
            score = cosine_similarity(query_vector, chunk.embedding)
        else:
            score = _keyword_score(query, chunk.text)
        scored.append((score, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)

    return [
        RetrievedChunk(
            text=chunk.text,
            heading_path=tuple(chunk.heading_path or []),
            chunk_type=chunk.chunk_type,
            resource_id=chunk.resource_id,
            score=round(score, 4),
        )
        for score, chunk in scored[: max(k, 1)]
        if score > 0
    ]


def format_rag_block(retrieved: list[RetrievedChunk], *, max_chars: int = 24000) -> str:
    """Render retrieved chunks as a grounded, provenance-carrying prompt block."""
    lines: list[str] = []
    for index, item in enumerate(retrieved, start=1):
        source = " > ".join(item.heading_path) if item.heading_path else "未标注章节"
        label = _CHUNK_TYPE_LABEL.get(item.chunk_type, item.chunk_type)
        lines.append(f"[片段{index} · {label} · 出处：{source}]\n{item.text}")
    return "\n\n".join(lines)[:max_chars]


async def search_chunks_standalone(
    *, course_kp_id: uuid.UUID, query: str, k: int = _DEFAULT_TOP_K
) -> list[RetrievedChunk]:
    """Convenience wrapper that opens its own session (for callers without one)."""
    async with async_session() as db:
        return await search_chunks(db, course_kp_id=course_kp_id, query=query, k=k)


def estimate_corpus_tokens(texts: list[str]) -> int:
    return sum(estimate_tokens(text) for text in texts)

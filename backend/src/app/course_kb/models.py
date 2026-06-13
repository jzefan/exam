"""ORM model for course knowledge-base chunks (the vector retrieval layer)."""

from __future__ import annotations

import uuid

from sqlalchemy import JSON, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models import BaseModel


class CourseMaterialChunk(BaseModel):
    """One retrieval unit extracted from a course material.

    ``embedding`` is a JSON float array (host Postgres lacks pgvector); ranking
    happens in Python at course scale. ``heading_path`` preserves the chapter
    trail (e.g. ["第三章 程序流程控制", "3.2 循环结构"]) for provenance.
    """

    __tablename__ = "course_material_chunks"

    resource_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    course_kp_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    node_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    heading_path: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    chunk_type: Mapped[str] = mapped_column(String(20), nullable=False, default="text")
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(100), nullable=True)

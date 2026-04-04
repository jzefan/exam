"""SQLAlchemy models for the AI pipeline feature.

Note on embedding storage:
- In PostgreSQL production, the Alembic migration converts the `embedding` column
  to a pgvector `vector(1536)` type for efficient cosine/L2 distance queries.
- In SQLite (tests / local dev), the column remains TEXT and embeddings are stored
  as JSON arrays.  Helper utilities in the service layer handle serialization.
"""

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models import BaseModel


class VectorKnowledgeBase(BaseModel):
    """Stores knowledge base entries with vector embeddings for semantic search."""

    __tablename__ = "vector_knowledge_base"

    content: Mapped[str] = mapped_column(String(500), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    standard_name: Mapped[str] = mapped_column(String(300), nullable=False)
    source: Mapped[str] = mapped_column(String(200), nullable=False)
    # TEXT in SQLite; converted to vector(1536) by Alembic migration on PostgreSQL
    embedding: Mapped[str] = mapped_column(Text, nullable=False)


class PromptTemplate(BaseModel):
    """Stores prompt templates for the AI grading pipeline steps."""

    __tablename__ = "prompt_templates"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    step: Mapped[str] = mapped_column(String(50), nullable=False)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    template: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

"""SQLAlchemy models for the AI pipeline feature.

Note on embedding storage:
- In PostgreSQL production, the Alembic migration converts the `embedding` column
  to a pgvector `vector(1536)` type for efficient cosine/L2 distance queries.
- In SQLite (tests / local dev), the column remains TEXT and embeddings are stored
  as JSON arrays.  Helper utilities in the service layer handle serialization.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Integer, String, Text, select
from sqlalchemy.orm import Mapped, mapped_column

from app.models import BaseModel

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


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


async def seed_prompt_templates(db: "AsyncSession") -> None:
    """Seed default prompt templates for extract/clean/decompose/grade steps."""

    templates = [
        {
            "name": "extract_skills_v1",
            "step": "extract",
            "industry": None,
            "template": """Given the following job description text, extract:
1. Job title/role
2. Required skills
3. Tools and technologies
4. Soft skills
5. Certificates/Licenses
6. Responsibilities

Text:
{{text}}

Output JSON only (no markdown, no code blocks):
{
  "job_role": "...",
  "skills": ["...", "..."],
  "tools": ["...", "..."],
  "soft_skills": ["...", "..."],
  "certificates": ["...", "..."],
  "responsibilities": ["...", "..."]
}""",
        },
        {
            "name": "clean_skills_v1",
            "step": "clean",
            "industry": None,
            "template": """You are a terminology standardizer. Clean and normalize the following extracted data:
- Remove duplicates
- Standardize terminology (e.g., "JS" → "JavaScript", "ML" → "Machine Learning")
- Merge synonymous terms (e.g., "团队协作" = "团队合作能力")

Data:
{{data}}

Output JSON only:
{
  "job_role": "...",
  "skills": ["...", "..."],
  "tools": ["...", "..."],
  "soft_skills": ["...", "..."],
  "certificates": ["...", "..."],
  "responsibilities": ["...", "..."]
}""",
        },
        {
            "name": "decompose_skills_v1",
            "step": "decompose",
            "industry": None,
            "template": """You are a skill decomposition expert. Break down macro-level skills into micro knowledge points.

For each skill in the input, generate 3-5 specific knowledge points that constitute that skill.
Example: "Python编程" → ["列表推导式", "装饰器", "异步编程", "上下文管理器"]

Data:
{{data}}

Output JSON only:
{
  "job_role": "...",
  "competency_dimensions": [
    {
      "name": "专业技术能力",
      "skills": [
        {
          "name": "Python编程",
          "knowledge_points": ["列表推导式", "装饰器", "异步编程", ...]
        }
      ]
    }
  ]
}""",
        },
        {
            "name": "grade_skills_v1",
            "step": "grade",
            "industry": None,
            "template": """You are a skill level grader. Assign proficiency levels (L1-L5) to skills and difficulty levels to knowledge points.

Level definitions:
- L1 (了解): Basic awareness, no practical experience
- L2 (熟悉): Can use with documentation/examples
- L3 (掌握): Can apply independently
- L4 (精通): Deep expertise, can mentor others
- L5 (专家): Industry-leading knowledge

Difficulty: 入门 / 初级 / 中级 / 高级 / 困难
Teaching suggestion: Brief advice for instruction

Data:
{{data}}

Output JSON only:
{
  "job_role": "...",
  "competency_dimensions": [
    {
      "name": "...",
      "skills": [
        {
          "name": "...",
          "level": "L3",
          "knowledge_points": [
            {"name": "...", "difficulty": "中级", "teaching_suggestion": "..."}
          ]
        }
      ]
    }
  ]
}""",
        },
    ]

    for t in templates:
        existing = await db.execute(
            select(PromptTemplate).where(
                PromptTemplate.name == t["name"],
                PromptTemplate.step == t["step"],
            )
        )
        if not existing.scalars().first():
            db.add(PromptTemplate(**t))

    await db.commit()

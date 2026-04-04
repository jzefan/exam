"""Vector search service for semantic skill-to-KB matching.

Phase 3 v1: Uses string similarity (ILIKE) as a placeholder.
Phase 4+: Replace with real pgvector <-> operator and embeddings.
"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_pipeline.models import VectorKnowledgeBase


class VectorSearchService:
    """Service for semantic search and skill-to-KB matching."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def semantic_search(
        self,
        query: str,
        embedding: Optional[list[float]] = None,
        threshold: float = 0.75,
        limit: int = 5,
    ) -> list[tuple[VectorKnowledgeBase, float]]:
        """
        Search VectorKnowledgeBase for similar vectors using pgvector.

        Phase 3 v1: Placeholder implementation using string similarity (ilike).
        Phase 4+: Use real vector embeddings with pgvector <-> operator.

        Args:
            query: Search query string
            embedding: Vector embedding (unused in v1)
            threshold: Similarity threshold 0.0-1.0 (unused in v1)
            limit: Max results to return

        Returns: list of (VectorKnowledgeBase entity, similarity_score) tuples
        """
        # Phase 3 v1: Simple string matching via ILIKE
        # Real pgvector implementation would be:
        # (1 - (VectorKnowledgeBase.embedding.op("<->"))).label("similarity")

        result = await self.db.execute(
            select(VectorKnowledgeBase)
            .where(VectorKnowledgeBase.content.ilike(f"%{query}%"))
            .limit(limit)
        )
        entities = result.scalars().all()

        # For v1, return fixed similarity score
        return [(entity, 0.8) for entity in entities]

    async def match_skills_with_kbs(
        self,
        skills: list[str],
        confidence_threshold: float = 0.5,
    ) -> dict:
        """
        For each skill from LLM output, find matching standard KnowledgeBase entries.

        Args:
            skills: List of skill names from LLM output
            confidence_threshold: Min confidence to consider a match (0.0-1.0)

        Returns: {
            "matches": [
                {
                    "skill": "Python编程",
                    "matched_kb": [
                        {"standard_name": "Python Programming", "confidence": 0.85, "category": "skill"}
                    ],
                    "confidence": 0.85
                }
            ],
            "unmatched": ["Skill X", "Skill Y"]
        }
        """
        matches = []
        unmatched = []

        for skill in skills:
            # Search for KB entries matching this skill
            # Phase 3 v1: ILIKE string match
            # Phase 4+: vector similarity with embedding

            result = await self.db.execute(
                select(VectorKnowledgeBase)
                .where(
                    (VectorKnowledgeBase.content.ilike(f"%{skill}%"))
                    | (VectorKnowledgeBase.standard_name.ilike(f"%{skill}%"))
                )
                .limit(3)
            )
            matched_kbs = result.scalars().all()

            if matched_kbs:
                matched_list = [
                    {
                        "standard_name": kb.standard_name,
                        "content": kb.content,
                        "category": kb.category,
                        "industry": kb.industry,
                        "confidence": 0.8,  # v1: fixed score
                    }
                    for kb in matched_kbs
                ]

                matches.append(
                    {
                        "skill": skill,
                        "matched_kb": matched_list,
                        "confidence": 0.8,
                    }
                )
            else:
                unmatched.append(skill)

        return {"matches": matches, "unmatched": unmatched, "total_skills": len(skills)}

    async def get_kb_entry_by_standard_name(
        self, standard_name: str
    ) -> Optional[VectorKnowledgeBase]:
        """Fetch a KB entry by exact standard name."""
        result = await self.db.execute(
            select(VectorKnowledgeBase).where(
                VectorKnowledgeBase.standard_name == standard_name
            )
        )
        return result.scalar_one_or_none()

    async def get_kb_entries_by_category(
        self,
        category: str,
        industry: Optional[str] = None,
        limit: int = 100,
    ) -> list[VectorKnowledgeBase]:
        """Get KB entries filtered by category and optionally industry."""
        query = select(VectorKnowledgeBase).where(VectorKnowledgeBase.category == category)
        if industry:
            query = query.where(VectorKnowledgeBase.industry == industry)

        result = await self.db.execute(query.limit(limit))
        return list(result.scalars().all())

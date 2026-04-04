import json
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_pipeline.models import PromptTemplate
from app.config import settings


class LLMClient:
    """Client for calling LLM APIs (DeepSeek-compatible)."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.deepseek.com/v1",
        model: str = "deepseek-chat",
        timeout: float = 60.0,
    ):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.timeout = timeout

    async def call_llm(
        self,
        prompt: str,
        system: str = "You are a helpful assistant.",
        temperature: float = 0.7,
    ) -> str:
        """
        Call LLM API (DeepSeek or compatible).
        Returns: LLM response text
        Raises: httpx.HTTPError if API call fails
        """
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions", json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]


class LLMPipeline:
    """4-step prompt chain: extract → clean → decompose → grade."""

    def __init__(self, llm_client: LLMClient, db: AsyncSession):
        self.llm = llm_client
        self.db = db

    async def step1_extract(self, text: str) -> dict:
        """
        Extract skills, tools, soft skills, certificates from JD text.
        Returns: dict with keys: job_role, skills, tools, soft_skills, certificates, responsibilities
        If JSON parsing fails, returns {"error": "...", "raw": "..."}
        """
        template = await self._get_template("extract", industry=None)
        prompt = template.template.replace("{{text}}", text)
        response = await self.llm.call_llm(
            prompt, system="You are a job analysis expert. Output only valid JSON."
        )

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return {"error": "LLM response not valid JSON", "raw": response[:500]}

    async def step2_clean(self, extracted_data: dict) -> dict:
        """
        Deduplicate, normalize terminology (e.g., JS → JavaScript).
        Merge synonymous terms (e.g., "团队协作" = "团队合作能力").
        Returns: cleaned dict (same structure as step1 output)
        """
        template = await self._get_template("clean", industry=None)
        prompt = template.template.replace(
            "{{data}}", json.dumps(extracted_data, ensure_ascii=False)
        )
        response = await self.llm.call_llm(
            prompt, system="You are a terminology standardizer. Output only valid JSON."
        )

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            # Fallback: return uncleaned data
            return extracted_data

    async def step3_decompose(self, cleaned_data: dict) -> dict:
        """
        Decompose macro skills into micro knowledge points.
        Example: "Python编程" → ["列表推导式", "装饰器", "异步编程"]
        Returns: dict with competency_dimensions, each containing skills with knowledge_points
        """
        template = await self._get_template("decompose", industry=None)
        prompt = template.template.replace(
            "{{data}}", json.dumps(cleaned_data, ensure_ascii=False)
        )
        response = await self.llm.call_llm(
            prompt, system="You are a skill decomposition expert. Output only valid JSON."
        )

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            # Fallback: return with empty structure
            return {
                "competency_dimensions": [],
                "job_role": cleaned_data.get("job_role", "Unknown"),
            }

    async def step4_grade(self, decomposed_data: dict) -> dict:
        """
        Assign L1-L5 levels to skills, difficulty/teaching suggestions to knowledge points.
        Returns: final graded structure with levels and difficulties assigned
        """
        template = await self._get_template("grade", industry=None)
        prompt = template.template.replace(
            "{{data}}", json.dumps(decomposed_data, ensure_ascii=False)
        )
        response = await self.llm.call_llm(
            prompt,
            system="You are a skill level grader. Assign L1-L5 levels and difficulty ratings. Output only valid JSON.",
        )

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            # Fallback
            return decomposed_data

    async def _get_template(
        self, step: str, industry: Optional[str] = None
    ) -> PromptTemplate:
        """
        Fetch active prompt template for a step.
        Priority: industry-specific → generic (industry=None)
        Raises: ValueError if no template found
        """
        if industry:
            result = await self.db.execute(
                select(PromptTemplate)
                .where(
                    PromptTemplate.step == step,
                    PromptTemplate.industry == industry,
                    PromptTemplate.is_active.is_(True),
                )
                .limit(1)
            )
            template = result.scalar_one_or_none()
            if template:
                return template

        # Fallback to generic
        result = await self.db.execute(
            select(PromptTemplate)
            .where(
                PromptTemplate.step == step,
                PromptTemplate.industry.is_(None),
                PromptTemplate.is_active.is_(True),
            )
            .limit(1)
        )
        template = result.scalar_one_or_none()
        if template:
            return template

        raise ValueError(f"No active prompt template found for step '{step}'")

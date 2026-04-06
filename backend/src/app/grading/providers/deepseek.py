"""DeepSeek provider adapter."""

from __future__ import annotations

from typing import Any

from app.grading.providers.base import (
    BaseGradingProvider,
    GradingProviderResult,
    build_grading_result,
    build_provider_metadata,
    extract_normalized_score_payload,
)


def normalize_deepseek_response_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return extract_normalized_score_payload(payload)


def parse_deepseek_response(
    payload: dict[str, Any],
    *,
    provider_key: str | None = None,
    model_name: str | None = None,
) -> GradingProviderResult:
    normalized = normalize_deepseek_response_payload(payload)
    return build_grading_result(
        normalized,
        raw_content=payload,
        provider_key=provider_key,
        provider_name="deepseek",
        base_url=None,
        model_name=model_name,
        metadata=build_provider_metadata(
            provider="deepseek",
            provider_key=provider_key,
            base_url=None,
            model_name=model_name,
        ),
    )


class DeepSeekProvider(BaseGradingProvider):
    def __init__(
        self,
        *,
        provider_key: str,
        base_url: str,
        model_name: str,
        api_key: str | None = None,
        temperature: float = 0.1,
    ) -> None:
        super().__init__(
            provider_key=provider_key,
            provider_name="deepseek",
            base_url=base_url,
            model_name=model_name,
            api_key=api_key,
            temperature=temperature,
        )

    def build_payload(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        return {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.temperature,
            "response_format": {"type": "json_object"},
        }

    def parse_response(self, payload: dict[str, Any]) -> GradingProviderResult:
        normalized = normalize_deepseek_response_payload(payload)
        return build_grading_result(
            normalized,
            raw_content=payload,
            provider_key=self.provider_key,
            provider_name=self.provider_name,
            base_url=self.base_url,
            model_name=self.model_name,
            metadata=build_provider_metadata(
                provider=self.provider_name,
                provider_key=self.provider_key,
                base_url=self.base_url,
                model_name=self.model_name,
            ),
        )

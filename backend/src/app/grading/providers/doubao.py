"""Doubao (Volcengine Ark) adapter for arbitration."""

from __future__ import annotations

from typing import Any

from app.grading.providers.base import (
    BaseGradingProvider,
    GradingProviderResult,
    build_grading_result,
    build_provider_metadata,
    extract_normalized_score_payload,
)


def build_doubao_payload(
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
) -> dict[str, Any]:
    # NOTE: doubao-seed-2-0-lite 等模型不支持 response_format=json_object，
    # 会返回 400 BadRequest。依赖 system prompt 约束 JSON 输出 + 解析端
    # 容错（去除围栏、抽取首个 JSON 对象）即可。
    return {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }


def normalize_doubao_response_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return extract_normalized_score_payload(payload)


class DoubaoProvider(BaseGradingProvider):
    def __init__(
        self,
        *,
        provider_key: str,
        base_url: str,
        model_name: str,
        api_key: str | None = None,
        temperature: float = 0.0,
    ) -> None:
        super().__init__(
            provider_key=provider_key,
            provider_name="doubao",
            base_url=base_url,
            model_name=model_name,
            api_key=api_key,
            temperature=temperature,
        )

    def build_payload(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        return build_doubao_payload(
            model_name=self.model_name,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
        )

    def parse_response(self, payload: dict[str, Any]) -> GradingProviderResult:
        normalized = normalize_doubao_response_payload(payload)
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

"""Provider abstractions for the grading engine."""

from __future__ import annotations

import json
from json import JSONDecodeError
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol, runtime_checkable

import httpx

REQUIRED_RESULT_KEYS = (
    "score_total",
    "dimension_scores",
    "deduction_reasons",
    "strengths",
    "improvement_suggestions",
    "evidence_summary",
    "risk_flags",
)


@dataclass(slots=True)
class GradingProviderResult:
    raw_content: dict[str, Any]
    score_total: float
    dimension_scores: dict[str, Any]
    deduction_reasons: list[str]
    strengths: list[str]
    improvement_suggestions: list[str]
    evidence_summary: dict[str, Any]
    risk_flags: list[str]
    provider_key: str | None = None
    provider_name: str | None = None
    model_name: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class GradingProvider(Protocol):
    async def score(self, system_prompt: str, user_prompt: str) -> GradingProviderResult:
        """Return a normalized grading result for a prompt pair."""


def _strip_code_fence(content: str) -> str:
    text = content.strip()
    if "```" not in text:
        return text

    start = text.find("```")
    end = text.rfind("```")
    if start == end:
        return text

    fenced = text[start + 3 : end].strip()
    if fenced.startswith("json"):
        fenced = fenced[4:].strip()
    return fenced


def _load_json_object(content: str) -> dict[str, Any]:
    normalized = _strip_code_fence(content)
    try:
        parsed = json.loads(normalized)
        if not isinstance(parsed, dict):
            raise ValueError("provider response content must decode to a JSON object")
        return parsed
    except (JSONDecodeError, ValueError):
        decoder = json.JSONDecoder()
        for start in (index for index, char in enumerate(normalized) if char == "{"):
            try:
                parsed, _ = decoder.raw_decode(normalized[start:])
            except JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
        raise ValueError("provider response content must decode to a JSON object")


def build_provider_metadata(
    *,
    provider: str,
    provider_key: str | None = None,
    base_url: str | None = None,
    model_name: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = {
        "provider": provider,
        "provider_key": provider_key,
        "base_url": base_url,
        "model_name": model_name,
    }
    if extra:
        metadata.update(extra)
    return metadata


def _require_type(value: Any, expected: type[Any] | tuple[type[Any], ...], field_name: str) -> None:
    if not isinstance(value, expected):
        readable = (
            "number"
            if expected in (int, float) or expected == (int, float)
            else getattr(expected, "__name__", str(expected))
        )
        raise ValueError(f"normalized provider payload field '{field_name}' must be a {readable}")


def _require_list_of_strings(value: Any, field_name: str) -> None:
    if not isinstance(value, list):
        raise ValueError(f"normalized provider payload field '{field_name}' must be a list")
    if any(not isinstance(item, str) for item in value):
        raise ValueError(f"normalized provider payload field '{field_name}' must contain only strings")


def _normalize_evidence_summary(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        return {"summary": value}
    if isinstance(value, list):
        _require_list_of_strings(value, "evidence_summary")
        return {"items": value}
    raise ValueError("normalized provider payload field 'evidence_summary' must be a dict")


def _validate_result_types(normalized_payload: dict[str, Any]) -> None:
    _require_type(normalized_payload["score_total"], (int, float), "score_total")
    if isinstance(normalized_payload["score_total"], bool):
        raise ValueError("normalized provider payload field 'score_total' must be a number")

    if not isinstance(normalized_payload["dimension_scores"], dict):
        raise ValueError("normalized provider payload field 'dimension_scores' must be a dict")
    _require_list_of_strings(normalized_payload["deduction_reasons"], "deduction_reasons")
    _require_list_of_strings(normalized_payload["strengths"], "strengths")
    _require_list_of_strings(normalized_payload["improvement_suggestions"], "improvement_suggestions")
    normalized_payload["evidence_summary"] = _normalize_evidence_summary(normalized_payload["evidence_summary"])
    _require_list_of_strings(normalized_payload["risk_flags"], "risk_flags")


def extract_normalized_score_payload(payload: Any) -> dict[str, Any]:
    """Return the normalized score object from a provider response envelope."""

    if isinstance(payload, dict):
        if "score" in payload and isinstance(payload["score"], dict):
            return payload["score"]

        if "choices" in payload:
            choices = payload.get("choices")
            if isinstance(choices, list) and choices:
                first_choice = choices[0]
                if isinstance(first_choice, dict):
                    message = first_choice.get("message")
                    if isinstance(message, dict):
                        content = message.get("content")
                        if isinstance(content, list):
                            text_content = "\n".join(
                                str(item.get("text", ""))
                                for item in content
                                if isinstance(item, dict) and item.get("type") in {None, "text"}
                            ).strip()
                            if text_content:
                                return _load_json_object(text_content)
                        if isinstance(content, dict):
                            return content
                        if isinstance(content, str):
                            return _load_json_object(content)

                    content = first_choice.get("content")
                    if isinstance(content, dict):
                        return content
                    if isinstance(content, str):
                        return _load_json_object(content)

        if {"score_total", "dimension_scores", "deduction_reasons", "strengths"}.issubset(payload):
            return payload

        message = payload.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, dict):
                return content
            if isinstance(content, str):
                return _load_json_object(content)

        content = payload.get("content")
        if isinstance(content, dict):
            return content
        if isinstance(content, str):
            return _load_json_object(content)

    raise ValueError("unsupported provider response shape")


def build_grading_result(
    normalized_payload: dict[str, Any],
    *,
    raw_content: dict[str, Any],
    provider_key: str | None = None,
    provider_name: str | None = None,
    base_url: str | None = None,
    model_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> GradingProviderResult:
    missing_keys = [key for key in REQUIRED_RESULT_KEYS if key not in normalized_payload]
    if missing_keys:
        missing = ", ".join(missing_keys)
        raise ValueError(f"normalized provider payload is missing required keys: {missing}")

    _validate_result_types(normalized_payload)

    return GradingProviderResult(
        raw_content=raw_content,
        score_total=normalized_payload["score_total"],
        dimension_scores=normalized_payload["dimension_scores"],
        deduction_reasons=normalized_payload["deduction_reasons"],
        strengths=normalized_payload["strengths"],
        improvement_suggestions=normalized_payload["improvement_suggestions"],
        evidence_summary=normalized_payload["evidence_summary"],
        risk_flags=normalized_payload["risk_flags"],
        provider_key=provider_key,
        provider_name=provider_name,
        model_name=model_name,
        metadata=build_provider_metadata(
            provider=provider_name or "unknown",
            provider_key=provider_key,
            base_url=base_url,
            model_name=model_name,
            extra=metadata,
        ),
    )


class BaseGradingProvider(ABC):
    """Shared adapter state for grading providers."""

    provider_key: str
    provider_name: str
    base_url: str
    model_name: str
    api_key: str | None
    temperature: float

    def __init__(
        self,
        *,
        provider_key: str,
        provider_name: str,
        base_url: str,
        model_name: str,
        api_key: str | None = None,
        temperature: float = 0.0,
    ) -> None:
        self.provider_key = provider_key
        self.provider_name = provider_name
        self.base_url = base_url.rstrip("/")
        self.model_name = model_name
        self.api_key = api_key
        self.temperature = temperature

    @abstractmethod
    def build_payload(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        """Build the provider-specific request payload."""

    @abstractmethod
    def parse_response(self, payload: dict[str, Any]) -> GradingProviderResult:
        """Normalize a provider response envelope into the common DTO."""

    async def _request_completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.api_key:
            raise ValueError(f"{self.provider_name} provider API key is not configured")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            response_payload = response.json()

        if not isinstance(response_payload, dict):
            raise ValueError("provider response must decode to a JSON object")
        return response_payload

    async def score(self, system_prompt: str, user_prompt: str) -> GradingProviderResult:
        payload = self.build_payload(system_prompt, user_prompt)
        response_payload = await self._request_completion(payload)
        return self.parse_response(response_payload)

    async def stream_text(self, system_prompt: str, user_prompt: str) -> AsyncIterator[str]:
        if not self.api_key:
            raise ValueError(f"{self.provider_name} provider API key is not configured")

        payload = self.build_payload(system_prompt, user_prompt)
        payload["stream"] = True
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line.removeprefix("data:").strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        parsed = json.loads(data)
                    except JSONDecodeError:
                        continue
                    choices = parsed.get("choices")
                    if not isinstance(choices, list) or not choices:
                        continue
                    first_choice = choices[0]
                    if not isinstance(first_choice, dict):
                        continue
                    delta = first_choice.get("delta")
                    content = delta.get("content") if isinstance(delta, dict) else None
                    if isinstance(content, list):
                        text = "\n".join(
                            str(item.get("text", ""))
                            for item in content
                            if isinstance(item, dict) and item.get("type") in {None, "text"}
                        )
                        if text:
                            yield text
                    elif isinstance(content, str) and content:
                        yield content

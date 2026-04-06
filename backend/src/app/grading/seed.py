"""Seed helpers for default grading provider and role-binding configuration."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.grading.models import ModelConfig, ProviderConfig, RoleBinding

DEFAULT_BINDING = {
    "version": 1,
    "grader_model_key": "qwen-grader-v1",
    "reviewer_model_key": "deepseek-review-v1",
    "arbiter_model_key": "claude-arbiter-v1",
    "is_active": True,
}


def _default_providers() -> list[dict[str, object]]:
    return [
        {
            "key": "qwen-direct",
            "provider_type": "qwen",
            "base_url": settings.qwen_base_url,
            "credential_env": "EXAM_QWEN_API_KEY",
            "is_active": True,
        },
        {
            "key": "deepseek-direct",
            "provider_type": "deepseek",
            "base_url": settings.deepseek_base_url,
            "credential_env": "EXAM_DEEPSEEK_API_KEY",
            "is_active": True,
        },
        {
            "key": "openrouter-arbiter",
            "provider_type": "openrouter",
            "base_url": settings.openrouter_base_url,
            "credential_env": "EXAM_OPENROUTER_API_KEY",
            "is_active": True,
        },
    ]


def _default_models() -> list[dict[str, object]]:
    return [
        {
            "key": "qwen-grader-v1",
            "display_name": "Qwen Grader",
            "model_name": settings.qwen_model_name,
            "provider_key": "qwen-direct",
            "temperature": 0.1,
            "is_active": True,
        },
        {
            "key": "deepseek-review-v1",
            "display_name": "DeepSeek Reviewer",
            "model_name": settings.deepseek_model_name,
            "provider_key": "deepseek-direct",
            "temperature": 0.1,
            "is_active": True,
        },
        {
            "key": "claude-arbiter-v1",
            "display_name": "Claude Sonnet 4.6",
            "model_name": settings.openrouter_model_name,
            "provider_key": "openrouter-arbiter",
            "temperature": 0.0,
            "is_active": True,
        },
    ]


async def seed_grading_defaults(db: AsyncSession) -> None:
    providers_by_key: dict[str, ProviderConfig] = {}
    for provider_payload in _default_providers():
        existing = await db.execute(
            select(ProviderConfig).where(ProviderConfig.key == provider_payload["key"])
        )
        provider = existing.scalar_one_or_none()
        if provider is None:
            provider = ProviderConfig(**provider_payload)
            db.add(provider)
            await db.flush()
        else:
            provider.provider_type = str(provider_payload["provider_type"])
            provider.base_url = str(provider_payload["base_url"])
            provider.credential_env = str(provider_payload["credential_env"])
            provider.is_active = bool(provider_payload["is_active"])
        providers_by_key[provider.key] = provider

    models_by_key: dict[str, ModelConfig] = {}
    for model_payload in _default_models():
        provider = providers_by_key[model_payload["provider_key"]]
        existing = await db.execute(select(ModelConfig).where(ModelConfig.key == model_payload["key"]))
        model = existing.scalar_one_or_none()
        if model is None:
            model = ModelConfig(
                key=model_payload["key"],
                display_name=model_payload["display_name"],
                model_name=model_payload["model_name"],
                provider_id=provider.id,
                temperature=model_payload["temperature"],
                is_active=model_payload["is_active"],
            )
            db.add(model)
            await db.flush()
        else:
            model.display_name = str(model_payload["display_name"])
            model.model_name = str(model_payload["model_name"])
            model.provider_id = provider.id
            model.temperature = float(model_payload["temperature"])
            model.is_active = bool(model_payload["is_active"])
        models_by_key[model.key] = model

    existing_binding = await db.execute(
        select(RoleBinding).where(RoleBinding.version == DEFAULT_BINDING["version"])
    )
    binding = existing_binding.scalar_one_or_none()
    if binding is None:
        db.add(
            RoleBinding(
                version=DEFAULT_BINDING["version"],
                grader_model_id=models_by_key[DEFAULT_BINDING["grader_model_key"]].id,
                reviewer_model_id=models_by_key[DEFAULT_BINDING["reviewer_model_key"]].id,
                arbiter_model_id=models_by_key[DEFAULT_BINDING["arbiter_model_key"]].id,
                is_active=DEFAULT_BINDING["is_active"],
            )
        )
        await db.flush()
    else:
        binding.grader_model_id = models_by_key[DEFAULT_BINDING["grader_model_key"]].id
        binding.reviewer_model_id = models_by_key[DEFAULT_BINDING["reviewer_model_key"]].id
        binding.arbiter_model_id = models_by_key[DEFAULT_BINDING["arbiter_model_key"]].id
        binding.is_active = bool(DEFAULT_BINDING["is_active"])

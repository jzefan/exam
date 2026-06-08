"""User settings for custom AI model configuration."""

import uuid
from datetime import datetime

import base64
import hashlib
import hmac

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import Boolean, String, Uuid, ForeignKey, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.dependencies import CurrentUser
from app.config import settings
from app.database import get_db
from app.models import Base, TimestampMixin

router = APIRouter()
DEFAULT_PROVIDER_PRIORITY = ("deepseek", "qwen", "claude")


# ── Model ──────────────────────────────────────────────────────────

class UserSettings(Base, TimestampMixin):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    ai_provider: Mapped[str] = mapped_column(String(50), default="deepseek", nullable=False)
    ai_api_key_encrypted: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ai_model_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ai_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class UserModelProviderSettings(Base, TimestampMixin):
    __tablename__ = "user_model_provider_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ai_api_key_encrypted: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ai_model_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ai_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


# ── Encryption helpers (XOR + HMAC, no extra deps) ────────────────

def _derive_key() -> bytes:
    return hashlib.sha256(settings.secret_key.encode()).digest()


def encrypt_api_key(plain: str) -> str:
    key = _derive_key()
    data = plain.encode()
    encrypted = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
    sig = hmac.new(key, encrypted, hashlib.sha256).digest()[:8]
    return base64.urlsafe_b64encode(sig + encrypted).decode()


def decrypt_api_key(encrypted: str) -> str:
    key = _derive_key()
    raw = base64.urlsafe_b64decode(encrypted)
    sig, data = raw[:8], raw[8:]
    expected_sig = hmac.new(key, data, hashlib.sha256).digest()[:8]
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Invalid signature")
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data)).decode()


def mask_api_key(plain: str) -> str:
    if len(plain) <= 8:
        return "••••••••"
    return plain[:4] + "••••" + plain[-4:]


# ── Schemas ────────────────────────────────────────────────────────

class ProviderSettingsItem(BaseModel):
    provider: str
    enabled: bool = True
    ai_api_key_masked: str | None = None
    ai_model_name: str | None = None
    ai_base_url: str | None = None
    has_custom_key: bool = False
    updated_at: datetime | None = None


class UserSettingsResponse(BaseModel):
    providers: list[ProviderSettingsItem]
    priority: list[str]


class UserSettingsUpdate(BaseModel):
    provider: str
    enabled: bool | None = None
    ai_api_key: str | None = None
    ai_model_name: str | None = None
    ai_base_url: str | None = None
    clear_api_key: bool = False


# ── Service ────────────────────────────────────────────────────────

async def get_user_settings(db: AsyncSession, user_id: uuid.UUID) -> UserSettings | None:
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def get_user_provider_settings(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[UserModelProviderSettings]:
    legacy = await get_user_settings(db, user_id)
    result = await db.execute(
        select(UserModelProviderSettings).where(UserModelProviderSettings.user_id == user_id)
    )
    rows = {row.provider: row for row in result.scalars().all()}
    created = False

    for provider in DEFAULT_PROVIDER_PRIORITY:
        row = rows.get(provider)
        if row is not None:
            continue
        row = UserModelProviderSettings(
            user_id=user_id,
            provider=provider,
            enabled=True,
        )
        if legacy and legacy.ai_provider == provider:
            row.ai_api_key_encrypted = legacy.ai_api_key_encrypted
            row.ai_model_name = legacy.ai_model_name
            row.ai_base_url = legacy.ai_base_url
        db.add(row)
        rows[provider] = row
        created = True

    if created:
        await db.flush()

    return [rows[provider] for provider in DEFAULT_PROVIDER_PRIORITY]


def get_system_provider_config(provider: str) -> tuple[str, str, str]:
    if provider == "qwen":
        return settings.qwen_api_key or "", settings.qwen_base_url, settings.qwen_model_name
    if provider == "deepseek":
        return settings.deepseek_api_key or "", settings.deepseek_base_url, settings.deepseek_model_name
    if provider == "claude":
        return settings.openrouter_api_key or "", settings.openrouter_base_url, settings.openrouter_model_name
    return "", "", ""


def _to_provider_item(row: UserModelProviderSettings) -> ProviderSettingsItem:
    masked = None
    has_key = False
    if row.ai_api_key_encrypted:
        try:
            plain = decrypt_api_key(row.ai_api_key_encrypted)
            masked = mask_api_key(plain)
            has_key = True
        except Exception:
            pass

    return ProviderSettingsItem(
        provider=row.provider,
        enabled=row.enabled,
        ai_api_key_masked=masked,
        ai_model_name=row.ai_model_name,
        ai_base_url=row.ai_base_url,
        has_custom_key=has_key,
        updated_at=row.updated_at,
    )


async def get_user_ai_config(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    preferred_provider: str | None = None,
) -> tuple[str | None, str | None, str | None, str | None]:
    """Return the first available enabled provider config based on priority."""
    rows = await get_user_provider_settings(db, user_id)
    provider_map = {row.provider: row for row in rows}
    ordered_providers = [
        provider
        for provider in ([preferred_provider] if preferred_provider else []) + list(DEFAULT_PROVIDER_PRIORITY)
        if provider in provider_map
    ]

    seen: set[str] = set()
    deduped_order = []
    for provider in ordered_providers:
        if provider in seen:
            continue
        seen.add(provider)
        deduped_order.append(provider)

    for provider in deduped_order:
        row = provider_map[provider]
        if not row.enabled:
            continue
        system_api_key, system_base_url, system_model_name = get_system_provider_config(provider)
        api_key = system_api_key
        if row.ai_api_key_encrypted:
            try:
                api_key = decrypt_api_key(row.ai_api_key_encrypted)
            except Exception:
                api_key = system_api_key
        if api_key:
            return (
                provider,
                api_key,
                row.ai_model_name or system_model_name,
                row.ai_base_url or system_base_url,
            )
    return None, None, None, None


# ── Endpoints ──────────────────────────────────────────────────────

@router.get("/me/settings", response_model=UserSettingsResponse)
async def get_settings_endpoint(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> UserSettingsResponse:
    return UserSettingsResponse(
        providers=[_to_provider_item(row) for row in await get_user_provider_settings(db, user.id)],
        priority=list(DEFAULT_PROVIDER_PRIORITY),
    )


@router.put("/me/settings", response_model=UserSettingsResponse)
async def update_settings_endpoint(
    data: UserSettingsUpdate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> UserSettingsResponse:
    rows = await get_user_provider_settings(db, user.id)
    row = next((item for item in rows if item.provider == data.provider), None)
    if row is None:
        row = UserModelProviderSettings(user_id=user.id, provider=data.provider, enabled=True)
        db.add(row)

    if data.enabled is not None:
        row.enabled = data.enabled
    if data.ai_model_name is not None:
        row.ai_model_name = data.ai_model_name or None
    if data.ai_base_url is not None:
        row.ai_base_url = data.ai_base_url or None
    if data.clear_api_key:
        row.ai_api_key_encrypted = None
    elif data.ai_api_key is not None and data.ai_api_key.strip():
        row.ai_api_key_encrypted = encrypt_api_key(data.ai_api_key.strip())

    await db.flush()
    await db.commit()
    await db.refresh(row)

    return UserSettingsResponse(
        providers=[_to_provider_item(item) for item in await get_user_provider_settings(db, user.id)],
        priority=list(DEFAULT_PROVIDER_PRIORITY),
    )

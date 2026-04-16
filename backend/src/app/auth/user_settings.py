"""User settings for custom AI model configuration."""

import uuid
from datetime import datetime

import base64
import hashlib
import hmac

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import String, Uuid, ForeignKey, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.dependencies import CurrentUser
from app.config import settings
from app.database import get_db
from app.models import Base, TimestampMixin

router = APIRouter()


# ── Model ──────────────────────────────────────────────────────────

class UserSettings(Base, TimestampMixin):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    ai_provider: Mapped[str] = mapped_column(String(50), default="qwen", nullable=False)
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

class UserSettingsResponse(BaseModel):
    ai_provider: str
    ai_api_key_masked: str | None = None
    ai_model_name: str | None = None
    ai_base_url: str | None = None
    has_custom_key: bool = False
    updated_at: datetime | None = None


class UserSettingsUpdate(BaseModel):
    ai_provider: str | None = None
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


async def get_user_ai_config(
    db: AsyncSession, user_id: uuid.UUID
) -> tuple[str | None, str | None, str | None, str | None]:
    """Return (provider, api_key, model_name, base_url) or all None if not configured."""
    us = await get_user_settings(db, user_id)
    if not us or not us.ai_api_key_encrypted:
        return None, None, None, None
    try:
        api_key = decrypt_api_key(us.ai_api_key_encrypted)
    except Exception:
        return None, None, None, None
    return us.ai_provider, api_key, us.ai_model_name, us.ai_base_url


# ── Endpoints ──────────────────────────────────────────────────────

@router.get("/me/settings", response_model=UserSettingsResponse)
async def get_settings_endpoint(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> UserSettingsResponse:
    us = await get_user_settings(db, user.id)
    if not us:
        return UserSettingsResponse(ai_provider="qwen")

    masked = None
    has_key = False
    if us.ai_api_key_encrypted:
        try:
            plain = decrypt_api_key(us.ai_api_key_encrypted)
            masked = mask_api_key(plain)
            has_key = True
        except Exception:
            pass

    return UserSettingsResponse(
        ai_provider=us.ai_provider,
        ai_api_key_masked=masked,
        ai_model_name=us.ai_model_name,
        ai_base_url=us.ai_base_url,
        has_custom_key=has_key,
        updated_at=us.updated_at,
    )


@router.put("/me/settings", response_model=UserSettingsResponse)
async def update_settings_endpoint(
    data: UserSettingsUpdate,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> UserSettingsResponse:
    us = await get_user_settings(db, user.id)
    if not us:
        us = UserSettings(user_id=user.id, ai_provider=data.ai_provider or "qwen")
        db.add(us)

    if data.ai_provider is not None:
        us.ai_provider = data.ai_provider
    if data.ai_model_name is not None:
        us.ai_model_name = data.ai_model_name or None
    if data.ai_base_url is not None:
        us.ai_base_url = data.ai_base_url or None
    if data.clear_api_key:
        us.ai_api_key_encrypted = None
    elif data.ai_api_key is not None and data.ai_api_key.strip():
        us.ai_api_key_encrypted = encrypt_api_key(data.ai_api_key.strip())

    await db.flush()
    await db.commit()
    await db.refresh(us)

    masked = None
    has_key = False
    if us.ai_api_key_encrypted:
        try:
            plain = decrypt_api_key(us.ai_api_key_encrypted)
            masked = mask_api_key(plain)
            has_key = True
        except Exception:
            pass

    return UserSettingsResponse(
        ai_provider=us.ai_provider,
        ai_api_key_masked=masked,
        ai_model_name=us.ai_model_name,
        ai_base_url=us.ai_base_url,
        has_custom_key=has_key,
        updated_at=us.updated_at,
    )

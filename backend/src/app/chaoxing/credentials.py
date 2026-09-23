"""Encrypted, per-teacher Chaoxing login credentials."""

import base64
import hashlib
import json
import uuid

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import ForeignKey, Text, Uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.models import Base, TimestampMixin

_INSECURE_SECRETS = {
    "change-me-in-production",
    "replace-this-with-a-long-random-string",
}


class ChaoxingCredential(Base, TimestampMixin):
    __tablename__ = "chaoxing_credentials"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    encrypted_payload: Mapped[str] = mapped_column(Text, nullable=False)


def credentials_encryption_enabled() -> bool:
    """Do not persist credentials when the application still uses its example key."""
    secret = settings.secret_key
    return secret not in _INSECURE_SECRETS and len(secret) >= 32


def _fernet() -> Fernet:
    if not credentials_encryption_enabled():
        raise RuntimeError("credential encryption is not configured")
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest())
    return Fernet(key)


def encrypt_credentials(username: str, password: str) -> str:
    payload = json.dumps({"username": username, "password": password}, ensure_ascii=False).encode()
    return _fernet().encrypt(payload).decode()


def decrypt_credentials(payload: str) -> tuple[str, str]:
    try:
        value = json.loads(_fernet().decrypt(payload.encode()))
        username, password = value["username"], value["password"]
    except (InvalidToken, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Unable to decrypt saved Chaoxing credentials") from exc
    if not isinstance(username, str) or not isinstance(password, str):
        raise ValueError("Invalid saved Chaoxing credentials")
    return username, password


async def get_credentials(db: AsyncSession, owner_id: uuid.UUID) -> tuple[str, str] | None:
    row = await db.get(ChaoxingCredential, owner_id)
    if row is None:
        return None
    return decrypt_credentials(row.encrypted_payload)


async def save_credentials(db: AsyncSession, owner_id: uuid.UUID, username: str, password: str) -> None:
    encrypted = encrypt_credentials(username, password)
    row = await db.get(ChaoxingCredential, owner_id)
    if row is None:
        db.add(ChaoxingCredential(owner_id=owner_id, encrypted_payload=encrypted))
    else:
        row.encrypted_payload = encrypted
    await db.flush()


async def delete_credentials(db: AsyncSession, owner_id: uuid.UUID) -> None:
    row = await db.get(ChaoxingCredential, owner_id)
    if row is not None:
        await db.delete(row)
        await db.flush()

"""Token generation, hashing, and short-lived JWTs for invitation flows."""

import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from jose import JWTError, jwt

from app.config import settings


ALGORITHM = "HS256"
SCOPE_EXAM_TAKE = "exam_take"


def generate_invitation_token() -> str:
    """Return a high-entropy base64url token for one-time invitation links."""
    return secrets.token_urlsafe(32)


def hash_invitation_token(token: str) -> str:
    """Return a stable SHA-256 hex digest for storing invitation tokens."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_exam_take_token(
    user_id: uuid.UUID,
    exam_id: uuid.UUID,
    expires_at: datetime,
) -> str:
    payload = {
        "sub": str(user_id),
        "exam_id": str(exam_id),
        "scope": SCOPE_EXAM_TAKE,
        "exp": int(expires_at.timestamp()),
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_exam_take_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("scope") != SCOPE_EXAM_TAKE:
        return None
    return payload

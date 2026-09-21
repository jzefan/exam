import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import settings

ALGORITHM = "HS256"

# A verified-password login that still has to pick a role exchanges this short
# lived token for a real access token. It carries no session and grants nothing
# on its own: it only proves "this caller passed the password check for this
# user", so the role list never has to be exposed to an unauthenticated probe.
ROLE_SELECTION_PURPOSE = "role_select"
ROLE_SELECTION_TTL_MINUTES = 5


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(user_id: uuid.UUID, role: str, session_id: str | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict = {"sub": str(user_id), "role": role, "exp": expire}
    # Only student logins pass a session_id; its presence opts the token into
    # single-session enforcement in the auth dependency.
    if session_id is not None:
        payload["sid"] = session_id
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return None


def create_role_selection_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ROLE_SELECTION_TTL_MINUTES)
    payload = {
        "sub": str(user_id),
        "purpose": ROLE_SELECTION_PURPOSE,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_role_selection_token(token: str) -> uuid.UUID | None:
    """Return the user id a role-selection token was minted for, else None."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("purpose") != ROLE_SELECTION_PURPOSE:
        return None
    try:
        return uuid.UUID(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None

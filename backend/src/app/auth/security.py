import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import settings

ALGORITHM = "HS256"

# bcrypt is a deliberate CPU cost, but 12 rounds measured ~290ms on the
# production 4-core box and the login endpoint ran it inline on the event loop,
# stalling every other request in the single uvicorn worker. 10 rounds is still
# an accepted work factor and cuts that to ~70ms. Hashes keep the cost they were
# minted with, so existing passwords verify fine; `password_needs_rehash` lets
# the login path upgrade them opportunistically.
PASSWORD_HASH_ROUNDS = 10

# A verified-password login that still has to pick a role exchanges this short
# lived token for a real access token. It carries no session and grants nothing
# on its own: it only proves "this caller passed the password check for this
# user", so the role list never has to be exposed to an unauthenticated probe.
ROLE_SELECTION_PURPOSE = "role_select"
ROLE_SELECTION_TTL_MINUTES = 5


def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"), bcrypt.gensalt(rounds=PASSWORD_HASH_ROUNDS)
    ).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


async def hash_password_async(password: str) -> str:
    """Hash without blocking the event loop (bcrypt is pure CPU)."""
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    """Verify without blocking the event loop (bcrypt is pure CPU)."""
    return await asyncio.to_thread(verify_password, plain_password, hashed_password)


def password_needs_rehash(hashed_password: str) -> bool:
    """True when a stored hash uses a different work factor than we now use.

    Deliberately ``!=`` rather than ``<``: the production cost was lowered from
    12 to 10 after 12 measured ~290ms per login on the app server, so hashes
    minted before that change are *stronger* than the current setting and would
    otherwise never be upgraded. The plaintext is available at login, so this is
    the only place they can be re-minted cheaply.
    """
    try:
        cost = int(hashed_password.split("$")[2])
    except (IndexError, ValueError):
        return False
    return cost != PASSWORD_HASH_ROUNDS


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

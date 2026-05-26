"""OIDC SSO endpoints for exam.

Flow:
   GET /api/auth/oidc/authorize
     ↓ (302 to ArkLoop /v1/auth/oauth/authorize, with PKCE + state)
   user signs in / consents
     ↓ (302 back to exam with ?code=&state=)
   GET /api/auth/oidc/callback
     ↓ exchange code → access_token + id_token
     ↓ verify id_token signature + claims
     ↓ auto-provision or look up local user by oidc_subject
     ↓ issue exam-local access_token
     ↓ 302 to frontend with the token (or set cookie, depending on UX choice)

State + PKCE verifier are stored in short-lived signed cookies so the callback
endpoint can recover them without server-side session storage.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.oidc_client import OIDCError, get_oidc_client
from app.auth.oidc_provision import get_or_provision_user
from app.auth.security import create_access_token
from app.config import settings
from app.database import get_db

oidc_router = APIRouter()

_STATE_COOKIE = "exam_oidc_state"
_VERIFIER_COOKIE = "exam_oidc_verifier"
_NEXT_COOKIE = "exam_oidc_next"
_COOKIE_MAX_AGE = 600  # 10 minutes


# ─── PKCE helpers ─────────────────────────────────────────────────────


def _pkce_pair() -> tuple[str, str]:
    """Returns (verifier, challenge) for PKCE S256."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def _set_short_cookie(response: Response, name: str, value: str) -> None:
    # httponly + secure + samesite=lax: lax is required so the IdP's 302
    # redirect back to /callback still sends the cookie.
    response.set_cookie(
        name,
        value,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        secure=not settings.debug,
        samesite="lax",
        path="/api/auth/oidc",
    )


def _clear_short_cookies(response: Response) -> None:
    for c in (_STATE_COOKIE, _VERIFIER_COOKIE, _NEXT_COOKIE):
        response.delete_cookie(c, path="/api/auth/oidc")


# ─── Endpoints ────────────────────────────────────────────────────────


@oidc_router.get("/oidc/authorize")
async def authorize(request: Request, next: str = "/") -> RedirectResponse:
    """Redirect the browser to the ArkLoop IdP."""
    client = get_oidc_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC SSO is not configured on this exam instance",
        )

    state = secrets.token_urlsafe(24)
    verifier, challenge = _pkce_pair()
    nonce = secrets.token_urlsafe(16)

    url = await client.build_authorize_url(state=state, code_challenge=challenge, nonce=nonce)
    response = RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)
    _set_short_cookie(response, _STATE_COOKIE, state)
    _set_short_cookie(response, _VERIFIER_COOKIE, verifier)
    _set_short_cookie(response, _NEXT_COOKIE, next)
    return response


@oidc_router.get("/oidc/callback")
async def callback(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> RedirectResponse:
    """Exchange the authorization code for tokens and sign the user in."""
    client = get_oidc_client()
    if client is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OIDC not configured")
    if error:
        # IdP refused. Bounce back to the frontend with an error param.
        return RedirectResponse(
            url=f"{settings.frontend_base_url}/login?oidc_error={error}&desc={error_description or ''}",
            status_code=status.HTTP_302_FOUND,
        )
    if not code or not state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="missing code or state")

    saved_state = request.cookies.get(_STATE_COOKIE)
    verifier = request.cookies.get(_VERIFIER_COOKIE)
    next_url = request.cookies.get(_NEXT_COOKIE) or "/"
    if not saved_state or not verifier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="state cookie missing — flow expired?")
    if not secrets.compare_digest(saved_state, state):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="state mismatch (possible CSRF)")

    try:
        tokens = await client.exchange_code(code, verifier)
    except OIDCError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"token exchange failed: {exc}") from exc

    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="id_token missing from token response")
    try:
        claims = await client.verify_token(id_token, audience=client.client_id)
    except OIDCError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"id_token verification failed: {exc}") from exc

    user = await get_or_provision_user(db, claims)
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="id_token missing sub claim")

    # Issue exam-local access token so the rest of the app's session model
    # works unchanged. Frontend reads the token from the URL fragment.
    role = "teacher"  # default; RBAC can refine later
    access_token = create_access_token(user.id, role)

    redirect = RedirectResponse(
        url=f"{settings.frontend_base_url}{next_url}#access_token={access_token}",
        status_code=status.HTTP_302_FOUND,
    )
    _clear_short_cookies(redirect)
    return redirect


# NOTE: Provisioning logic now lives in app/auth/oidc_provision.py so that
# both the browser SSO callback path (this router) and the API token-resolution
# path (dependencies._resolve_user_from_token) share it verbatim. Don't
# inline a copy here.

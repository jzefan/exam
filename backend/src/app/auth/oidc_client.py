"""Lightweight OIDC client for verifying tokens issued by the ArkLoop IdP.

Implementation notes:
- We deliberately avoid the full ``authlib`` dependency. python-jose + httpx
  are already in the project; rolling our own client lets us cache JWKS on
  startup and verify with no extra deps.
- All verification keys are pulled from ``{issuer}/.well-known/jwks.json``;
  the discovery doc is consulted lazily to learn endpoint URLs.
- Tokens are RS256-signed; we hard-code the expected algorithm.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from jose import JWTError, jwk, jwt
from jose.utils import base64url_decode

from app.config import settings


class OIDCError(Exception):
    """Wraps any failure inside this module so callers see one error type."""


@dataclass
class _DiscoveryDoc:
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str
    jwks_uri: str


@dataclass
class _JWKSCache:
    keys_by_kid: dict[str, dict[str, Any]] = field(default_factory=dict)
    fetched_at: float = 0.0


class OIDCClient:
    """Stateless-ish OIDC client. One instance per process; caches discovery
    and JWKS until ttl expires."""

    def __init__(
        self,
        issuer: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        jwks_ttl_seconds: int = 3600,
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.jwks_ttl_seconds = jwks_ttl_seconds
        self._discovery: _DiscoveryDoc | None = None
        self._jwks = _JWKSCache()

    # ─── Discovery ─────────────────────────────────────────────────────

    async def _discovery_doc(self) -> _DiscoveryDoc:
        if self._discovery is not None:
            return self._discovery
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{self.issuer}/.well-known/openid-configuration")
            r.raise_for_status()
            data = r.json()
        self._discovery = _DiscoveryDoc(
            authorization_endpoint=data["authorization_endpoint"],
            token_endpoint=data["token_endpoint"],
            userinfo_endpoint=data["userinfo_endpoint"],
            jwks_uri=data["jwks_uri"],
        )
        return self._discovery

    # ─── JWKS ──────────────────────────────────────────────────────────

    async def _refresh_jwks_if_stale(self) -> None:
        if time.monotonic() - self._jwks.fetched_at < self.jwks_ttl_seconds and self._jwks.keys_by_kid:
            return
        disc = await self._discovery_doc()
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(disc.jwks_uri)
            r.raise_for_status()
            doc = r.json()
        self._jwks.keys_by_kid = {k["kid"]: k for k in doc.get("keys", [])}
        self._jwks.fetched_at = time.monotonic()

    async def _resolve_key(self, kid: str) -> dict[str, Any]:
        await self._refresh_jwks_if_stale()
        key = self._jwks.keys_by_kid.get(kid)
        if key is None:
            # Force one refresh in case the IdP just rotated.
            self._jwks.fetched_at = 0.0
            await self._refresh_jwks_if_stale()
            key = self._jwks.keys_by_kid.get(kid)
        if key is None:
            raise OIDCError(f"unknown kid: {kid}")
        return key

    # ─── Token verification ────────────────────────────────────────────

    async def verify_token(self, token: str, *, audience: str | None = None) -> dict[str, Any]:
        """Verify an RS256 token signed by the IdP. Returns claims on success.

        Raises ``OIDCError`` on signature mismatch, expiry, unknown kid, or
        audience mismatch when ``audience`` is provided.
        """
        try:
            header = jwt.get_unverified_header(token)
        except JWTError as exc:
            raise OIDCError(f"malformed jwt header: {exc}") from exc

        kid = header.get("kid")
        if not kid:
            raise OIDCError("jwt header missing kid")
        if header.get("alg") != "RS256":
            raise OIDCError(f"unexpected alg: {header.get('alg')}")

        jwk_data = await self._resolve_key(kid)
        public_key = jwk.construct(jwk_data, algorithm="RS256")

        # jose.jwt.decode verifies signature + exp + iat + (optional aud/iss);
        # we keep audience optional to support both access_token (aud=client_id)
        # and tokens minted by /internal/oauth/issue.
        try:
            claims = jwt.decode(
                token,
                public_key.to_pem().decode(),
                algorithms=["RS256"],
                audience=audience,
                issuer=self.issuer,
                options={"verify_aud": audience is not None},
            )
        except JWTError as exc:
            raise OIDCError(f"jwt verification failed: {exc}") from exc

        # Defensive: confirm signature manually too. python-jose has had
        # quirky bugs around RS256 + missing aud in some past releases.
        _verify_signature_manually(token, public_key)

        return claims

    # ─── Authorization code flow helpers ──────────────────────────────

    async def build_authorize_url(
        self, *, state: str, code_challenge: str, scope: str | None = None, nonce: str | None = None
    ) -> str:
        disc = await self._discovery_doc()
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": scope or "openid profile email offline_access exam:read exam:write",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if nonce:
            params["nonce"] = nonce
        query = "&".join(f"{k}={httpx.QueryParams({k: v})[k]}" for k, v in params.items())
        return f"{disc.authorization_endpoint}?{query}"

    async def exchange_code(self, code: str, code_verifier: str) -> dict[str, Any]:
        disc = await self._discovery_doc()
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                disc.token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self.redirect_uri,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code_verifier": code_verifier,
                },
            )
        if r.status_code != 200:
            raise OIDCError(f"token endpoint {r.status_code}: {r.text}")
        return r.json()


def _verify_signature_manually(token: str, public_key) -> None:
    """Belt-and-suspenders signature check using the raw jose primitives."""
    try:
        signing_input, signature_b64 = token.rsplit(".", 1)
    except ValueError as exc:
        raise OIDCError("malformed jwt") from exc
    signature = base64url_decode(signature_b64.encode())
    if not public_key.verify(signing_input.encode(), signature):
        raise OIDCError("invalid signature")


# ─── Singleton (lazy) ──────────────────────────────────────────────────

_client: OIDCClient | None = None


def get_oidc_client() -> OIDCClient | None:
    """Return the configured OIDC client, or None when SSO is disabled."""
    global _client
    if not settings.oidc_issuer:
        return None
    if _client is None:
        _client = OIDCClient(
            issuer=settings.oidc_issuer,
            client_id=settings.oidc_client_id,
            client_secret=settings.oidc_client_secret,
            redirect_uri=settings.oidc_redirect_uri,
            jwks_ttl_seconds=settings.oidc_jwks_cache_ttl_seconds,
        )
    return _client

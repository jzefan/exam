"""Persistent, owner-scoped snapshots of normalized Chaoxing reads."""

import asyncio
import copy
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ChaoxingReadSnapshot

FRESH_SECONDS = {"courses": 30 * 60, "exams": 5 * 60, "candidates": 2 * 60, "review": 30 * 60}
RETENTION_SECONDS = {"courses": 30 * 86400, "exams": 30 * 86400, "candidates": 30 * 86400, "review": 7 * 86400}
SCHEMA_VERSION = 1
logger = logging.getLogger(__name__)


def _safe(value):
    if isinstance(value, dict):
        return {
            key: _safe(item)
            for key, item in value.items()
            if not key.startswith("_")
            and "url" not in key.lower()
            and key.lower() not in {"token", "cookie", "password", "authorization", "secret"}
            and not key.lower().endswith("enc")
            and key not in {"source", "fetched_at", "stale"}
        }
    if isinstance(value, list):
        return [_safe(item) for item in value]
    return value


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def load(db: AsyncSession, owner_id, account_key: str, kind: str, scope_key: str):
    now = datetime.now(timezone.utc)
    row = await db.scalar(
        select(ChaoxingReadSnapshot).where(
            ChaoxingReadSnapshot.owner_id == owner_id,
            ChaoxingReadSnapshot.account_key == account_key,
            ChaoxingReadSnapshot.kind == kind,
            ChaoxingReadSnapshot.scope_key == scope_key,
            ChaoxingReadSnapshot.deleted_at.is_(None),
            ChaoxingReadSnapshot.schema_version == SCHEMA_VERSION,
        )
    )
    if row is None or _utc(row.purge_after) <= now:
        return None
    return {
        "payload": copy.deepcopy(row.payload),
        "fetched_at": _iso(row.fetched_at),
        "stale": _utc(row.fresh_until) <= now,
    }


async def save(db: AsyncSession, owner_id, account_key: str, kind: str, scope_key: str, payload: dict):
    if not account_key:
        return
    safe_payload = _safe(payload)
    encoded = json.dumps(safe_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    row = await db.scalar(
        select(ChaoxingReadSnapshot)
        .where(
            ChaoxingReadSnapshot.owner_id == owner_id,
            ChaoxingReadSnapshot.account_key == account_key,
            ChaoxingReadSnapshot.kind == kind,
            ChaoxingReadSnapshot.scope_key == scope_key,
        )
        .with_for_update()
    )
    if row is None:
        row = ChaoxingReadSnapshot(
            owner_id=owner_id,
            account_key=account_key,
            kind=kind,
            scope_key=scope_key,
            payload=safe_payload,
            content_hash=digest,
            fetched_at=now,
            fresh_until=now + timedelta(seconds=FRESH_SECONDS[kind]),
            purge_after=now + timedelta(seconds=RETENTION_SECONDS[kind]),
            schema_version=SCHEMA_VERSION,
        )
        db.add(row)
    else:
        if row.content_hash != digest:
            row.payload = safe_payload
            row.content_hash = digest
        row.fetched_at = now
        row.fresh_until = now + timedelta(seconds=FRESH_SECONDS[kind])
        row.purge_after = now + timedelta(seconds=RETENTION_SECONDS[kind])
    await db.flush()


async def invalidate(db: AsyncSession, owner_id, account_key: str, kinds: tuple[str, ...], scope_prefix: str | None = None):
    query = delete(ChaoxingReadSnapshot).where(
        ChaoxingReadSnapshot.owner_id == owner_id,
        ChaoxingReadSnapshot.account_key == account_key,
        ChaoxingReadSnapshot.kind.in_(kinds),
    )
    if scope_prefix is not None:
        query = query.where(ChaoxingReadSnapshot.scope_key.like(f"{scope_prefix}%"))
    await db.execute(query)


async def purge_expired(db: AsyncSession):
    now = datetime.now(timezone.utc)
    await db.execute(delete(ChaoxingReadSnapshot).where(ChaoxingReadSnapshot.purge_after <= now))
    await db.commit()


async def run_cleanup():
    """Expire temporary answer snapshots even when the Chaoxing connector is disabled."""
    from app.database import async_session

    while True:
        try:
            async with async_session() as db:
                await purge_expired(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Chaoxing read snapshot cleanup failed")
        await asyncio.sleep(3600)


def response(payload: dict, *, source: str, fetched_at: str, stale: bool = False):
    result = copy.deepcopy(payload)
    result.update(source=source, fetched_at=fetched_at, stale=stale)
    return result


def stamped(payload: dict):
    now = _iso(datetime.now(timezone.utc))
    result = copy.deepcopy(payload)
    result.update(source="live", fetched_at=now, stale=False)
    return result, now

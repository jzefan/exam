import asyncio
import logging
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

logger = logging.getLogger(__name__)

# Keep the default pool modest because production blue/green deploys can
# temporarily run two backend slots, and each uvicorn worker owns its own pool.
# Increase EXAM_DATABASE_POOL_SIZE / EXAM_DATABASE_MAX_OVERFLOW only when
# PostgreSQL max_connections or PgBouncer capacity is sized accordingly.
#
# pool_recycle is deliberately long: forcing a recycle closes the connection,
# and re-establishing one is expensive on slow links (e.g. Docker-for-Mac port
# forwarding costs 100ms-3s per connect). Because every pooled connection is
# created together at startup, a short recycle window makes them all expire at
# once — so the first page-load after an idle break triggers a synchronous
# reconnect storm that serializes into multi-second request stalls. We instead
# keep connections long-lived and lean on pool_pre_ping to lazily replace any
# that the server actually dropped.
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_pre_ping=True,
    pool_recycle=settings.database_pool_recycle_seconds,
)


async def warm_pool() -> None:
    """Eagerly open the base pool so requests never pay first-connect latency.

    Establishing a connection is slow on some networks; doing it lazily during a
    page-load burst means dozens of requests each block on a fresh connect and
    serialize. Opening them up-front (concurrently, once) turns a cold-pool
    storm into a warm-pool checkout. Failures here are non-fatal — the pool will
    just fill on demand as before.
    """

    if not settings.database_warm_pool:
        return

    size = engine.pool.size()
    try:
        conns = await asyncio.gather(*(engine.connect() for _ in range(size)))
    except Exception:
        logger.warning("connection pool warm-up failed; falling back to lazy connect", exc_info=True)
        return
    try:
        await asyncio.gather(*(conn.execute(text("SELECT 1")) for conn in conns))
    finally:
        # Closing an AsyncConnection returns its DBAPI connection to the pool
        # (kept open), so the pool is now primed with `size` live connections.
        await asyncio.gather(*(conn.close() for conn in conns), return_exceptions=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

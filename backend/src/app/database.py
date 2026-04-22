from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

# Pool sized for ~150 concurrent exam takers. If max_connections on Postgres
# is too low, front this with PgBouncer (transaction pool) rather than shrinking.
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=30,
    max_overflow=30,
    pool_pre_ping=True,
    pool_recycle=1800,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

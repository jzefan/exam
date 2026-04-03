"""Conftest for RBAC tests - provides db fixture alias."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.fixture
async def db(db_session: AsyncSession) -> AsyncSession:
    """Alias for db_session to match test signatures."""
    return db_session

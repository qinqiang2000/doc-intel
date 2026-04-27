"""Tests for app.core.database — engine, pragmas, session."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_sqlite_pragmas_applied(tmp_path, monkeypatch):
    db_file = tmp_path / "pragma_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)

    # Force re-read of cached settings
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    # Import database AFTER env override so it reads the right URL
    import importlib
    from app.core import database
    importlib.reload(database)

    from sqlalchemy import text

    async with database.engine.connect() as conn:
        journal = (await conn.execute(text("PRAGMA journal_mode"))).scalar()
        sync = (await conn.execute(text("PRAGMA synchronous"))).scalar()
        fk = (await conn.execute(text("PRAGMA foreign_keys"))).scalar()

    assert journal.lower() == "wal"
    assert int(sync) == 1  # NORMAL
    assert int(fk) == 1


@pytest.mark.asyncio
async def test_get_db_yields_async_session(tmp_path, monkeypatch):
    db_file = tmp_path / "session_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_file}")
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)

    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    import importlib
    from app.core import database
    importlib.reload(database)

    from sqlalchemy.ext.asyncio import AsyncSession

    gen = database.get_db()
    session = await gen.__anext__()
    try:
        assert isinstance(session, AsyncSession)
    finally:
        await gen.aclose()

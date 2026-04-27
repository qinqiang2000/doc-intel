"""Tests for app.core.config Settings."""
from __future__ import annotations

import pytest


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./data/test.db")
    monkeypatch.setenv("ML_BACKEND_URL", "http://localhost:9090")

    from app.core.config import Settings
    s = Settings()
    assert s.JWT_SECRET_KEY == "x" * 32
    assert s.DATABASE_URL == "sqlite+aiosqlite:///./data/test.db"
    assert s.ML_BACKEND_URL == "http://localhost:9090"
    assert s.JWT_ACCESS_TOKEN_EXPIRE_DAYS == 7  # default


def test_settings_rejects_short_jwt_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "tooshort")
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./data/test.db")

    from pydantic import ValidationError
    from app.core.config import Settings
    with pytest.raises(ValidationError):
        Settings()


def test_settings_rejects_unsupported_db_url(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("DATABASE_URL", "mysql://localhost/db")

    from pydantic import ValidationError
    from app.core.config import Settings
    with pytest.raises(ValidationError):
        Settings()

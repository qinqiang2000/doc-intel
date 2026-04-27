"""Tests for app.core.security — bcrypt + JWT."""
from __future__ import annotations

import time

import pytest


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./data/doc_intel.db")
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()


def test_password_hash_verify_roundtrip():
    from app.core.security import hash_password, verify_password

    h = hash_password("s3cret!")
    assert h != "s3cret!"
    assert verify_password("s3cret!", h) is True
    assert verify_password("wrong", h) is False


def test_jwt_encode_decode_roundtrip():
    from app.core.security import create_access_token, decode_access_token

    token = create_access_token(user_id="u-1", email="a@x.com")
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == "u-1"
    assert payload["email"] == "a@x.com"


def test_jwt_invalid_token_returns_none():
    from app.core.security import decode_access_token

    assert decode_access_token("not.a.real.jwt") is None
    assert decode_access_token("") is None


def test_jwt_expired_token_returns_none(monkeypatch):
    monkeypatch.setenv("JWT_ACCESS_TOKEN_EXPIRE_DAYS", "0")  # already expired
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    from app.core.security import create_access_token, decode_access_token

    token = create_access_token(user_id="u-1", email="a@x.com")
    time.sleep(1)
    assert decode_access_token(token) is None

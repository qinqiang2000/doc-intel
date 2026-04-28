"""Tests for storage.py."""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("JWT_SECRET_KEY", "x" * 32)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///./data/test.db")
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()


def test_ext_for_mime_pdf():
    from app.services.storage import ext_for_mime
    assert ext_for_mime("application/pdf") == "pdf"


def test_ext_for_mime_unknown_returns_bin():
    from app.services.storage import ext_for_mime
    assert ext_for_mime("application/x-weird") == "bin"


def test_save_bytes_creates_file_returns_uuid_and_relpath():
    from app.services.storage import save_bytes, absolute_path
    uid, rel = save_bytes(b"hello world", "application/pdf")
    assert len(uid) == 36
    assert rel == f"{uid}.pdf"
    assert absolute_path(rel).read_bytes() == b"hello world"


def test_delete_file_idempotent():
    from app.services.storage import save_bytes, delete_file, absolute_path

    _, rel = save_bytes(b"data", "image/png")
    p = absolute_path(rel)
    assert p.exists()

    delete_file(rel)
    assert not p.exists()
    # second call must not raise
    delete_file(rel)

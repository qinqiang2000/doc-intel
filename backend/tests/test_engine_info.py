"""Tests for /api/v1/engine/info endpoint."""
from __future__ import annotations

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_engine_info_requires_auth(client):
    r = await client.get("/api/v1/engine/info")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_engine_info_lists_processors(client, registered_user):
    _, token = registered_user
    r = await client.get("/api/v1/engine/info", headers=_auth(token))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "processors" in data
    types = [p["type"] for p in data["processors"]]
    assert "mock" in types
    # gemini/openai/piaozone may or may not be present depending on SDK availability
    # but mock is always there
    for p in data["processors"]:
        assert "type" in p
        assert "models" in p
        assert isinstance(p["models"], list)

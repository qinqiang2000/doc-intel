"""Tests for /api/v1/templates."""
from __future__ import annotations

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_templates_requires_auth(client):
    r = await client.get("/api/v1/templates")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_templates_returns_five_builtins(client, registered_user):
    _, token = registered_user
    r = await client.get("/api/v1/templates", headers=_auth(token))
    assert r.status_code == 200, r.text
    arr = r.json()
    assert len(arr) == 5

    keys = {t["key"] for t in arr}
    assert keys == {"china_vat", "us_invoice", "japan_receipt", "de_rechnung", "custom"}

    for t in arr:
        assert isinstance(t["expected_fields"], list)
        assert t["recommended_processor"] in {"gemini", "openai", "piaozone", "mock"}
        assert t["display_name"]
        assert t["description"]


@pytest.mark.asyncio
async def test_custom_template_has_empty_expected_fields(client, registered_user):
    _, token = registered_user
    r = await client.get("/api/v1/templates", headers=_auth(token))
    custom = next(t for t in r.json() if t["key"] == "custom")
    assert custom["expected_fields"] == []

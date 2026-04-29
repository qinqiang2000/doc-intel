"""S5/T4: public /extract/{api_code} route tests."""
from __future__ import annotations

import io
import os
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _enable_mock(monkeypatch):
    """Force mock processor for all tests in this file."""
    monkeypatch.setenv("USE_MOCK_DATA", "1")


async def _setup_published_project(client, token: str):
    """Create + publish a project + create one key. Return (api_code, key, pid)."""
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-extract"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-extract", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    await client.post(
        f"/api/v1/projects/{pid}/publish", headers=_auth(token),
        json={"api_code": "extr-test"},
    )
    r3 = await client.post(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
        json={"name": "test"},
    )
    return "extr-test", r3.json()["key"], pid


@pytest.mark.asyncio
async def test_extract_happy_path_returns_structured_data(client, registered_user):
    _, token = registered_user
    api_code, api_key, _ = await _setup_published_project(client, token)
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": api_key},
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "document_id" in body
    assert "structured_data" in body


@pytest.mark.asyncio
async def test_extract_401_on_invalid_key(client, registered_user):
    _, token = registered_user
    api_code, _, _ = await _setup_published_project(client, token)
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": "dik_NOTAREALKEY"},
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 401, r.text
    assert r.json()["error"]["code"] == "invalid_api_key"


@pytest.mark.asyncio
async def test_extract_403_on_disabled(client, registered_user):
    _, token = registered_user
    api_code, api_key, pid = await _setup_published_project(client, token)
    await client.post(f"/api/v1/projects/{pid}/unpublish", headers=_auth(token))
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": api_key},
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "api_disabled"

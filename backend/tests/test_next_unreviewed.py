"""Tests for GET /api/v1/projects/{pid}/documents/next-unreviewed."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_project(client, token: str):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-nx"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-nx", "template_key": "custom"},
    )
    return r2.json()["id"]


@pytest.mark.asyncio
async def test_next_unreviewed_returns_first_unpredicted(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("a.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    r2 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("b.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    did1 = r1.json()["id"]
    await client.post(
        f"/api/v1/projects/{pid}/documents/{did1}/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    r = await client.get(
        f"/api/v1/projects/{pid}/documents/next-unreviewed",
        headers=_auth(token),
    )
    assert r.status_code == 200
    assert r.json()["id"] == r2.json()["id"]


@pytest.mark.asyncio
async def test_next_unreviewed_404_when_all_predicted(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("a.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    did = r1.json()["id"]
    await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    r = await client.get(
        f"/api/v1/projects/{pid}/documents/next-unreviewed",
        headers=_auth(token),
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "no_unreviewed_documents"


@pytest.mark.asyncio
async def test_next_unreviewed_skips_soft_deleted(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("a.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    did1 = r1.json()["id"]
    await client.delete(
        f"/api/v1/projects/{pid}/documents/{did1}",
        headers=_auth(token),
    )
    r = await client.get(
        f"/api/v1/projects/{pid}/documents/next-unreviewed",
        headers=_auth(token),
    )
    assert r.status_code == 404

"""Tests for /api/v1/workspaces/{wsid}/projects/*."""
from __future__ import annotations

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _create_workspace(client, token: str, slug: str = "demo") -> str:
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "Demo", "slug": slug},
    )
    return r.json()["id"]


@pytest.mark.asyncio
async def test_create_project_201(client, registered_user):
    user, token = registered_user
    wsid = await _create_workspace(client, token)
    r = await client.post(
        f"/api/v1/workspaces/{wsid}/projects",
        headers=_auth(token),
        json={"name": "Receipts", "slug": "receipts", "template_key": "japan_receipt"},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["slug"] == "receipts"
    assert data["template_key"] == "japan_receipt"
    assert data["created_by"] == user["id"]


@pytest.mark.asyncio
async def test_create_project_invalid_template_422(client, registered_user):
    _, token = registered_user
    wsid = await _create_workspace(client, token)
    r = await client.post(
        f"/api/v1/workspaces/{wsid}/projects",
        headers=_auth(token),
        json={"name": "X", "slug": "x-test", "template_key": "not_a_template"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_project_slug_unique_per_workspace(client, registered_user):
    _, token = registered_user
    wsid = await _create_workspace(client, token)
    body = {"name": "A", "slug": "dup-slug", "template_key": "custom"}
    await client.post(f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token), json=body)
    r = await client.post(f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token), json=body)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "project_slug_taken"


@pytest.mark.asyncio
async def test_list_projects_excludes_soft_deleted(client, registered_user):
    _, token = registered_user
    wsid = await _create_workspace(client, token)
    r = await client.post(
        f"/api/v1/workspaces/{wsid}/projects",
        headers=_auth(token),
        json={"name": "A", "slug": "aa-proj", "template_key": "custom"},
    )
    pid = r.json()["id"]

    listed = await client.get(f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token))
    assert len(listed.json()) == 1

    await client.delete(f"/api/v1/workspaces/{wsid}/projects/{pid}", headers=_auth(token))

    listed2 = await client.get(f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token))
    assert len(listed2.json()) == 0


@pytest.mark.asyncio
async def test_get_project_detail_includes_template_and_doc_count(client, registered_user):
    _, token = registered_user
    wsid = await _create_workspace(client, token)
    r = await client.post(
        f"/api/v1/workspaces/{wsid}/projects",
        headers=_auth(token),
        json={"name": "R", "slug": "rr-proj", "template_key": "japan_receipt"},
    )
    pid = r.json()["id"]

    detail = await client.get(f"/api/v1/workspaces/{wsid}/projects/{pid}", headers=_auth(token))
    assert detail.status_code == 200
    body = detail.json()
    assert body["template"]["key"] == "japan_receipt"
    assert body["document_count"] == 0


@pytest.mark.asyncio
async def test_patch_project_updates_name(client, registered_user):
    _, token = registered_user
    wsid = await _create_workspace(client, token)
    r = await client.post(
        f"/api/v1/workspaces/{wsid}/projects",
        headers=_auth(token),
        json={"name": "Old", "slug": "pp-proj", "template_key": "custom"},
    )
    pid = r.json()["id"]

    r2 = await client.patch(
        f"/api/v1/workspaces/{wsid}/projects/{pid}",
        headers=_auth(token),
        json={"name": "New"},
    )
    assert r2.status_code == 200
    assert r2.json()["name"] == "New"


@pytest.mark.asyncio
async def test_restore_soft_deleted_project(client, registered_user):
    _, token = registered_user
    wsid = await _create_workspace(client, token)
    r = await client.post(
        f"/api/v1/workspaces/{wsid}/projects",
        headers=_auth(token),
        json={"name": "P", "slug": "ppp-proj", "template_key": "custom"},
    )
    pid = r.json()["id"]

    await client.delete(f"/api/v1/workspaces/{wsid}/projects/{pid}", headers=_auth(token))
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects/{pid}/restore",
        headers=_auth(token),
    )
    assert r2.status_code == 200
    listed = await client.get(f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token))
    assert len(listed.json()) == 1


@pytest.mark.asyncio
async def test_non_member_cannot_see_projects(client, registered_user):
    _, owner_token = registered_user
    wsid = await _create_workspace(client, owner_token)
    await client.post(
        f"/api/v1/workspaces/{wsid}/projects",
        headers=_auth(owner_token),
        json={"name": "P", "slug": "pppp-proj", "template_key": "custom"},
    )

    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "other@x.com", "password": "secret123", "display_name": "O"},
    )
    other_token = other.json()["token"]

    r = await client.get(f"/api/v1/workspaces/{wsid}/projects", headers=_auth(other_token))
    assert r.status_code == 403

"""S5/T3: authed api_publish router tests."""
from __future__ import annotations

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_project(client, token: str, slug: str = "ws-pub"):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": slug},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-pub", "template_key": "custom"},
    )
    return r2.json()["id"]


@pytest.mark.asyncio
async def test_post_publish_returns_200_with_api_code(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/publish", headers=_auth(token),
        json={"api_code": "receipts"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["api_code"] == "receipts"
    assert body["api_published_at"] is not None
    assert body["api_disabled_at"] is None


@pytest.mark.asyncio
async def test_post_publish_409_on_taken_api_code(client, registered_user):
    _, token = registered_user
    p1 = await _setup_project(client, token, slug="ws-pub-a")
    p2 = await _setup_project(client, token, slug="ws-pub-b")
    await client.post(
        f"/api/v1/projects/{p1}/publish", headers=_auth(token),
        json={"api_code": "shared"},
    )
    r = await client.post(
        f"/api/v1/projects/{p2}/publish", headers=_auth(token),
        json={"api_code": "shared"},
    )
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "api_code_taken"


@pytest.mark.asyncio
async def test_post_unpublish_sets_disabled_at(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    await client.post(
        f"/api/v1/projects/{pid}/publish", headers=_auth(token),
        json={"api_code": "myapi"},
    )
    r = await client.post(
        f"/api/v1/projects/{pid}/unpublish", headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["api_disabled_at"] is not None


@pytest.mark.asyncio
async def test_create_api_key_returns_full_key_once(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
        json={"name": "production"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "production"
    assert body["key_prefix"].startswith("dik_")
    assert "key" in body
    assert body["key"].startswith("dik_")
    assert body["key"].startswith(body["key_prefix"])

    # GET list does NOT include 'key' field
    r2 = await client.get(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
    )
    assert r2.status_code == 200, r2.text
    items = r2.json()
    assert len(items) == 1
    assert "key" not in items[0]
    assert items[0]["key_prefix"] == body["key_prefix"]


@pytest.mark.asyncio
async def test_delete_api_key_204_and_excluded_from_list(client, registered_user):
    _, token = registered_user
    pid = await _setup_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
        json={"name": "tmp"},
    )
    kid = r.json()["id"]
    r2 = await client.delete(
        f"/api/v1/projects/{pid}/api-keys/{kid}", headers=_auth(token),
    )
    assert r2.status_code == 204, r2.text
    r3 = await client.get(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
    )
    assert r3.json() == []

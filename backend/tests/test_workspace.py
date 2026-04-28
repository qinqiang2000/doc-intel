"""Workspace endpoint tests."""
from __future__ import annotations

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_create_workspace_and_appears_in_list(client, registered_user):
    user, token = registered_user
    resp = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "Demo", "slug": "demo", "description": "First"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["slug"] == "demo"
    assert data["owner_id"] == user["id"]

    listed = await client.get("/api/v1/workspaces", headers=_auth(token))
    assert listed.status_code == 200
    arr = listed.json()
    assert len(arr) == 1 and arr[0]["slug"] == "demo" and arr[0]["role"] == "owner"


@pytest.mark.asyncio
async def test_workspace_slug_unique(client, registered_user):
    _, token = registered_user
    await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "A", "slug": "samesame"},
    )
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "B", "slug": "samesame"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "workspace_slug_taken"


@pytest.mark.asyncio
async def test_workspace_slug_validation(client, registered_user):
    _, token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "Bad", "slug": "Has Spaces"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_non_member_cannot_get_workspace(client, registered_user):
    _, token = registered_user
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token), json={"name": "X", "slug": "xws"}
    )
    ws_id = r.json()["id"]

    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "other@x.com", "password": "secret123", "display_name": "Other"},
    )
    other_token = other.json()["token"]

    r2 = await client.get(f"/api/v1/workspaces/{ws_id}", headers=_auth(other_token))
    assert r2.status_code == 403
    assert r2.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_owner_can_invite_member(client, registered_user):
    _, owner_token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(owner_token),
        json={"name": "Inv", "slug": "invws"},
    )
    ws_id = r.json()["id"]

    await client.post(
        "/api/v1/auth/register",
        json={"email": "guest@x.com", "password": "secret123", "display_name": "G"},
    )

    r2 = await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=_auth(owner_token),
        json={"email": "guest@x.com", "role": "member"},
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["email"] == "guest@x.com"


@pytest.mark.asyncio
async def test_member_cannot_invite(client, registered_user):
    _, owner_token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(owner_token),
        json={"name": "M", "slug": "mws"},
    )
    ws_id = r.json()["id"]

    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "m@x.com", "password": "secret123", "display_name": "M"},
    )
    other_token = other.json()["token"]

    await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=_auth(owner_token),
        json={"email": "m@x.com", "role": "member"},
    )

    r2 = await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=_auth(other_token),
        json={"email": "anybody@x.com", "role": "member"},
    )
    assert r2.status_code == 403


@pytest.mark.asyncio
async def test_invite_unknown_email_404(client, registered_user):
    _, token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "U", "slug": "uws"},
    )
    ws_id = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=_auth(token),
        json={"email": "nobody@x.com", "role": "member"},
    )
    assert r2.status_code == 404
    assert r2.json()["error"]["code"] == "user_not_found"


@pytest.mark.asyncio
async def test_owner_can_delete_workspace(client, registered_user):
    _, token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "Del", "slug": "delws"},
    )
    ws_id = r.json()["id"]
    r2 = await client.delete(f"/api/v1/workspaces/{ws_id}", headers=_auth(token))
    assert r2.status_code == 204
    r3 = await client.get(f"/api/v1/workspaces/{ws_id}", headers=_auth(token))
    assert r3.status_code == 403  # not a member after delete


@pytest.mark.asyncio
async def test_cannot_remove_owner(client, registered_user):
    user, token = registered_user
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "RO", "slug": "rows"},
    )
    ws_id = r.json()["id"]
    r2 = await client.delete(
        f"/api/v1/workspaces/{ws_id}/members/{user['id']}", headers=_auth(token)
    )
    assert r2.status_code == 400
    assert r2.json()["error"]["code"] == "cannot_remove_owner"

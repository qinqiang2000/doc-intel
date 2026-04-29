"""S3/T2: prompts router tests."""
from __future__ import annotations

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_workspace_project(client, token: str, template_key: str = "custom"):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-pmt"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-pmt", "template_key": template_key},
    )
    return wsid, r2.json()["id"]


@pytest.mark.asyncio
async def test_list_prompt_versions_returns_array_with_active_flag(client, registered_user):
    _, token = registered_user
    _, pid = await _setup_workspace_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/prompt-versions", headers=_auth(token),
        json={"prompt_text": "v1 body", "summary": "first"},
    )
    assert r.status_code == 201, r.text
    pv = r.json()
    r = await client.patch(
        f"/api/v1/projects/{pid}/active-prompt", headers=_auth(token),
        json={"version_id": pv["id"]},
    )
    assert r.status_code == 200, r.text

    r = await client.get(
        f"/api/v1/projects/{pid}/prompt-versions", headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data) == 1
    assert data[0]["version"] == 1
    assert data[0]["is_active"] is True
    assert data[0]["prompt_text"] == "v1 body"


@pytest.mark.asyncio
async def test_create_prompt_version_returns_201_and_increments(client, registered_user):
    _, token = registered_user
    _, pid = await _setup_workspace_project(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/prompt-versions", headers=_auth(token),
        json={"prompt_text": "first", "summary": "a"},
    )
    r2 = await client.post(
        f"/api/v1/projects/{pid}/prompt-versions", headers=_auth(token),
        json={"prompt_text": "second", "summary": "b"},
    )
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["version"] == 1
    assert r2.json()["version"] == 2
    assert r1.json()["is_active"] is False


@pytest.mark.asyncio
async def test_patch_active_prompt_accepts_null_to_revert_to_template(client, registered_user):
    _, token = registered_user
    _, pid = await _setup_workspace_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/prompt-versions", headers=_auth(token),
        json={"prompt_text": "v1", "summary": ""},
    )
    pv = r.json()
    await client.patch(
        f"/api/v1/projects/{pid}/active-prompt", headers=_auth(token),
        json={"version_id": pv["id"]},
    )
    r = await client.patch(
        f"/api/v1/projects/{pid}/active-prompt", headers=_auth(token),
        json={"version_id": None},
    )
    assert r.status_code == 200, r.text
    assert r.json()["active_prompt_version_id"] is None


@pytest.mark.asyncio
async def test_delete_prompt_version_refuses_active(client, registered_user):
    _, token = registered_user
    _, pid = await _setup_workspace_project(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/prompt-versions", headers=_auth(token),
        json={"prompt_text": "active", "summary": ""},
    )
    pv = r.json()
    await client.patch(
        f"/api/v1/projects/{pid}/active-prompt", headers=_auth(token),
        json={"version_id": pv["id"]},
    )
    r = await client.delete(
        f"/api/v1/projects/{pid}/prompt-versions/{pv['id']}",
        headers=_auth(token),
    )
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "prompt_in_use"

    # deactivate then delete should succeed
    await client.patch(
        f"/api/v1/projects/{pid}/active-prompt", headers=_auth(token),
        json={"version_id": None},
    )
    r = await client.delete(
        f"/api/v1/projects/{pid}/prompt-versions/{pv['id']}",
        headers=_auth(token),
    )
    assert r.status_code == 204, r.text

    r = await client.get(
        f"/api/v1/projects/{pid}/prompt-versions", headers=_auth(token),
    )
    assert r.json() == []

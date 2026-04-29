"""S4/T4: evaluations router tests."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_with_doc(client, token: str):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-eval"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-eval", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    r3 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
    )
    did = r3.json()["id"]
    # predict via mock so a ProcessingResult exists
    await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict", headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    return pid, did


@pytest.mark.asyncio
async def test_post_evaluation_returns_201_with_run_summary(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token),
        json={"name": "first run"},
    )
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["name"] == "first run"
    assert run["status"] == "completed"
    assert "accuracy_avg" in run


@pytest.mark.asyncio
async def test_get_evaluations_list_excludes_soft_deleted(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token),
        json={"name": "r1"},
    )
    await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token),
        json={"name": "r2"},
    )
    rid1 = r1.json()["id"]
    # soft-delete r1
    await client.delete(f"/api/v1/evaluations/{rid1}", headers=_auth(token))

    r = await client.get(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token),
    )
    assert r.status_code == 200
    items = r.json()
    names = [x["name"] for x in items]
    assert "r2" in names
    assert "r1" not in names


@pytest.mark.asyncio
async def test_get_evaluation_detail_returns_run_and_fields(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token), json={},
    )
    rid = r.json()["id"]
    r2 = await client.get(
        f"/api/v1/evaluations/{rid}", headers=_auth(token),
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["run"]["id"] == rid
    assert isinstance(body["fields"], list)


@pytest.mark.asyncio
async def test_delete_evaluation_returns_204(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/evaluations", headers=_auth(token), json={},
    )
    rid = r.json()["id"]
    r2 = await client.delete(
        f"/api/v1/evaluations/{rid}", headers=_auth(token),
    )
    assert r2.status_code == 204, r2.text
    # Subsequent detail GET should 404
    r3 = await client.get(
        f"/api/v1/evaluations/{rid}", headers=_auth(token),
    )
    assert r3.status_code == 404

"""Tests for POST /api/v1/projects/{pid}/documents/{did}/predict (single doc)."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_project_with_doc(client, token: str, template_key: str = "custom"):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-aa"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-aa", "template_key": template_key},
    )
    pid = r2.json()["id"]
    r3 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
    )
    return wsid, pid, r3.json()["id"]


@pytest.mark.asyncio
async def test_predict_single_mock_processor(client, registered_user):
    user, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token, template_key="custom")
    r = await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["source"] == "predict"
    assert data["processor_key"].startswith("mock")
    assert data["created_by"] == user["id"]
    assert isinstance(data["structured_data"], (dict, list))


@pytest.mark.asyncio
async def test_predict_same_model_prompt_upserts_one_row(client, registered_user):
    """Re-running same processor + prompt overwrites the same row,
    instead of creating a new version (see migration b7e3a92f5d10)."""
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    ids = []
    for _ in range(3):
        r = await client.post(
            f"/api/v1/projects/{pid}/documents/{did}/predict",
            headers=_auth(token),
            json={"processor_key_override": "mock"},
        )
        assert r.status_code == 200
        ids.append(r.json()["id"])
    assert len(set(ids)) == 1, "expected upsert to reuse one row id"


@pytest.mark.asyncio
async def test_predict_seeds_annotations(client, registered_user):
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    r = await client.get(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) > 0
    assert all(a["source"] == "ai_detected" for a in items)


@pytest.mark.asyncio
async def test_predict_prompt_override_recorded(client, registered_user):
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    custom_prompt = "Custom override prompt — extract just one field."
    r = await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"prompt_override": custom_prompt, "processor_key_override": "mock"},
    )
    assert r.status_code == 200
    assert r.json()["prompt_used"] == custom_prompt


@pytest.mark.asyncio
async def test_predict_unknown_processor_400(client, registered_user):
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/documents/{did}/predict",
        headers=_auth(token),
        json={"processor_key_override": "nonexistent"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "processor_not_available"


@pytest.mark.asyncio
async def test_predict_404_for_missing_document(client, registered_user):
    _, token = registered_user
    _, pid, _ = await _setup_project_with_doc(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/documents/00000000-0000-0000-0000-000000000000/predict",
        headers=_auth(token),
        json={"processor_key_override": "mock"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_results_empty_when_never_predicted(client, registered_user):
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    r = await client.get(
        f"/api/v1/projects/{pid}/documents/{did}/predict/results",
        headers=_auth(token),
    )
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_results_distinct_per_model_prompt(client, registered_user):
    """Each (processor_key, prompt) gets one tab; re-runs do not multiply rows.
    Three runs with two distinct prompts yield exactly two rows."""
    _, token = registered_user
    _, pid, did = await _setup_project_with_doc(client, token)
    payloads = [
        {"processor_key_override": "mock", "prompt_override": "extract A"},
        {"processor_key_override": "mock", "prompt_override": "extract B"},
        {"processor_key_override": "mock", "prompt_override": "extract A"},
    ]
    for body in payloads:
        r = await client.post(
            f"/api/v1/projects/{pid}/documents/{did}/predict",
            headers=_auth(token),
            json=body,
        )
        assert r.status_code == 200
    r = await client.get(
        f"/api/v1/projects/{pid}/documents/{did}/predict/results",
        headers=_auth(token),
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    prompts = sorted(it["prompt_used"] for it in items)
    assert prompts == ["extract A", "extract B"]

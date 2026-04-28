"""Tests for POST /api/v1/projects/{pid}/batch-predict (SSE)."""
from __future__ import annotations

import io
import json
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_n_docs(client, token: str, n: int = 2):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-bb"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-bb", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    dids: list[str] = []
    for i in range(n):
        r3 = await client.post(
            f"/api/v1/projects/{pid}/documents", headers=_auth(token),
            files={"file": (f"d{i}.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
        )
        dids.append(r3.json()["id"])
    return pid, dids


def _parse_sse(text: str) -> list[dict]:
    events: list[dict] = []
    for block in text.strip().split("\n\n"):
        event = {"event": "message", "data": ""}
        for line in block.split("\n"):
            if line.startswith("event:"):
                event["event"] = line[6:].strip()
            elif line.startswith("data:"):
                event["data"] += line[5:].strip()
        if event["data"]:
            event["data"] = json.loads(event["data"])
            events.append(event)
    return events


@pytest.mark.asyncio
async def test_batch_predict_emits_started_completed_done(client, registered_user):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=2)

    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": dids, "processor_key_override": "mock"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(r.text)
    statuses = [e["data"].get("status") for e in events if e["event"] == "predict_progress"]
    assert statuses.count("started") == 2
    assert statuses.count("completed") == 2
    done = [e for e in events if e["event"] == "done"]
    assert len(done) == 1
    assert done[0]["data"]["total"] == 2
    assert done[0]["data"]["succeeded"] == 2
    assert done[0]["data"]["failed"] == 0


@pytest.mark.asyncio
async def test_batch_predict_handles_unknown_doc(client, registered_user):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=1)
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": dids + ["00000000-0000-0000-0000-000000000000"], "processor_key_override": "mock"},
    )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    failed = [e for e in events if e["event"] == "predict_progress" and e["data"].get("status") == "failed"]
    assert len(failed) == 1
    done = [e for e in events if e["event"] == "done"][0]
    assert done["data"]["failed"] == 1
    assert done["data"]["succeeded"] == 1


@pytest.mark.asyncio
async def test_batch_predict_empty_list_422(client, registered_user):
    _, token = registered_user
    pid, _ = await _setup_n_docs(client, token, n=0)
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": [], "processor_key_override": "mock"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_batch_predict_unknown_processor_returns_failed_per_doc(client, registered_user):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=1)
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": dids, "processor_key_override": "nonexistent"},
    )
    assert r.status_code == 200
    events = _parse_sse(r.text)
    failed = [e for e in events if e["event"] == "predict_progress" and e["data"].get("status") == "failed"]
    assert len(failed) == 1


@pytest.mark.asyncio
async def test_batch_predict_writes_processing_results(client, registered_user, db_session):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=2)
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(token),
        json={"document_ids": dids, "processor_key_override": "mock"},
    )
    assert r.status_code == 200
    from sqlalchemy import select
    from app.models.processing_result import ProcessingResult
    rows = (await db_session.execute(select(ProcessingResult))).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_batch_predict_403_for_non_member(client, registered_user):
    _, token = registered_user
    pid, dids = await _setup_n_docs(client, token, n=1)
    other = await client.post(
        "/api/v1/auth/register",
        json={"email": "x@x.com", "password": "secret123", "display_name": "X"},
    )
    other_token = other.json()["token"]
    r = await client.post(
        f"/api/v1/projects/{pid}/batch-predict",
        headers=_auth(other_token),
        json={"document_ids": dids, "processor_key_override": "mock"},
    )
    assert r.status_code == 403

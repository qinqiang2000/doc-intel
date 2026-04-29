"""S3/T5: correction SSE route tests."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_with_doc(client, token: str):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-cor"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-cor", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    r3 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
    )
    return pid, r3.json()["id"]


@pytest.mark.asyncio
async def test_correct_endpoint_requires_auth(client):
    """Unauthed POST → 401/403."""
    r = await client.post(
        "/api/v1/projects/00000000-0000-0000-0000-000000000000/documents/00000000-0000-0000-0000-000000000000/correct",
        json={
            "user_message": "x",
            "current_prompt": "y",
            "target_field": None,
            "processor_key_override": "mock|m",
        },
    )
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_correct_endpoint_streams_sse_events(client, registered_user):
    _, token = registered_user
    pid, did = await _setup_with_doc(client, token)

    body = b""
    async with client.stream(
        "POST",
        f"/api/v1/projects/{pid}/documents/{did}/correct",
        headers=_auth(token),
        json={
            "user_message": "hi",
            "current_prompt": "orig",
            "target_field": None,
            "processor_key_override": "mock|m",
        },
    ) as r:
        assert r.status_code == 200, await r.aread()
        assert r.headers["content-type"].startswith("text/event-stream")
        async for chunk in r.aiter_bytes():
            body += chunk

    text = body.decode()
    events = [
        line.split(":", 1)[1].strip()
        for line in text.splitlines()
        if line.startswith("event:")
    ]
    assert "prompt_token" in events
    assert events.index("revised_prompt") > events.index("prompt_token")
    assert "predict_started" in events
    assert "predict_result" in events
    assert events[-1] == "done"

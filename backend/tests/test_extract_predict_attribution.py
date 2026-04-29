"""S5/T5: extract endpoint persistence + attribution tests."""
from __future__ import annotations

import io
import pytest
from sqlalchemy import select


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _enable_mock(monkeypatch):
    """Force mock processor for all tests in this file."""
    monkeypatch.setenv("USE_MOCK_DATA", "1")


async def _setup_published_project(client, token: str):
    """Create + publish + create key. Return (api_code, full_key, pid, key_creator_id)."""
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-attr"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-attr", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    await client.post(
        f"/api/v1/projects/{pid}/publish", headers=_auth(token),
        json={"api_code": "attr-test"},
    )
    r3 = await client.post(
        f"/api/v1/projects/{pid}/api-keys", headers=_auth(token),
        json={"name": "test"},
    )
    return "attr-test", r3.json()["key"], pid, r3.json()["created_by"]


@pytest.mark.asyncio
async def test_extract_persists_document_with_correct_uploader(
    client, registered_user, db_engine,
):
    """Document.uploaded_by should be api_key.created_by."""
    user, token = registered_user
    api_code, api_key, _, key_creator_id = await _setup_published_project(client, token)
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": api_key},
        files={"file": ("attr.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 200, r.text
    doc_id = r.json()["document_id"]

    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    from app.models.document import Document
    Session = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        doc = (await s.execute(
            select(Document).where(Document.id == doc_id)
        )).scalar_one()
        assert doc.uploaded_by == key_creator_id
        assert doc.uploaded_by == user["id"]


@pytest.mark.asyncio
async def test_extract_persists_processing_result(
    client, registered_user, db_engine,
):
    """ProcessingResult should be created for the public-extract document."""
    _, token = registered_user
    api_code, api_key, _, _ = await _setup_published_project(client, token)
    r = await client.post(
        f"/extract/{api_code}",
        headers={"X-Api-Key": api_key},
        files={"file": ("pr.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={},
    )
    assert r.status_code == 200
    doc_id = r.json()["document_id"]

    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    from app.models.processing_result import ProcessingResult
    Session = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        pr = (await s.execute(
            select(ProcessingResult).where(ProcessingResult.document_id == doc_id)
        )).scalar_one()
        assert pr.version == 1
        assert pr.source == "predict"

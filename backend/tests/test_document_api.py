"""Tests for /api/v1/projects/{pid}/documents/*."""
from __future__ import annotations

import io

import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup(client, token: str) -> tuple[str, str]:
    """Create a workspace + project; return (workspace_id, project_id)."""
    r = await client.post(
        "/api/v1/workspaces",
        headers=_auth(token),
        json={"name": "Demo", "slug": "demo-ws"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects",
        headers=_auth(token),
        json={"name": "P", "slug": "proj-aa", "template_key": "custom"},
    )
    return wsid, r2.json()["id"]


def _pdf_file(content: bytes = b"%PDF-1.4 fake", name: str = "x.pdf") -> tuple:
    return (name, io.BytesIO(content), "application/pdf")


@pytest.mark.asyncio
async def test_upload_document_201(client, registered_user):
    user, token = registered_user
    _, pid = await _setup(client, token)

    files = {"file": _pdf_file(b"hello", "invoice.pdf")}
    r = await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files=files,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["filename"] == "invoice.pdf"
    assert data["status"] == "ready"
    assert data["mime_type"] == "application/pdf"
    assert data["file_size"] == 5
    assert data["uploaded_by"] == user["id"]
    assert data["is_ground_truth"] is False


@pytest.mark.asyncio
async def test_upload_unsupported_mime_400(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    files = {"file": ("x.docx", io.BytesIO(b"PK\x03\x04"),
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    r = await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files=files,
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "unsupported_file_type"


@pytest.mark.asyncio
async def test_upload_too_large_413(client, registered_user, monkeypatch):
    _, token = registered_user
    _, pid = await _setup(client, token)
    monkeypatch.setenv("MAX_UPLOAD_SIZE", str(10))  # 10 bytes
    from app.core import config as cfg_mod
    cfg_mod.get_settings.cache_clear()

    files = {"file": _pdf_file(b"x" * 100)}
    r = await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files=files,
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "file_too_large"


@pytest.mark.asyncio
async def test_list_documents_pagination(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    for i in range(5):
        await client.post(
            f"/api/v1/projects/{pid}/documents",
            headers=_auth(token),
            files={"file": _pdf_file(name=f"f{i}.pdf")},
        )

    r = await client.get(
        f"/api/v1/projects/{pid}/documents?page=1&page_size=2",
        headers=_auth(token),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 5
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["items"]) == 2


@pytest.mark.asyncio
async def test_list_filter_by_filename(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    for n in ["alpha.pdf", "beta.pdf", "alpha2.pdf"]:
        await client.post(
            f"/api/v1/projects/{pid}/documents",
            headers=_auth(token),
            files={"file": _pdf_file(name=n)},
        )

    r = await client.get(
        f"/api/v1/projects/{pid}/documents?q=alpha",
        headers=_auth(token),
    )
    assert r.json()["total"] == 2


@pytest.mark.asyncio
async def test_list_filter_by_ground_truth(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    r1 = await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files={"file": _pdf_file(name="aa.pdf")},
    )
    did = r1.json()["id"]
    await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files={"file": _pdf_file(name="bb.pdf")},
    )
    await client.patch(
        f"/api/v1/projects/{pid}/documents/{did}",
        headers=_auth(token),
        json={"is_ground_truth": True},
    )

    r = await client.get(
        f"/api/v1/projects/{pid}/documents?is_ground_truth=true",
        headers=_auth(token),
    )
    assert r.json()["total"] == 1


@pytest.mark.asyncio
async def test_list_sort_by_filename_asc(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    for n in ["c.pdf", "a.pdf", "b.pdf"]:
        await client.post(
            f"/api/v1/projects/{pid}/documents",
            headers=_auth(token),
            files={"file": _pdf_file(name=n)},
        )
    r = await client.get(
        f"/api/v1/projects/{pid}/documents?sort_by=filename&order=asc",
        headers=_auth(token),
    )
    names = [item["filename"] for item in r.json()["items"]]
    assert names == ["a.pdf", "b.pdf", "c.pdf"]


@pytest.mark.asyncio
async def test_get_document_detail(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files={"file": _pdf_file(name="x.pdf")},
    )
    did = r.json()["id"]
    r2 = await client.get(
        f"/api/v1/projects/{pid}/documents/{did}",
        headers=_auth(token),
    )
    assert r2.status_code == 200
    assert r2.json()["id"] == did


@pytest.mark.asyncio
async def test_preview_returns_file_bytes(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files={"file": _pdf_file(content=b"PDFCONTENT", name="x.pdf")},
    )
    did = r.json()["id"]
    r2 = await client.get(
        f"/api/v1/projects/{pid}/documents/{did}/preview",
        headers=_auth(token),
    )
    assert r2.status_code == 200
    assert r2.content == b"PDFCONTENT"
    assert "x.pdf" in r2.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_set_ground_truth(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files={"file": _pdf_file()},
    )
    did = r.json()["id"]
    r2 = await client.patch(
        f"/api/v1/projects/{pid}/documents/{did}",
        headers=_auth(token),
        json={"is_ground_truth": True},
    )
    assert r2.status_code == 200
    assert r2.json()["is_ground_truth"] is True


@pytest.mark.asyncio
async def test_soft_delete_excludes_from_list(client, registered_user):
    _, token = registered_user
    _, pid = await _setup(client, token)
    r = await client.post(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
        files={"file": _pdf_file()},
    )
    did = r.json()["id"]
    await client.delete(
        f"/api/v1/projects/{pid}/documents/{did}",
        headers=_auth(token),
    )
    r2 = await client.get(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
    )
    assert r2.json()["total"] == 0


@pytest.mark.asyncio
async def test_documents_404_when_project_soft_deleted(client, registered_user):
    _, token = registered_user
    wsid, pid = await _setup(client, token)
    await client.delete(
        f"/api/v1/workspaces/{wsid}/projects/{pid}",
        headers=_auth(token),
    )
    r = await client.get(
        f"/api/v1/projects/{pid}/documents",
        headers=_auth(token),
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "project_not_found"

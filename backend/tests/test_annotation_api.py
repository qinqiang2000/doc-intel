"""Tests for /api/v1/documents/{did}/annotations/*."""
from __future__ import annotations

import io
import pytest


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup_doc(client, token: str):
    r = await client.post(
        "/api/v1/workspaces", headers=_auth(token),
        json={"name": "W", "slug": "ws-ann"},
    )
    wsid = r.json()["id"]
    r2 = await client.post(
        f"/api/v1/workspaces/{wsid}/projects", headers=_auth(token),
        json={"name": "P", "slug": "proj-ann", "template_key": "custom"},
    )
    pid = r2.json()["id"]
    r3 = await client.post(
        f"/api/v1/projects/{pid}/documents", headers=_auth(token),
        files={"file": ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    return r3.json()["id"]


@pytest.mark.asyncio
async def test_post_manual_annotation(client, registered_user):
    user, token = registered_user
    did = await _setup_doc(client, token)
    r = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "buyer_name", "field_value": "Acme"},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["source"] == "manual"
    assert data["created_by"] == user["id"]
    assert data["field_value"] == "Acme"


@pytest.mark.asyncio
async def test_get_list_filters_deleted(client, registered_user):
    _, token = registered_user
    did = await _setup_doc(client, token)
    r1 = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "1"},
    )
    aid = r1.json()["id"]
    await client.delete(
        f"/api/v1/documents/{did}/annotations/{aid}",
        headers=_auth(token),
    )
    r = await client.get(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
    )
    assert r.status_code == 200
    assert all(a["id"] != aid for a in r.json())


@pytest.mark.asyncio
async def test_patch_updates_value_and_writes_revision(client, registered_user, db_session):
    _, token = registered_user
    did = await _setup_doc(client, token)
    r1 = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "v1"},
    )
    aid = r1.json()["id"]
    r2 = await client.patch(
        f"/api/v1/documents/{did}/annotations/{aid}",
        headers=_auth(token),
        json={"field_value": "v2"},
    )
    assert r2.status_code == 200
    assert r2.json()["field_value"] == "v2"

    # Verify revision row exists in DB
    from sqlalchemy import select
    from app.models.annotation_revision import AnnotationRevision, RevisionAction
    revs = (await db_session.execute(
        select(AnnotationRevision).where(AnnotationRevision.annotation_id == aid)
    )).scalars().all()
    actions = [r.action for r in revs]
    assert RevisionAction.UPDATE in actions


@pytest.mark.asyncio
async def test_patch_sets_updated_by(client, registered_user, db_session):
    user, token = registered_user
    did = await _setup_doc(client, token)
    r1 = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "v1"},
    )
    aid = r1.json()["id"]
    await client.patch(
        f"/api/v1/documents/{did}/annotations/{aid}",
        headers=_auth(token),
        json={"field_value": "v2"},
    )
    from sqlalchemy import select
    from app.models.annotation import Annotation
    a = (await db_session.execute(select(Annotation).where(Annotation.id == aid))).scalar_one()
    assert a.updated_by_user_id == user["id"]


@pytest.mark.asyncio
async def test_delete_writes_revision(client, registered_user, db_session):
    _, token = registered_user
    did = await _setup_doc(client, token)
    r1 = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "v1"},
    )
    aid = r1.json()["id"]
    r2 = await client.delete(
        f"/api/v1/documents/{did}/annotations/{aid}",
        headers=_auth(token),
    )
    assert r2.status_code == 204
    from sqlalchemy import select
    from app.models.annotation_revision import AnnotationRevision, RevisionAction
    revs = (await db_session.execute(
        select(AnnotationRevision).where(AnnotationRevision.annotation_id == aid)
    )).scalars().all()
    assert any(r.action == RevisionAction.DELETE for r in revs)


@pytest.mark.asyncio
async def test_create_writes_revision(client, registered_user, db_session):
    _, token = registered_user
    did = await _setup_doc(client, token)
    r = await client.post(
        f"/api/v1/documents/{did}/annotations",
        headers=_auth(token),
        json={"field_name": "a", "field_value": "v"},
    )
    aid = r.json()["id"]
    from sqlalchemy import select
    from app.models.annotation_revision import AnnotationRevision, RevisionAction
    revs = (await db_session.execute(
        select(AnnotationRevision).where(AnnotationRevision.annotation_id == aid)
    )).scalars().all()
    assert any(r.action == RevisionAction.CREATE for r in revs)

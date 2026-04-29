"""S5/T1: ApiKey + Project ALTER tests."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_project_has_api_publish_columns(db_session, seed_project):
    # All three new fields default to None
    assert hasattr(seed_project, "api_code")
    assert seed_project.api_code is None
    assert hasattr(seed_project, "api_published_at")
    assert seed_project.api_published_at is None
    assert hasattr(seed_project, "api_disabled_at")
    assert seed_project.api_disabled_at is None


@pytest.mark.asyncio
async def test_api_key_basic_insert(db_session, seed_project, seed_user):
    from app.models.api_key import ApiKey

    k = ApiKey(
        project_id=seed_project.id,
        name="production",
        key_prefix="dik_AbCdEfGh",
        key_hash="$2b$10$abc123",  # placeholder; real hashes in T2
        is_active=True,
        created_by=seed_user.id,
    )
    db_session.add(k)
    await db_session.commit()
    out = (await db_session.execute(select(ApiKey))).scalar_one()
    assert out.name == "production"
    assert out.key_prefix == "dik_AbCdEfGh"
    assert out.is_active is True
    assert out.deleted_at is None


@pytest.mark.asyncio
async def test_api_key_soft_delete_excluded(db_session, seed_project, seed_user):
    from app.models.api_key import ApiKey

    k = ApiKey(
        project_id=seed_project.id, name="x",
        key_prefix="dik_X", key_hash="$2b$10$y",
        created_by=seed_user.id,
    )
    db_session.add(k)
    await db_session.commit()

    k.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    out = (await db_session.execute(
        select(ApiKey).where(ApiKey.deleted_at.is_(None))
    )).scalars().all()
    assert out == []


@pytest.mark.asyncio
async def test_project_delete_cascades_to_api_keys(db_session, seed_project, seed_user):
    """Deleting a Project hard-removes its api_keys via FK CASCADE."""
    from app.models.api_key import ApiKey
    from app.models.project import Project

    k = ApiKey(
        project_id=seed_project.id, name="x",
        key_prefix="dik_X", key_hash="$2b$10$y",
        created_by=seed_user.id,
    )
    db_session.add(k)
    await db_session.commit()

    proj = (await db_session.execute(
        select(Project).where(Project.id == seed_project.id)
    )).scalar_one()
    await db_session.delete(proj)
    await db_session.commit()

    rows = (await db_session.execute(select(ApiKey))).scalars().all()
    assert rows == []

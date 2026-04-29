"""S3/T1: prompt_service unit tests."""
from __future__ import annotations

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_create_prompt_version_assigns_increasing_version(db_session, seed_project, seed_user):
    from app.services import prompt_service as svc
    from app.models.prompt_version import PromptVersion

    v1 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="first", summary="a",
    )
    v2 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="second", summary="b",
    )
    assert v1.version == 1
    assert v2.version == 2
    rows = (await db_session.execute(select(PromptVersion))).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_list_prompt_versions_excludes_soft_deleted_and_orders_desc(db_session, seed_project, seed_user):
    from app.services import prompt_service as svc
    from datetime import datetime, timezone

    v1 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="first", summary="a",
    )
    await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="second", summary="b",
    )
    v1.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    rows = await svc.list_prompt_versions(db_session, project_id=seed_project.id)
    assert [r.version for r in rows] == [2]


@pytest.mark.asyncio
async def test_set_active_prompt_updates_project(db_session, seed_project, seed_user):
    from app.services import prompt_service as svc

    v1 = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="first", summary="",
    )
    proj = await svc.set_active_prompt(
        db_session, project_id=seed_project.id, version_id=v1.id,
    )
    assert proj.active_prompt_version_id == v1.id
    proj2 = await svc.set_active_prompt(
        db_session, project_id=seed_project.id, version_id=None,
    )
    assert proj2.active_prompt_version_id is None

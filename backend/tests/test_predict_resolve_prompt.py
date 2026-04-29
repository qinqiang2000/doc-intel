"""S3/T6: predict_service.resolve_prompt priority tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_resolve_prompt_uses_override_over_active_version(db_session, seed_project, seed_user):
    from app.services.predict import resolve_prompt
    from app.services import prompt_service as svc

    pv = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="ACTIVE", summary="",
    )
    await svc.set_active_prompt(
        db_session, project_id=seed_project.id, version_id=pv.id,
    )
    await db_session.refresh(seed_project)

    out = await resolve_prompt(
        db_session, project=seed_project, prompt_override="EXPLICIT",
    )
    assert out == "EXPLICIT"


@pytest.mark.asyncio
async def test_resolve_prompt_uses_active_version_when_no_override(db_session, seed_project, seed_user):
    from app.services.predict import resolve_prompt
    from app.services import prompt_service as svc

    pv = await svc.create_prompt_version(
        db_session, project_id=seed_project.id, user=seed_user,
        prompt_text="FROM_VERSION", summary="",
    )
    await svc.set_active_prompt(
        db_session, project_id=seed_project.id, version_id=pv.id,
    )
    await db_session.refresh(seed_project)

    out = await resolve_prompt(
        db_session, project=seed_project, prompt_override=None,
    )
    assert out == "FROM_VERSION"

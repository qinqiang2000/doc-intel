"""S5/T2: api_publish_service tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_generate_api_key_returns_dik_prefix_and_bcrypt_hash():
    from app.services.api_publish_service import generate_api_key

    full, prefix, hashed = generate_api_key()
    assert full.startswith("dik_")
    assert len(full) >= 40  # dik_ + base64-safe(32) ≈ 47
    assert prefix == full[:12]
    assert hashed.startswith("$2b$")  # bcrypt prefix


@pytest.mark.asyncio
async def test_verify_api_key_matches_only_correct_plaintext():
    from app.services.api_publish_service import generate_api_key, _verify_one
    full, _, hashed = generate_api_key()
    assert _verify_one(full, hashed) is True
    assert _verify_one("dik_wrong", hashed) is False


@pytest.mark.asyncio
async def test_publish_project_transitions_draft_to_published(db_session, seed_project, seed_user):
    from app.services.api_publish_service import publish_project

    proj = await publish_project(
        db_session, project_id=seed_project.id,
        user=seed_user, api_code="receipts",
    )
    assert proj.api_code == "receipts"
    assert proj.api_published_at is not None
    assert proj.api_disabled_at is None


@pytest.mark.asyncio
async def test_publish_rejects_changing_api_code_after_set(db_session, seed_project, seed_user):
    from app.core.exceptions import AppError
    from app.services.api_publish_service import publish_project

    await publish_project(
        db_session, project_id=seed_project.id,
        user=seed_user, api_code="receipts",
    )
    with pytest.raises(AppError) as exc_info:
        await publish_project(
            db_session, project_id=seed_project.id,
            user=seed_user, api_code="something-else",
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "api_code_immutable"

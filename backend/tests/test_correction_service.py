"""S3/T4: correction_service tests (mock processor)."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_stream_correction_emits_prompt_tokens_then_revised(db_session, seed_project, seed_user):
    from app.services.correction_service import stream_correction
    from app.models.document import Document
    doc = Document(
        project_id=seed_project.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    events: list[dict] = []
    async for evt in stream_correction(
        db_session,
        project=seed_project,
        document=doc,
        user=seed_user,
        user_message="hello world",
        current_prompt="orig",
        target_field=None,
        processor_key_override="mock|m",
    ):
        events.append(evt)

    types = [e["event"] for e in events]
    assert "prompt_token" in types
    assert "revised_prompt" in types
    assert "predict_started" in types
    assert "predict_result" in types
    assert types[-1] == "done"


@pytest.mark.asyncio
async def test_stream_correction_revised_prompt_assembles_tokens(db_session, seed_project, seed_user):
    from app.services.correction_service import stream_correction
    from app.models.document import Document
    doc = Document(
        project_id=seed_project.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()

    events = []
    async for evt in stream_correction(
        db_session, project=seed_project, document=doc, user=seed_user,
        user_message="hi", current_prompt="orig", target_field=None,
        processor_key_override="mock|m",
    ):
        events.append(evt)

    revised = next(e for e in events if e["event"] == "revised_prompt")
    # mock yields: "REVISED: " + user_payload + " END". user_payload includes "REVISION REQUEST:\nhi".
    assert revised["data"]["prompt_text"].startswith("REVISED: ")
    assert "hi" in revised["data"]["prompt_text"]
    assert revised["data"]["prompt_text"].endswith(" END")


@pytest.mark.asyncio
async def test_stream_correction_predict_result_does_not_persist_processing_result(
    db_session, seed_project, seed_user,
):
    from app.services.correction_service import stream_correction
    from app.models.document import Document
    from app.models.processing_result import ProcessingResult
    from sqlalchemy import select

    doc = Document(
        project_id=seed_project.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()

    async for _ in stream_correction(
        db_session, project=seed_project, document=doc, user=seed_user,
        user_message="hi", current_prompt="orig", target_field=None,
        processor_key_override="mock|m",
    ):
        pass

    rows = (await db_session.execute(select(ProcessingResult))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_stream_correction_emits_error_on_unknown_processor(db_session, seed_project, seed_user):
    from app.services.correction_service import stream_correction
    from app.models.document import Document
    doc = Document(
        project_id=seed_project.id, filename="x.pdf", file_path="x.pdf",
        file_size=10, mime_type="application/pdf", uploaded_by=seed_user.id,
    )
    db_session.add(doc)
    await db_session.commit()

    events = []
    async for evt in stream_correction(
        db_session, project=seed_project, document=doc, user=seed_user,
        user_message="hi", current_prompt="orig", target_field=None,
        processor_key_override="nope|x",
    ):
        events.append(evt)

    assert any(e["event"] == "error" for e in events)
    err = next(e for e in events if e["event"] == "error")
    assert "code" in err["data"]
    assert "message" in err["data"]

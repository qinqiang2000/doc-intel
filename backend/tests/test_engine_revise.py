"""S3/T3: engine.revise_prompt + processor chat_stream tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_mock_processor_chat_stream_yields_three_deterministic_chunks():
    from app.engine.processors.mock import MockProcessor
    p = MockProcessor()
    chunks: list[str] = []
    async for c in p.chat_stream(system="any", user="hello"):
        chunks.append(c)
    assert chunks == ["REVISED: ", "hello", " END"]


@pytest.mark.asyncio
async def test_revise_prompt_uses_factory_then_streams():
    from app.engine.prompt import revise_prompt

    out: list[str] = []
    async for c in revise_prompt(
        original_prompt="orig",
        user_message="say hi",
        target_field=None,
        processor_key="mock|m",
    ):
        out.append(c)
    full = "".join(out)
    assert full.startswith("REVISED: ")
    assert "say hi" in full
    assert full.endswith(" END")


@pytest.mark.asyncio
async def test_revise_prompt_raises_on_unknown_processor():
    from app.engine.prompt import revise_prompt

    with pytest.raises((ValueError, RuntimeError)):
        async for _ in revise_prompt(
            original_prompt="o",
            user_message="m",
            target_field=None,
            processor_key="nonsense|x",
        ):
            pass


@pytest.mark.asyncio
async def test_revise_prompt_target_field_appears_in_user_message_payload(monkeypatch):
    """Target field must reach the chat_stream system or user content."""
    from app.engine.processors import mock as mock_mod

    captured = {}
    orig_chat = mock_mod.MockProcessor.chat_stream

    async def spy_chat(self, *, system: str, user: str):
        captured["system"] = system
        captured["user"] = user
        async for c in orig_chat(self, system=system, user=user):
            yield c

    monkeypatch.setattr(mock_mod.MockProcessor, "chat_stream", spy_chat)

    from app.engine.prompt import revise_prompt
    async for _ in revise_prompt(
        original_prompt="orig",
        user_message="m",
        target_field="invoice_number",
        processor_key="mock|m",
    ):
        pass
    assert "invoice_number" in captured["user"]

"""Tests for engine skeleton: factory + mock processor + utils."""
from __future__ import annotations

import json

import pytest


def test_factory_lists_mock():
    from app.engine.processors.factory import DocumentProcessorFactory

    assert "mock" in DocumentProcessorFactory.get_available()


def test_factory_unknown_type_raises():
    from app.engine.processors.factory import DocumentProcessorFactory

    with pytest.raises(ValueError, match="Unknown processor type"):
        DocumentProcessorFactory.create("nonexistent")


def test_factory_create_mock_returns_processor():
    from app.engine.processors.base import DocumentProcessor
    from app.engine.processors.factory import DocumentProcessorFactory
    from app.engine.processors.mock import MockProcessor

    p = DocumentProcessorFactory.create("mock")
    assert isinstance(p, DocumentProcessor)
    assert isinstance(p, MockProcessor)
    assert p.get_model_version() == "mock|mock-v1.0"

    p2 = DocumentProcessorFactory.create("mock", model_name="mock-test-2.0")
    assert p2.get_model_version() == "mock|mock-test-2.0"


@pytest.mark.asyncio
async def test_mock_process_document_returns_valid_json():
    from app.engine.processors.factory import DocumentProcessorFactory

    p = DocumentProcessorFactory.create("mock")
    result_str = await p.process_document("/fake/path.pdf", "extract invoice")

    # Should be valid JSON parseable as a list (mock returns either mock.json or default list)
    parsed = json.loads(result_str)
    assert isinstance(parsed, list)
    assert len(parsed) >= 1
    # Typical fields in invoice mock data
    first = parsed[0]
    assert isinstance(first, dict)


def test_extract_json_finds_json_block():
    from app.engine.utils import extract_json

    text = '''Some preamble.
```json
{"key": "value"}
```
Some trailing.'''
    result = extract_json(text)
    assert result == ['{"key": "value"}']


def test_extract_json_returns_empty_on_no_match():
    from app.engine.utils import extract_json

    assert extract_json("no json here") == []


def test_format_prompt_template_replaces_placeholders():
    from app.engine.utils import format_prompt_template

    out = format_prompt_template(
        "Extract from {{filename}} as {{type}}",
        {"filename": "invoice.pdf", "type": "JPY"},
    )
    assert out == "Extract from invoice.pdf as JPY"


def test_format_prompt_template_keeps_unknown_placeholders():
    from app.engine.utils import format_prompt_template

    out = format_prompt_template("Hello {{a}} and {{b}}", {"a": "X"})
    assert out == "Hello X and {{b}}"


def test_factory_register_custom_processor():
    from app.engine.processors.base import DocumentProcessor
    from app.engine.processors.factory import DocumentProcessorFactory

    class _Custom(DocumentProcessor):
        async def process_document(self, file_path: str, instruction: str) -> str:
            return "[]"

        def get_model_version(self) -> str:
            return "custom|v1"

    try:
        DocumentProcessorFactory.register("__test_custom", _Custom)
        p = DocumentProcessorFactory.create("__test_custom")
        assert p.get_model_version() == "custom|v1"
    finally:
        # Clean up to avoid pollution across tests
        DocumentProcessorFactory._processors.pop("__test_custom", None)

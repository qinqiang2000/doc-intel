"""Tests for real LLM processors with mocked SDKs."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest


# ─── Gemini ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_gemini_processor_calls_async_api(monkeypatch, tmp_path):
    """Verify GeminiProcessor.process_document hits client.aio.models.generate_content."""
    monkeypatch.setenv("API_KEY", "fake-key")

    # Create a fake PDF file
    pdf_path = tmp_path / "test.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 fake content")

    # Mock the genai.Client class so __init__ doesn't fail
    fake_response = MagicMock()
    fake_response.text = '```json\n[{"docType":"invoice","invoiceNumber":"INV-001"}]\n```'

    fake_client = MagicMock()
    # client.aio.models.generate_content must be an AsyncMock returning fake_response
    fake_client.aio.models.generate_content = AsyncMock(return_value=fake_response)
    # client.files.upload may be needed if processor uses upload flow — make it sync mock
    fake_uploaded = MagicMock()
    fake_uploaded.uri = "fake://uri"
    fake_uploaded.mime_type = "application/pdf"
    fake_client.aio.files.upload = AsyncMock(return_value=fake_uploaded)
    fake_client.files.upload = MagicMock(return_value=fake_uploaded)

    with patch("app.engine.processors.gemini.genai.Client", return_value=fake_client):
        from app.engine.processors.gemini import GeminiProcessor

        p = GeminiProcessor(model_name="gemini-2.5-flash")
        result = await p.process_document(str(pdf_path), "Extract invoice data")

    # The processor returns text directly when mime_type is application/json (default)
    # The raw text contains ```json ... ``` markers since mime_type defaults to application/json
    # (extract_json only called when mime_type is text/plain)
    assert "INV-001" in result
    # Verify the async API was called
    assert fake_client.aio.models.generate_content.await_count >= 1


# ─── OpenAI ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_openai_processor_calls_async_api(monkeypatch, tmp_path):
    """Verify OpenAIDocumentProcessor uses AsyncOpenAI."""
    monkeypatch.setenv("OPENAI_API_KEY", "fake-key")

    img_path = tmp_path / "test.png"
    img_path.write_bytes(b"\x89PNG\r\n\x1a\nfake")

    # Fake AsyncOpenAI client
    fake_completion = MagicMock()
    # Many openai response shapes: handle .choices[0].message.content
    fake_completion.choices = [
        MagicMock(message=MagicMock(content='[{"docType":"receipt","invoiceNumber":"R-99"}]'))
    ]

    fake_async_client = MagicMock()
    fake_async_client.chat.completions.create = AsyncMock(return_value=fake_completion)
    # Some flows use beta.chat.completions.parse
    fake_async_client.beta.chat.completions.parse = AsyncMock(return_value=fake_completion)
    # responses.create for the non-structured output path
    fake_response_obj = MagicMock()
    fake_response_obj.output_text = '[{"docType":"receipt","invoiceNumber":"R-99"}]'
    fake_async_client.responses.create = AsyncMock(return_value=fake_response_obj)

    with patch("app.engine.processors.openai.AsyncOpenAI", return_value=fake_async_client):
        from app.engine.processors.openai import OpenAIDocumentProcessor

        p = OpenAIDocumentProcessor(model_name="gpt-4o")
        result = await p.process_document(str(img_path), "Extract receipt data")

    assert "R-99" in result
    # At least one async call must have happened
    total_calls = (
        fake_async_client.chat.completions.create.await_count
        + fake_async_client.beta.chat.completions.parse.await_count
        + fake_async_client.responses.create.await_count
    )
    assert total_calls >= 1


# ─── PiaoZone ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_piaozone_processor_uses_httpx_async(monkeypatch, tmp_path):
    """Verify PiaoZoneProcessor.process_document uses httpx.AsyncClient
    (not requests, not sync)."""
    monkeypatch.setenv("PIAOZONE_CLIENT_ID", "fake-id")
    monkeypatch.setenv("PIAOZONE_CLIENT_SECRET", "fake-secret")
    monkeypatch.setenv("PIAOZONE_API_URL", "http://fake.piaozone.com/predict")
    monkeypatch.setenv("PIAOZONE_TOKEN_URL", "http://fake.piaozone.com/token")

    img_path = tmp_path / "doc.png"
    img_path.write_bytes(b"\x89PNG\r\n\x1a\nfake")

    # Mock httpx.AsyncClient at module level. We intercept all .post calls.
    def make_response(json_body: dict) -> httpx.Response:
        return httpx.Response(200, json=json_body, request=httpx.Request("POST", "http://x"))

    call_log = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            call_log.append(("post", url))
            # Token URL ends at /token (no query params); predict URL has /predict path
            if "fake.piaozone.com/token" in url:
                return make_response(
                    {"access_token": "fake-token-abc", "expires_in": 86400}
                )
            # predict response — use 'data.content' path which piaozone.py checks
            return make_response({
                "data": {
                    "content": '[{"docType":"invoice","invoiceNumber":"PZ-1"}]'
                }
            })

        async def get(self, url, **kwargs):
            call_log.append(("get", url))
            return make_response({})

    # Reset the token manager singleton state so it re-fetches
    import app.engine.processors.piaozone_token as pzt_module
    pzt_module._token_manager._token = None
    pzt_module._token_manager._token_expiry = None
    # Also update env vars on the manager instance
    pzt_module._token_manager._client_id = "fake-id"
    pzt_module._token_manager._client_secret = "fake-secret"
    pzt_module._token_manager._token_url = "http://fake.piaozone.com/token"

    with patch("app.engine.processors.piaozone.httpx.AsyncClient", FakeAsyncClient), \
         patch("app.engine.processors.piaozone_token.httpx.AsyncClient", FakeAsyncClient):
        from app.engine.processors.piaozone import PiaoZoneProcessor

        p = PiaoZoneProcessor(model_name="gemini-2.5-flash-preview-04-17")
        result = await p.process_document(str(img_path), "Extract")

    assert "PZ-1" in result
    # Verify at least one POST went out (token + predict)
    posts = [c for c in call_log if c[0] == "post"]
    assert len(posts) >= 1


# ─── YAML per-model params (Gemini) ───────────────────────────────────────────

def _clean_gemini_env(monkeypatch):
    monkeypatch.setenv("API_KEY", "fake-key")
    for k in [
        "GEMINI_THINKING_BUDGET",
        "GEMINI_THINKING_LEVEL",
        "GEMINI_TEMPERATURE",
        "GEMINI_MODEL",
    ]:
        monkeypatch.delenv(k, raising=False)


def test_gemini_yaml_params_baseline(monkeypatch):
    """YAML 中声明的 params 应进入 self.llm_param_config，
    且 thinking_budget/thinking_level 被翻译成 ThinkingConfig。"""
    _clean_gemini_env(monkeypatch)

    fake_client = MagicMock()
    with patch("app.engine.processors.gemini.genai.Client", return_value=fake_client):
        from app.engine.processors.gemini import GeminiProcessor

        p3 = GeminiProcessor(model_name="gemini-3-flash-preview")
        tc3 = p3.llm_param_config.get("thinking_config")
        assert tc3 is not None
        assert getattr(tc3, "thinking_level", None) is not None
        # gemini-3 YAML 还声明了 temperature: 0.0
        assert p3.llm_param_config.get("temperature") == 0.0

        p25 = GeminiProcessor(model_name="gemini-2.5-flash")
        tc25 = p25.llm_param_config.get("thinking_config")
        assert tc25 is not None
        # YAML 里写了 thinking_budget: 0
        assert getattr(tc25, "thinking_budget", None) == 0


def test_gemini_env_overrides_yaml(monkeypatch):
    """env vars 优先级高于 YAML model.params。"""
    _clean_gemini_env(monkeypatch)
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "LOW")

    fake_client = MagicMock()
    with patch("app.engine.processors.gemini.genai.Client", return_value=fake_client):
        from app.engine.processors.gemini import GeminiProcessor

        p = GeminiProcessor(model_name="gemini-3-flash-preview")
        tc = p.llm_param_config["thinking_config"]
        # env LOW 覆盖 YAML HIGH
        assert getattr(tc, "thinking_level").value == "LOW"


# ─── Factory registration ─────────────────────────────────────────────────────

def test_factory_registers_real_processors_when_sdks_available():
    """When google-genai, openai, httpx are installed, factory should
    expose gemini, openai, piaozone in addition to mock."""
    from app.engine.processors.factory import DocumentProcessorFactory

    available = DocumentProcessorFactory.get_available()
    assert "mock" in available
    # These should all be present since deps are installed
    assert "gemini" in available
    assert "openai" in available
    assert "piaozone" in available

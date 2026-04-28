"""Tests for ExcelAnalyzer with mocked gemini."""
from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_excel_analyzer_uses_async_gemini(monkeypatch):
    """Verify ExcelAnalyzer.analyze uses client.aio.* (async)."""
    import pandas as pd
    from pathlib import Path

    monkeypatch.setenv("API_KEY", "fake-key")

    fake_response = MagicMock()
    fake_response.text = "## 分析结果\n- 总额: 1000"

    fake_client = MagicMock()
    fake_client.aio.models.generate_content = AsyncMock(return_value=fake_response)
    fake_uploaded = MagicMock()
    fake_uploaded.uri = "fake://uri"
    fake_uploaded.name = "files/fake-123"
    fake_uploaded.mime_type = "text/csv"
    fake_client.aio.files.upload = AsyncMock(return_value=fake_uploaded)
    fake_client.files.upload = MagicMock(return_value=fake_uploaded)
    fake_client.files.delete = MagicMock()

    # Fake Excel sheet data — avoids needing a real .xlsx file
    fake_excel_data = {"Sheet1": pd.DataFrame({"A": [1, 2], "B": [3, 4]})}

    # Use a MagicMock for the csv path so stat().st_size works without a real file
    fake_csv_path = MagicMock(spec=Path)
    fake_csv_path.name = "fake_sheet1_Sheet1.csv"
    fake_stat = MagicMock()
    fake_stat.st_size = 42
    fake_csv_path.stat.return_value = fake_stat
    fake_csv_files = [fake_csv_path]

    excel_b64 = base64.b64encode(b"PK\x03\x04 fake xlsx bytes").decode()

    with patch("app.engine.analyzers.excel_analyzer.genai.Client", return_value=fake_client):
        from app.engine.analyzers.excel_analyzer import ExcelAnalyzer

        analyzer = ExcelAnalyzer()

        with patch.object(analyzer, "_read_excel_file", return_value=fake_excel_data), \
             patch.object(analyzer, "_save_sheets_as_csv", return_value=fake_csv_files):
            result = await analyzer.analyze(excel_b64, filename="test.xlsx", prompt="Summarize")

    assert "分析结果" in result or "1000" in result
    assert fake_client.aio.models.generate_content.await_count >= 1


def test_excel_analyzer_info():
    monkeypatch_env = {"API_KEY": "fake"}
    import os
    for k, v in monkeypatch_env.items():
        os.environ.setdefault(k, v)

    from app.engine.analyzers.excel_analyzer import ExcelAnalyzer

    a = ExcelAnalyzer()
    info = a.get_analyzer_info()
    assert isinstance(info, dict)
    # Must have at least 'name' or 'type' field
    assert any(k in info for k in ("name", "type"))

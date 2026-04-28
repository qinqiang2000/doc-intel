"""Mock processor for testing — returns canned invoice data instantly."""
from __future__ import annotations

import logging

from app.engine.processors.base import DocumentProcessor
from app.engine.utils import get_mock_invoice_data

logger = logging.getLogger(__name__)


class MockProcessor(DocumentProcessor):
    """Mock processor for testing purposes (no real LLM call, no sleep)."""

    def __init__(self, model_name: str = "mock-v1.0", **kwargs) -> None:
        self.model_name = model_name
        logger.info("MockProcessor initialized with model: %s", model_name)

    async def process_document(self, file_path: str, instruction: str) -> str:
        logger.info("Using mock data for document processing (file=%s)", file_path)
        return get_mock_invoice_data()

    def get_model_version(self) -> str:
        return f"mock|{self.model_name}"

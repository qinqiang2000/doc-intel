"""Factory for creating document processors.

T12a registers only `mock`. T12b will add gemini, openai, piaozone with
optional imports (try/except ImportError so missing SDKs don't break the
whole module).
"""
from __future__ import annotations

import logging

from app.engine.processors.base import DocumentProcessor
from app.engine.processors.mock import MockProcessor

logger = logging.getLogger(__name__)


class DocumentProcessorFactory:
    """Create a DocumentProcessor by string name."""

    _processors: dict[str, type[DocumentProcessor]] = {
        "mock": MockProcessor,
    }

    @classmethod
    def create(cls, processor_type: str, **kwargs) -> DocumentProcessor:
        """Instantiate a processor by name.

        Args:
            processor_type: e.g. "mock", "gemini" (T12b), "openai" (T12b)
            **kwargs: forwarded to the processor's __init__ (e.g. model_name)
        """
        if processor_type not in cls._processors:
            available = list(cls._processors.keys())
            raise ValueError(
                f"Unknown processor type: '{processor_type}'. Available: {available}"
            )
        return cls._processors[processor_type](**kwargs)

    @classmethod
    def register(cls, name: str, processor_class: type[DocumentProcessor]) -> None:
        """Register a custom processor at runtime (test extension hook)."""
        if not issubclass(processor_class, DocumentProcessor):
            raise ValueError("Processor class must inherit from DocumentProcessor")
        cls._processors[name] = processor_class

    @classmethod
    def get_available(cls) -> list[str]:
        """List currently registered processor names."""
        return list(cls._processors.keys())

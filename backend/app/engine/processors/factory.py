"""Factory for creating document processors.

Real LLM processors (gemini, openai, piaozone) are imported via try/except
so missing optional SDKs don't break the whole module.
"""
from __future__ import annotations

import logging

from app.engine.processors.base import DocumentProcessor
from app.engine.processors.mock import MockProcessor

logger = logging.getLogger(__name__)


_processors: dict[str, type[DocumentProcessor]] = {
    "mock": MockProcessor,
}

# Optional: Gemini
try:
    from app.engine.processors.gemini import GeminiProcessor
    _processors["gemini"] = GeminiProcessor
except ImportError as e:
    logger.warning("GeminiProcessor unavailable: %s", e)

# Optional: OpenAI
try:
    from app.engine.processors.openai import OpenAIDocumentProcessor
    _processors["openai"] = OpenAIDocumentProcessor
except ImportError as e:
    logger.warning("OpenAIDocumentProcessor unavailable: %s", e)

# Optional: PiaoZone
try:
    from app.engine.processors.piaozone import PiaoZoneProcessor
    _processors["piaozone"] = PiaoZoneProcessor
except ImportError as e:
    logger.warning("PiaoZoneProcessor unavailable: %s", e)


# Optional: config_manager (provides default model lookup)
try:
    from app.engine.config.manager import config_manager
    _CONFIG_AVAILABLE = True
except ImportError as e:
    logger.warning("config_manager unavailable: %s", e)
    config_manager = None
    _CONFIG_AVAILABLE = False


class DocumentProcessorFactory:
    """Create a DocumentProcessor by string name."""

    _processors = _processors  # class-level alias for backwards compat with T12a

    @classmethod
    def create(cls, processor_type: str, **kwargs) -> DocumentProcessor:
        """Instantiate a processor by name.

        If processor_type is registered and config_manager is available,
        a default model_name is filled in from models.yaml when not provided.
        """
        if processor_type not in cls._processors:
            available = list(cls._processors.keys())
            raise ValueError(
                f"Unknown processor type: '{processor_type}'. Available: {available}"
            )

        if _CONFIG_AVAILABLE and "model_name" not in kwargs:
            try:
                default = config_manager.get_default_model(processor_type)
                if default:
                    kwargs["model_name"] = default
                    logger.debug("Using default model for %s: %s", processor_type, default)
            except Exception as e:
                logger.warning("Failed to read default model for %s: %s", processor_type, e)

        return cls._processors[processor_type](**kwargs)

    @classmethod
    def register(cls, name: str, processor_class: type[DocumentProcessor]) -> None:
        if not issubclass(processor_class, DocumentProcessor):
            raise ValueError("Processor class must inherit from DocumentProcessor")
        cls._processors[name] = processor_class

    @classmethod
    def get_available(cls) -> list[str]:
        return list(cls._processors.keys())

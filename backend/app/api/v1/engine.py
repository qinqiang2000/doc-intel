"""Engine introspection endpoints — list available processors + models."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser
from app.engine.processors.factory import DocumentProcessorFactory

router = APIRouter(prefix="/engine", tags=["engine"])


@router.get("/info")
async def engine_info(_: CurrentUser) -> dict:
    """List available processors and the models each supports.

    Models are read from app.engine.config.manager.config_manager using
    get_processor_config(processor_type).models.keys(); otherwise an empty
    list is returned per processor.
    """
    processors = DocumentProcessorFactory.get_available()

    result: dict[str, list[str]] = {p: [] for p in processors}

    try:
        from app.engine.config.manager import config_manager

        for p in processors:
            try:
                processor_config = config_manager.get_processor_config(p)
                if processor_config and hasattr(processor_config, "models"):
                    result[p] = list(processor_config.models.keys())
            except Exception:
                result[p] = []
    except ImportError:
        pass

    return {
        "processors": [
            {"type": p, "models": result[p]} for p in processors
        ],
    }

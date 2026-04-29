"""S3: correction service — SSE async generator producing event dicts.

Output shape: dicts of {"event": str, "data": dict}. The route layer
wraps each into 'event: NAME\\ndata: JSON\\n\\n' HTTP framing.
"""
from __future__ import annotations

import json as _json
import logging
from typing import Any, AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.engine.prompt import revise_prompt
from app.engine.processors.factory import DocumentProcessorFactory
from app.models.document import Document
from app.models.project import Project
from app.models.user import User
from app.services import storage

logger = logging.getLogger(__name__)


async def stream_correction(
    db: AsyncSession,
    *,
    project: Project,
    document: Document,
    user: User,
    user_message: str,
    current_prompt: str,
    target_field: str | None,
    processor_key_override: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yields SSE event dicts.

    Phase 1: stream tokens of revised prompt -> emits prompt_token + revised_prompt.
    Phase 2: re-run predict with revised prompt, NO db write -> emits
             predict_started + predict_result.
    Done. Errors emit `error` event then return.
    """
    # Resolve processor: override > project template default
    if processor_key_override:
        processor_key = processor_key_override
    else:
        from app.templates.builtin import get_template
        tpl = get_template(project.template_key) if project.template_key else None
        rec = tpl.recommended_processor if tpl else "gemini"
        processor_key = rec if "|" in rec else f"{rec}|gemini-2.5-flash"

    # Phase 1: revise prompt
    revised_chunks: list[str] = []
    try:
        async for chunk in revise_prompt(
            original_prompt=current_prompt,
            user_message=user_message,
            target_field=target_field,
            processor_key=processor_key,
        ):
            revised_chunks.append(chunk)
            yield {"event": "prompt_token", "data": {"chunk": chunk}}
    except Exception as e:
        logger.exception("revise_prompt failed")
        yield {
            "event": "error",
            "data": {"code": "revise_failed", "message": str(e)},
        }
        return

    revised_prompt_text = "".join(revised_chunks)
    yield {
        "event": "revised_prompt",
        "data": {"prompt_text": revised_prompt_text},
    }

    # Phase 2: re-run predict with revised prompt — preview-only, no DB write
    yield {"event": "predict_started", "data": {}}
    parts = processor_key.split("|", 1)
    p_type = parts[0]
    p_kwargs = {"model_name": parts[1]} if len(parts) == 2 else {}
    try:
        processor = DocumentProcessorFactory.create(p_type, **p_kwargs)
        file_path = str(storage.absolute_path(document.file_path))
        raw = await processor.process_document(file_path, revised_prompt_text)
    except Exception as e:
        logger.exception("preview predict failed")
        yield {
            "event": "error",
            "data": {"code": "predict_failed", "message": str(e)},
        }
        return

    # Best-effort parse: if raw is JSON list/dict, use it; else expose raw text
    try:
        parsed = _json.loads(raw)
        if isinstance(parsed, list) and parsed:
            structured_data = parsed[0]
        elif isinstance(parsed, dict):
            structured_data = parsed
        else:
            structured_data = {"raw": raw}
    except Exception:
        structured_data = {"raw": raw}

    yield {
        "event": "predict_result",
        "data": {"structured_data": structured_data, "annotations": []},
    }
    yield {"event": "done", "data": {}}

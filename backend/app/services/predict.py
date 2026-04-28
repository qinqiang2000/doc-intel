"""Predict service: helpers + per-document predict + batch stream.

Layered:
- build_default_prompt: derive prompt text from Project.template_key
- _parse_llm_output: tolerant LLM output → dict
- _infer_schema: rough type per top-level field
- _next_version: per-document version counter
- _replace_ai_annotations: replace AI-detected rows; keep manual rows
- predict_single: orchestrates engine call + writes (T6)
- predict_batch_stream: async iterator yielding per-doc events (T8)
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator, Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.engine.utils import extract_json
from app.models.annotation import Annotation, AnnotationSource
from app.models.processing_result import ProcessingResult
from app.templates.builtin import get_template

logger = logging.getLogger(__name__)


DEFAULT_PROMPT_TEMPLATE = """
你是一个文档信息提取专家。请从这份文档中提取以下字段，输出严格的 JSON：

{fields_section}

如果某个字段在文档里找不到，请省略该字段（不要输出 null/空字符串）。
所有金额相关字段输出为数字（不带货币符号、千分位逗号）。
日期统一用 YYYY-MM-DD 格式。
""".strip()


def build_default_prompt(template_key: str | None) -> str:
    """Derive default prompt from a Project template_key."""
    if template_key:
        tpl = get_template(template_key)
        if tpl and tpl.expected_fields:
            fields = "\n".join(f"  - {f}" for f in tpl.expected_fields)
            return DEFAULT_PROMPT_TEMPLATE.format(fields_section=fields)
    return "请提取这份文档的关键字段并以 JSON 输出。"


def _parse_llm_output(raw: str) -> dict:
    """Best-effort parse of LLM output; falls back to {'_raw': raw}."""
    if not raw:
        return {"_raw": ""}
    blocks = extract_json(raw)
    candidates = blocks if blocks else [raw.strip()]
    for s in candidates:
        try:
            parsed = json.loads(s)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"items": parsed}
    return {"_raw": raw}


_SCALAR_TYPES = {
    str: "string",
    int: "number",
    float: "number",
    bool: "boolean",
}


def _infer_schema(data: dict) -> dict:
    """Rough type per top-level key (S2a — nested types are S3+)."""
    schema: dict[str, str] = {}
    for k, v in data.items():
        if isinstance(v, list):
            schema[k] = "array"
        elif isinstance(v, dict):
            schema[k] = "object"
        else:
            schema[k] = _SCALAR_TYPES.get(type(v), "string")
    return schema


async def _next_version(db: AsyncSession, document_id: str) -> int:
    """Compute next version for a document (max+1, or 1 if none)."""
    stmt = select(func.max(ProcessingResult.version)).where(
        ProcessingResult.document_id == document_id
    )
    cur = (await db.execute(stmt)).scalar()
    return (cur or 0) + 1


async def _replace_ai_annotations(
    db: AsyncSession, document_id: str, structured: dict, user_id: str
) -> None:
    """Replace source=ai_detected annotations for this document with new
    rows derived from `structured`. Manual annotations are preserved."""
    # Soft-delete existing AI annotations
    stmt = select(Annotation).where(
        Annotation.document_id == document_id,
        Annotation.source == AnnotationSource.AI_DETECTED,
        Annotation.deleted_at.is_(None),
    )
    existing = (await db.execute(stmt)).scalars().all()
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    for a in existing:
        a.deleted_at = now
    await db.flush()

    # Insert new AI annotations from top-level fields
    for field_name, field_value in structured.items():
        if field_name == "_raw":
            continue
        if isinstance(field_value, (dict, list)):
            value_str = json.dumps(field_value, ensure_ascii=False)
        elif field_value is None:
            value_str = None
        else:
            value_str = str(field_value)
        a = Annotation(
            document_id=document_id,
            field_name=field_name,
            field_value=value_str,
            source=AnnotationSource.AI_DETECTED,
            created_by=user_id,
        )
        db.add(a)
    await db.flush()


from app.engine.processors.factory import DocumentProcessorFactory
from app.models.document import Document
from app.models.processing_result import ProcessingResult, ProcessingResultSource
from app.models.project import Project
from app.models.user import User
from app.services import storage


class PredictError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def predict_single(
    db: AsyncSession,
    *,
    document: Document,
    project: Project,
    user: User,
    prompt_override: str | None = None,
    processor_key_override: str | None = None,
) -> ProcessingResult:
    # 1. Resolve processor_key
    if processor_key_override:
        processor_key = processor_key_override
    else:
        tpl = get_template(project.template_key) if project.template_key else None
        processor_key = tpl.recommended_processor if tpl else "gemini"

    # 2. Create processor
    parts = processor_key.split("|", 1)
    p_type = parts[0]
    p_kwargs: dict[str, Any] = {"model_name": parts[1]} if len(parts) == 2 else {}
    available = set(DocumentProcessorFactory.get_available())
    if p_type not in available:
        raise PredictError(
            "processor_not_available",
            f"Processor '{p_type}' is not available. Available: {sorted(available)}",
        )
    try:
        processor = DocumentProcessorFactory.create(p_type, **p_kwargs)
    except (ValueError, RuntimeError) as e:
        raise PredictError("processor_not_available", str(e))

    # Record final processor_key (with model name resolved by factory if any)
    final_processor_key = processor_key
    if "|" not in processor_key and hasattr(processor, "model_name"):
        final_processor_key = f"{p_type}|{processor.model_name}"

    # 3. Resolve prompt
    prompt = prompt_override or build_default_prompt(project.template_key)

    # 4. Call engine
    file_path = str(storage.absolute_path(document.file_path))
    try:
        raw = await processor.process_document(file_path, prompt)
    except Exception as e:
        logger.exception("predict_single processor failed for doc %s", document.id)
        raise PredictError("predict_failed", f"Engine error: {e}")

    # 5. Parse
    structured = _parse_llm_output(raw)
    schema = _infer_schema(structured)

    # 6. Write ProcessingResult (version recompute inside transaction)
    next_version = await _next_version(db, document.id)
    pr = ProcessingResult(
        document_id=document.id,
        version=next_version,
        structured_data=structured,
        inferred_schema=schema,
        prompt_used=prompt,
        processor_key=final_processor_key,
        source=ProcessingResultSource.PREDICT,
        created_by=user.id,
    )
    db.add(pr)
    await db.flush()

    # 7. Replace AI annotations
    await _replace_ai_annotations(db, document.id, structured, user.id)

    await db.commit()
    await db.refresh(pr)
    return pr


async def predict_batch_stream(
    db_factory,
    *,
    project: Project,
    document_ids: list[str],
    user_id: str,
    prompt_override: str | None = None,
    processor_key_override: str | None = None,
) -> AsyncIterator[dict]:
    """Yield {document_id, status, processing_result_id?, error?} per doc,
    then a final {_final, total, succeeded, failed}."""
    succeeded = 0
    failed = 0
    for doc_id in document_ids:
        yield {"document_id": doc_id, "status": "started"}
        try:
            async with db_factory() as db:
                doc = await db.get(Document, doc_id)
                user = await db.get(User, user_id)
                if doc is None or doc.project_id != project.id or doc.deleted_at is not None:
                    yield {"document_id": doc_id, "status": "failed", "error": "document_not_found"}
                    failed += 1
                    continue
                # re-fetch project in this session
                proj_in_session = await db.get(Project, project.id)
                if proj_in_session is None:
                    yield {"document_id": doc_id, "status": "failed", "error": "project_not_found"}
                    failed += 1
                    continue
                pr = await predict_single(
                    db, document=doc, project=proj_in_session, user=user,
                    prompt_override=prompt_override,
                    processor_key_override=processor_key_override,
                )
            yield {"document_id": doc_id, "status": "completed", "processing_result_id": pr.id}
            succeeded += 1
        except PredictError as e:
            yield {"document_id": doc_id, "status": "failed", "error": f"{e.code}: {e.message}"}
            failed += 1
        except Exception as e:
            yield {"document_id": doc_id, "status": "failed", "error": str(e)[:200]}
            failed += 1
    yield {"_final": True, "total": len(document_ids), "succeeded": succeeded, "failed": failed}

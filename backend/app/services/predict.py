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

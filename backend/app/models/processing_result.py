"""ProcessingResult model — one row per (document, processor_key, prompt_hash)."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.document import Document


class ProcessingResultSource(str, enum.Enum):
    PREDICT = "predict"
    MANUAL_EDIT = "manual_edit"


class ProcessingResult(Base, TimestampMixin):
    __tablename__ = "processing_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    structured_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    inferred_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    prompt_used: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    processor_key: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[ProcessingResultSource] = mapped_column(
        SAEnum(ProcessingResultSource, name="processing_result_source"), nullable=False
    )
    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped["Document"] = relationship()

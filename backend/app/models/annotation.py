"""Annotation model — current truth of extracted/edited fields per Document."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Float, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.document import Document


class AnnotationSource(str, enum.Enum):
    AI_DETECTED = "ai_detected"
    MANUAL = "manual"


class AnnotationFieldType(str, enum.Enum):
    STRING = "string"
    NUMBER = "number"
    DATE = "date"
    ARRAY = "array"
    OBJECT = "object"


class Annotation(Base, TimestampMixin):
    __tablename__ = "annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    field_name: Mapped[str] = mapped_column(String(120), nullable=False)
    field_value: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    field_type: Mapped[AnnotationFieldType] = mapped_column(
        SAEnum(AnnotationFieldType, name="annotation_field_type"),
        default=AnnotationFieldType.STRING, nullable=False,
    )
    bounding_box: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source: Mapped[AnnotationSource] = mapped_column(
        SAEnum(AnnotationSource, name="annotation_source"), nullable=False
    )
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_ground_truth: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    document: Mapped["Document"] = relationship()

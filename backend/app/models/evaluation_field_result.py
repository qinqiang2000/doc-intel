"""S4: EvaluationFieldResult ORM model — one row per (doc, field) compared."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EvaluationFieldResult(Base):
    __tablename__ = "evaluation_field_results"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    run_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("evaluation_runs.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )
    document_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    document_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    field_name: Mapped[str] = mapped_column(String(200), nullable=False)
    predicted_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    match_status: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )

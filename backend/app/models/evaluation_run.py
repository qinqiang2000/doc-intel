"""S4: EvaluationRun ORM model — per-run snapshot of a project evaluation."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False,
    )
    prompt_version_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("prompt_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    num_docs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    num_fields_evaluated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    num_matches: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accuracy_avg: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="completed")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

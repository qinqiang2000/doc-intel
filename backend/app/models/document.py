"""Document model — uploaded files belonging to a Project."""
from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.project import Project


class DocumentStatus(str, enum.Enum):
    UPLOADING = "uploading"
    READY = "ready"
    FAILED = "failed"


class Document(Base, TimestampMixin):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[DocumentStatus] = mapped_column(
        SAEnum(DocumentStatus, name="document_status"),
        default=DocumentStatus.UPLOADING,
        nullable=False,
    )
    is_ground_truth: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    uploaded_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    project: Mapped["Project"] = relationship(back_populates="documents")

"""AnnotationRevision — append-only audit log for Annotation changes (LS-7)."""
from __future__ import annotations

import enum

from sqlalchemy import Enum as SAEnum, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, gen_uuid


class RevisionAction(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


class AnnotationRevision(Base, TimestampMixin):
    __tablename__ = "annotation_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    annotation_id: Mapped[str] = mapped_column(
        ForeignKey("annotations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    action: Mapped[RevisionAction] = mapped_column(
        SAEnum(RevisionAction, name="annotation_revision_action"), nullable=False
    )
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    changed_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

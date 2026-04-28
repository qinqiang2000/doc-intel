"""Project model — domain object collapsed with ApiDefinition (per S0 brainstorm)."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, gen_uuid

if TYPE_CHECKING:
    from app.models.document import Document  # noqa: F401 — added by T3


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("workspace_id", "slug", name="uq_project_workspace_slug"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    template_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_by: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    # S5 placeholders — nullable in S1, populated by /publish in S5
    api_code: Mapped[str | None] = mapped_column(
        String(60), unique=True, index=True, nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    documents: Mapped[list["Document"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )

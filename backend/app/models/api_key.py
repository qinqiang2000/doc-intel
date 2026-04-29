"""S5: ApiKey ORM model — per-project bcrypt-hashed API keys."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4()),
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    key_prefix: Mapped[str] = mapped_column(String(12), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

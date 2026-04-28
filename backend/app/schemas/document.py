"""Document request/response schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    filename: str
    file_path: str
    file_size: int
    mime_type: str
    status: str
    is_ground_truth: bool
    uploaded_by: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class DocumentUpdate(BaseModel):
    is_ground_truth: bool | None = None


class DocumentList(BaseModel):
    items: list[DocumentRead]
    total: int
    page: int
    page_size: int

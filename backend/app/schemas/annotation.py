"""Annotation request/response schemas."""
from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class AnnotationCreate(BaseModel):
    field_name: str = Field(min_length=1, max_length=120)
    field_value: str | None = Field(default=None, max_length=2000)
    field_type: str = Field(default="string")
    bounding_box: dict | None = None
    is_ground_truth: bool = False


class AnnotationUpdate(BaseModel):
    field_value: str | None = Field(default=None, max_length=2000)
    field_type: str | None = None
    bounding_box: dict | None = None
    is_ground_truth: bool | None = None


class AnnotationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    document_id: str
    field_name: str
    field_value: str | None
    field_type: str
    bounding_box: dict | None
    source: str
    confidence: float | None
    is_ground_truth: bool
    created_by: str
    updated_by_user_id: str | None
    created_at: datetime
    updated_at: datetime

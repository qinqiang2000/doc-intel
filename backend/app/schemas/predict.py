"""Predict request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class PredictRequest(BaseModel):
    prompt_override: str | None = Field(default=None, max_length=10000)
    processor_key_override: str | None = Field(default=None, max_length=120)


class ProcessingResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    document_id: str
    structured_data: dict[str, Any]
    inferred_schema: dict[str, Any] | None
    prompt_used: str
    processor_key: str
    source: str
    created_by: str
    created_at: datetime
    updated_at: datetime


class BatchPredictRequest(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=500)
    prompt_override: str | None = Field(default=None, max_length=10000)
    processor_key_override: str | None = Field(default=None, max_length=120)

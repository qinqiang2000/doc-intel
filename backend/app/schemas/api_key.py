"""S5: ApiKey request/response schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(default="", max_length=120)


class ApiKeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    name: str
    key_prefix: str
    is_active: bool
    last_used_at: datetime | None
    created_by: str
    created_at: datetime


class ApiKeyCreateResponse(ApiKeyRead):
    """Response for POST /api-keys — includes the full plaintext key (only here)."""
    key: str

"""S3: PromptVersion request/response schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PromptVersionCreate(BaseModel):
    prompt_text: str = Field(min_length=1)
    summary: str = Field(default="", max_length=200)


class PromptVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    version: int
    prompt_text: str
    summary: str
    created_by: str
    created_at: datetime
    is_active: bool = False


class ActivePromptUpdate(BaseModel):
    version_id: str | None = None

"""Project request/response schemas."""
from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.templates.builtin import VALID_TEMPLATE_KEYS

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")


class TemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    key: str
    display_name: str
    description: str
    expected_fields: list[str]
    recommended_processor: str


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=3, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    template_key: str

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        v = v.strip().lower()
        if not _SLUG_RE.match(v):
            raise ValueError("slug must be lowercase alphanumeric with hyphens")
        return v

    @field_validator("template_key")
    @classmethod
    def _template_valid(cls, v: str) -> str:
        if v not in VALID_TEMPLATE_KEYS:
            raise ValueError(f"template_key must be one of: {sorted(VALID_TEMPLATE_KEYS)}")
        return v


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    name: str
    slug: str
    description: str | None
    template_key: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class ProjectDetail(ProjectRead):
    template: TemplateRead | None
    document_count: int

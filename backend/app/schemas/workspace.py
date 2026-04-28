"""Workspace request/response schemas."""
from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=3, max_length=60)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("slug")
    @classmethod
    def _slug_format(cls, v: str) -> str:
        v = v.strip().lower()
        if not _SLUG_RE.match(v):
            raise ValueError(
                "slug must be lowercase alphanumeric with optional hyphens, "
                "3-60 chars, no leading/trailing hyphen"
            )
        return v


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    description: str | None
    owner_id: str


class MemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    email: EmailStr
    display_name: str
    role: str


class WorkspaceDetail(WorkspaceRead):
    members: list[MemberRead]


class MemberInvite(BaseModel):
    email: EmailStr
    role: str = Field(default="member")

    @field_validator("role")
    @classmethod
    def _role_check(cls, v: str) -> str:
        if v not in ("owner", "member"):
            raise ValueError("role must be 'owner' or 'member'")
        return v

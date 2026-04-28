"""Auth request/response schemas."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    display_name: str
    is_active: bool


class TokenResponse(BaseModel):
    token: str
    user: UserRead


class WorkspaceWithRole(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    role: str  # "owner" | "member"


class MeResponse(BaseModel):
    user: UserRead
    workspaces: list[WorkspaceWithRole]

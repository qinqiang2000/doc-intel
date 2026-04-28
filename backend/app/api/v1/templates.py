"""GET /api/v1/templates — list built-in Project templates."""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter

from app.core.deps import CurrentUser
from app.templates.builtin import BUILTIN_TEMPLATES

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[dict])
async def list_templates(_: CurrentUser) -> list[dict]:
    return [asdict(t) for t in BUILTIN_TEMPLATES]

"""Correction SSE endpoint under /api/v1/projects/{pid}/documents/{did}/correct."""
from __future__ import annotations

import json as _json
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.services import correction_service

router = APIRouter(prefix="/projects", tags=["correction"])


class CorrectRequest(BaseModel):
    user_message: str = Field(min_length=1, max_length=4000)
    current_prompt: str
    target_field: str | None = None
    processor_key_override: str | None = None


@router.post("/{project_id}/documents/{document_id}/correct")
async def correct(
    project_id: str,
    document_id: str,
    body: CorrectRequest,
    db: DbSession,
    user: CurrentUser,
) -> StreamingResponse:
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None)
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")
    mem_stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == project.workspace_id,
        WorkspaceMember.user_id == user.id,
    )
    if (await db.execute(mem_stmt)).scalar_one_or_none() is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")
    doc_stmt = select(Document).where(
        Document.id == document_id,
        Document.project_id == project_id,
        Document.deleted_at.is_(None),
    )
    document = (await db.execute(doc_stmt)).scalar_one_or_none()
    if document is None:
        raise AppError(404, "document_not_found", "Document not found.")

    async def event_gen() -> AsyncIterator[bytes]:
        async for evt in correction_service.stream_correction(
            db,
            project=project,
            document=document,
            user=user,
            user_message=body.user_message,
            current_prompt=body.current_prompt,
            target_field=body.target_field,
            processor_key_override=body.processor_key_override,
        ):
            line = (
                f"event: {evt['event']}\n"
                f"data: {_json.dumps(evt['data'])}\n\n"
            )
            yield line.encode()

    return StreamingResponse(event_gen(), media_type="text/event-stream")

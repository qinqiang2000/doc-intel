"""Predict endpoints — single sync POST + batch SSE."""
from __future__ import annotations

import json as _json
from typing import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.processing_result import ProcessingResult
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.predict import BatchPredictRequest, PredictRequest, ProcessingResultRead
from app.services import predict as predict_svc


def get_session_factory():
    """Return the async session factory. Overridable in tests."""
    return AsyncSessionLocal

router = APIRouter(prefix="/projects", tags=["predict"])


async def _check_doc_access(db, project_id: str, document_id: str, user_id: str):
    """Resolve doc + project, verify access. Returns (project, document)."""
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None)
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")

    mem_stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == project.workspace_id,
        WorkspaceMember.user_id == user_id,
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
    return project, document


@router.get(
    "/{project_id}/documents/{document_id}/predict/results",
    response_model=list[ProcessingResultRead],
)
async def list_results(
    project_id: str,
    document_id: str,
    db: DbSession,
    user: CurrentUser,
) -> list[ProcessingResultRead]:
    """Return all stored ProcessingResults for a document (newest first).

    Used by the workspace tabs so the user can browse predictions per
    (processor_key, prompt) combination without re-running the LLM.
    """
    await _check_doc_access(db, project_id, document_id, user.id)
    stmt = (
        select(ProcessingResult)
        .where(
            ProcessingResult.document_id == document_id,
            ProcessingResult.deleted_at.is_(None),
        )
        .order_by(ProcessingResult.version.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [ProcessingResultRead.model_validate(r) for r in rows]


@router.post(
    "/{project_id}/documents/{document_id}/predict",
    response_model=ProcessingResultRead,
)
async def predict_one(
    project_id: str,
    document_id: str,
    body: PredictRequest,
    db: DbSession,
    user: CurrentUser,
) -> ProcessingResultRead:
    project, document = await _check_doc_access(db, project_id, document_id, user.id)
    try:
        pr = await predict_svc.predict_single(
            db,
            document=document,
            project=project,
            user=user,
            prompt_override=body.prompt_override,
            processor_key_override=body.processor_key_override,
        )
    except predict_svc.PredictError as e:
        if e.code == "processor_not_available":
            raise AppError(400, e.code, e.message)
        raise AppError(500, e.code, e.message)
    return ProcessingResultRead.model_validate(pr)


@router.post("/{project_id}/batch-predict")
async def batch_predict(
    project_id: str,
    body: BatchPredictRequest,
    db: DbSession,
    user: CurrentUser,
    session_factory=Depends(get_session_factory),
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

    async def event_gen() -> AsyncIterator[bytes]:
        async for evt in predict_svc.predict_batch_stream(
            session_factory,
            project=project,
            document_ids=body.document_ids,
            user_id=user.id,
            prompt_override=body.prompt_override,
            processor_key_override=body.processor_key_override,
        ):
            if evt.get("_final"):
                payload = {k: v for k, v in evt.items() if k != "_final"}
                yield f"event: done\ndata: {_json.dumps(payload)}\n\n".encode()
            else:
                yield f"event: predict_progress\ndata: {_json.dumps(evt)}\n\n".encode()

    return StreamingResponse(event_gen(), media_type="text/event-stream")

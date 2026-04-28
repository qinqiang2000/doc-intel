"""Predict endpoints — single sync POST + batch SSE."""
from __future__ import annotations

from sqlalchemy import select

from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.predict import PredictRequest, ProcessingResultRead
from app.services import predict as predict_svc

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

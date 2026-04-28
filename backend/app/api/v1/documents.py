"""Documents router — nested under /api/v1/projects/{pid}/documents."""
from __future__ import annotations

from fastapi import APIRouter, File, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import FileResponse

from app.core.config import get_settings
from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.processing_result import ProcessingResult
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.document import DocumentList, DocumentRead, DocumentUpdate
from app.services import document_service as svc
from app.services import storage

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


async def _check_project_access(db: AsyncSession, project_id: str, user_id: str) -> None:
    """Look up project (excluding soft-deleted) and verify the user is a
    member of its workspace. Raises 404 or 403."""
    wsid_stmt = select(Project.workspace_id).where(
        Project.id == project_id, Project.deleted_at.is_(None)
    )
    wsid = (await db.execute(wsid_stmt)).scalar_one_or_none()
    if wsid is None:
        raise AppError(404, "project_not_found", "Project not found.")
    mem_stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == wsid,
        WorkspaceMember.user_id == user_id,
    )
    if (await db.execute(mem_stmt)).scalar_one_or_none() is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
async def upload(
    project_id: str,
    db: DbSession,
    user: CurrentUser,
    file: UploadFile = File(...),
) -> DocumentRead:
    await _check_project_access(db, project_id, user.id)

    settings = get_settings()
    data = await file.read()
    if len(data) > settings.MAX_UPLOAD_SIZE:
        raise AppError(413, "file_too_large", f"File exceeds {settings.MAX_UPLOAD_SIZE} bytes.")

    mime = file.content_type or "application/octet-stream"
    doc = await svc.upload_document(
        db,
        project_id=project_id,
        uploader=user,
        filename=file.filename or "unnamed",
        mime_type=mime,
        data=data,
    )
    return DocumentRead.model_validate(doc)


@router.get("", response_model=DocumentList)
async def list_(
    project_id: str,
    db: DbSession,
    user: CurrentUser,
    status: list[str] | None = Query(default=None),
    mime_type: list[str] | None = Query(default=None),
    q: str | None = None,
    is_ground_truth: bool | None = None,
    sort_by: str = "created_at",
    order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> DocumentList:
    await _check_project_access(db, project_id, user.id)

    items, total = await svc.list_documents(
        db,
        project_id=project_id,
        statuses=status,
        mime_types=mime_type,
        q=q,
        is_ground_truth=is_ground_truth,
        sort_by=sort_by,
        order=order,
        page=page,
        page_size=page_size,
    )
    return DocumentList(
        items=[DocumentRead.model_validate(d) for d in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/next-unreviewed", response_model=DocumentRead)
async def next_unreviewed(
    project_id: str,
    db: DbSession,
    user: CurrentUser,
) -> DocumentRead:
    """Return the first document in the project that has no ProcessingResult yet."""
    await _check_project_access(db, project_id, user.id)

    predicted_ids = select(ProcessingResult.document_id).distinct()
    stmt = (
        select(Document)
        .where(
            Document.project_id == project_id,
            Document.deleted_at.is_(None),
            Document.id.notin_(predicted_ids),
        )
        .order_by(Document.created_at)
        .limit(1)
    )
    doc = (await db.execute(stmt)).scalar_one_or_none()
    if doc is None:
        raise AppError(404, "no_unreviewed_documents", "All documents have been predicted at least once.")
    return DocumentRead.model_validate(doc)


@router.get("/{document_id}", response_model=DocumentRead)
async def get_(
    project_id: str,
    document_id: str,
    db: DbSession,
    user: CurrentUser,
) -> DocumentRead:
    await _check_project_access(db, project_id, user.id)
    d = await svc.get_document_or_404(db, project_id=project_id, document_id=document_id)
    return DocumentRead.model_validate(d)


@router.get("/{document_id}/preview")
async def preview(
    project_id: str,
    document_id: str,
    db: DbSession,
    user: CurrentUser,
) -> FileResponse:
    await _check_project_access(db, project_id, user.id)
    d = await svc.get_document_or_404(db, project_id=project_id, document_id=document_id)
    abs_path = storage.absolute_path(d.file_path)
    return FileResponse(
        path=str(abs_path),
        media_type=d.mime_type,
        filename=d.filename,
        content_disposition_type="inline",
    )


@router.patch("/{document_id}", response_model=DocumentRead)
async def patch_(
    project_id: str,
    document_id: str,
    body: DocumentUpdate,
    db: DbSession,
    user: CurrentUser,
) -> DocumentRead:
    await _check_project_access(db, project_id, user.id)
    d = await svc.get_document_or_404(db, project_id=project_id, document_id=document_id)
    d = await svc.update_document(db, d, is_ground_truth=body.is_ground_truth)
    return DocumentRead.model_validate(d)


@router.delete("/{document_id}", status_code=204)
async def delete_(
    project_id: str,
    document_id: str,
    db: DbSession,
    user: CurrentUser,
) -> None:
    await _check_project_access(db, project_id, user.id)
    d = await svc.get_document_or_404(db, project_id=project_id, document_id=document_id)
    await svc.soft_delete_document(db, d)

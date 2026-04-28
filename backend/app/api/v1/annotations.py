"""Annotation router — /api/v1/documents/{did}/annotations/*."""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.annotation import AnnotationCreate, AnnotationRead, AnnotationUpdate
from app.services import annotation_service as svc

router = APIRouter(prefix="/documents", tags=["annotations"])


async def _check_doc_access(db, document_id: str, user_id: str) -> None:
    doc_stmt = select(Document, Project).join(Project, Project.id == Document.project_id).where(
        Document.id == document_id,
        Document.deleted_at.is_(None),
        Project.deleted_at.is_(None),
    )
    row = (await db.execute(doc_stmt)).first()
    if row is None:
        raise AppError(404, "document_not_found", "Document not found.")
    _, project = row
    mem_stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == project.workspace_id,
        WorkspaceMember.user_id == user_id,
    )
    if (await db.execute(mem_stmt)).scalar_one_or_none() is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")


@router.get("/{document_id}/annotations", response_model=list[AnnotationRead])
async def list_(document_id: str, db: DbSession, user: CurrentUser) -> list[AnnotationRead]:
    await _check_doc_access(db, document_id, user.id)
    rows = await svc.list_annotations(db, document_id)
    return [AnnotationRead.model_validate(r) for r in rows]


@router.post(
    "/{document_id}/annotations",
    response_model=AnnotationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create(
    document_id: str, body: AnnotationCreate,
    db: DbSession, user: CurrentUser,
) -> AnnotationRead:
    await _check_doc_access(db, document_id, user.id)
    a = await svc.create_annotation(
        db, document_id=document_id, user_id=user.id,
        field_name=body.field_name, field_value=body.field_value,
        field_type=body.field_type, bounding_box=body.bounding_box,
        is_ground_truth=body.is_ground_truth,
    )
    return AnnotationRead.model_validate(a)


@router.patch("/{document_id}/annotations/{annotation_id}", response_model=AnnotationRead)
async def patch(
    document_id: str, annotation_id: str, body: AnnotationUpdate,
    db: DbSession, user: CurrentUser,
) -> AnnotationRead:
    await _check_doc_access(db, document_id, user.id)
    a = await svc.get_annotation_or_404(db, document_id, annotation_id)
    a = await svc.update_annotation(
        db, a, user_id=user.id,
        field_value=body.field_value if "field_value" in body.model_fields_set else ...,
        field_type=body.field_type,
        bounding_box=body.bounding_box if "bounding_box" in body.model_fields_set else ...,
        is_ground_truth=body.is_ground_truth,
    )
    return AnnotationRead.model_validate(a)


@router.delete("/{document_id}/annotations/{annotation_id}", status_code=204)
async def delete_(
    document_id: str, annotation_id: str,
    db: DbSession, user: CurrentUser,
) -> None:
    await _check_doc_access(db, document_id, user.id)
    a = await svc.get_annotation_or_404(db, document_id, annotation_id)
    await svc.delete_annotation(db, a, user.id)

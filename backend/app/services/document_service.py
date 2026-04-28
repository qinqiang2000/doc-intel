"""Document service: upload + list (with filters/pagination) + GT toggle + soft delete."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.document import Document, DocumentStatus
from app.models.user import User
from app.services import storage


async def upload_document(
    db: AsyncSession,
    *,
    project_id: str,
    uploader: User,
    filename: str,
    mime_type: str,
    data: bytes,
) -> Document:
    if mime_type not in storage.ALLOWED_MIME_TYPES:
        raise AppError(
            400, "unsupported_file_type", f"Unsupported mime_type: {mime_type}"
        )
    try:
        _, rel_path = storage.save_bytes(data, mime_type)
    except OSError as e:
        raise AppError(500, "upload_failed", f"Failed to write file: {e}")

    doc = Document(
        project_id=project_id,
        filename=filename,
        file_path=rel_path,
        file_size=len(data),
        mime_type=mime_type,
        status=DocumentStatus.READY,
        uploaded_by=uploader.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


async def get_document_or_404(
    db: AsyncSession, *, project_id: str, document_id: str
) -> Document:
    stmt = (
        select(Document)
        .where(
            Document.id == document_id,
            Document.project_id == project_id,
            Document.deleted_at.is_(None),
        )
    )
    d = (await db.execute(stmt)).scalar_one_or_none()
    if d is None:
        raise AppError(404, "document_not_found", "Document not found.")
    return d


async def list_documents(
    db: AsyncSession,
    *,
    project_id: str,
    statuses: list[str] | None = None,
    mime_types: list[str] | None = None,
    q: str | None = None,
    is_ground_truth: bool | None = None,
    sort_by: str = "created_at",
    order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Document], int]:
    base = select(Document).where(
        Document.project_id == project_id,
        Document.deleted_at.is_(None),
    )
    if statuses:
        base = base.where(or_(*[Document.status == s for s in statuses]))
    if mime_types:
        base = base.where(or_(*[Document.mime_type == m for m in mime_types]))
    if q:
        base = base.where(Document.filename.ilike(f"%{q}%"))
    if is_ground_truth is not None:
        base = base.where(Document.is_ground_truth.is_(is_ground_truth))

    count_stmt = select(func.count()).select_from(base.subquery())
    total = int((await db.execute(count_stmt)).scalar() or 0)

    sort_col = {
        "created_at": Document.created_at,
        "updated_at": Document.updated_at,
        "filename": Document.filename,
        "file_size": Document.file_size,
    }.get(sort_by, Document.created_at)
    sort_col = sort_col.desc() if order == "desc" else sort_col.asc()

    page = max(1, page)
    page_size = max(1, min(100, page_size))
    base = base.order_by(sort_col).offset((page - 1) * page_size).limit(page_size)
    items = list((await db.execute(base)).scalars().all())
    return items, total


async def update_document(
    db: AsyncSession, doc: Document, *, is_ground_truth: bool | None
) -> Document:
    if is_ground_truth is not None:
        doc.is_ground_truth = is_ground_truth
    await db.commit()
    await db.refresh(doc)
    return doc


async def soft_delete_document(db: AsyncSession, doc: Document) -> None:
    doc.deleted_at = datetime.now(timezone.utc)
    await db.commit()

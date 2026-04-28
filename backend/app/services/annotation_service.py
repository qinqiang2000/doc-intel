"""Annotation service: CRUD with revision logging."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.annotation import Annotation, AnnotationFieldType, AnnotationSource
from app.models.annotation_revision import AnnotationRevision, RevisionAction


def _snapshot(a: Annotation) -> dict:
    return {
        "field_name": a.field_name,
        "field_value": a.field_value,
        "field_type": a.field_type.value if a.field_type else None,
        "bounding_box": a.bounding_box,
        "is_ground_truth": a.is_ground_truth,
        "source": a.source.value,
    }


async def _add_revision(
    db: AsyncSession, annotation_id: str, action: RevisionAction,
    before: dict | None, after: dict | None, changed_by: str,
) -> None:
    db.add(AnnotationRevision(
        annotation_id=annotation_id, action=action,
        before=before, after=after, changed_by=changed_by,
    ))


async def list_annotations(db: AsyncSession, document_id: str) -> list[Annotation]:
    stmt = (
        select(Annotation)
        .where(
            Annotation.document_id == document_id,
            Annotation.deleted_at.is_(None),
        )
        .order_by(Annotation.created_at)
    )
    return list((await db.execute(stmt)).scalars().all())


async def create_annotation(
    db: AsyncSession,
    *,
    document_id: str,
    user_id: str,
    field_name: str,
    field_value: str | None,
    field_type: str,
    bounding_box: dict | None,
    is_ground_truth: bool,
    source: AnnotationSource = AnnotationSource.MANUAL,
) -> Annotation:
    try:
        ftype = AnnotationFieldType(field_type)
    except ValueError:
        raise AppError(422, "validation_error", f"Unknown field_type: {field_type}")
    a = Annotation(
        document_id=document_id, field_name=field_name,
        field_value=field_value, field_type=ftype,
        bounding_box=bounding_box, source=source,
        is_ground_truth=is_ground_truth, created_by=user_id,
    )
    db.add(a)
    await db.flush()
    await _add_revision(db, a.id, RevisionAction.CREATE, None, _snapshot(a), user_id)
    await db.commit()
    await db.refresh(a)
    return a


async def get_annotation_or_404(
    db: AsyncSession, document_id: str, annotation_id: str
) -> Annotation:
    stmt = select(Annotation).where(
        Annotation.id == annotation_id,
        Annotation.document_id == document_id,
        Annotation.deleted_at.is_(None),
    )
    a = (await db.execute(stmt)).scalar_one_or_none()
    if a is None:
        raise AppError(404, "annotation_not_found", "Annotation not found.")
    return a


async def update_annotation(
    db: AsyncSession,
    a: Annotation,
    *,
    user_id: str,
    field_value: str | None = ...,
    field_type: str | None = None,
    bounding_box: dict | None = ...,
    is_ground_truth: bool | None = None,
) -> Annotation:
    before = _snapshot(a)
    if field_value is not ...:
        a.field_value = field_value
    if field_type is not None:
        try:
            a.field_type = AnnotationFieldType(field_type)
        except ValueError:
            raise AppError(422, "validation_error", f"Unknown field_type: {field_type}")
    if bounding_box is not ...:
        a.bounding_box = bounding_box
    if is_ground_truth is not None:
        a.is_ground_truth = is_ground_truth
    a.updated_by_user_id = user_id
    await db.flush()
    await _add_revision(db, a.id, RevisionAction.UPDATE, before, _snapshot(a), user_id)
    await db.commit()
    await db.refresh(a)
    return a


async def delete_annotation(db: AsyncSession, a: Annotation, user_id: str) -> None:
    before = _snapshot(a)
    a.deleted_at = datetime.now(timezone.utc)
    await db.flush()
    await _add_revision(db, a.id, RevisionAction.DELETE, before, None, user_id)
    await db.commit()

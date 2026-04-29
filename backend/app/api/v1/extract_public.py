"""S5: public /extract/{api_code} route — single endpoint, NOT under /api/v1 prefix."""
from __future__ import annotations

from fastapi import APIRouter, File, Header, UploadFile
from sqlalchemy import select

from app.core.config import get_settings
from app.core.deps import DbSession
from app.core.exceptions import AppError
from app.models.project import Project
from app.models.user import User
from app.services import api_publish_service as pub_svc
from app.services import document_service
from app.services import predict as predict_svc

router = APIRouter(prefix="/extract", tags=["public-extract"])


@router.post("/{api_code}")
async def extract(
    api_code: str,
    db: DbSession,
    file: UploadFile = File(...),
    x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
):
    # 1. Find project by api_code
    proj_stmt = select(Project).where(
        Project.api_code == api_code, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "api_code_not_found", "API endpoint not found.")

    # 2. Check disabled
    if project.api_disabled_at is not None:
        raise AppError(403, "api_disabled", "API endpoint is disabled.")

    # 3. API key required
    if not x_api_key:
        raise AppError(401, "missing_api_key", "X-Api-Key header is required.")
    matched = await pub_svc.verify_api_key(
        db, project_id=project.id, presented_key=x_api_key,
    )
    if matched is None:
        raise AppError(401, "invalid_api_key", "Invalid API key.")

    # 4. Mark last_used_at
    await pub_svc.touch_last_used(db, matched)

    # 5. Read upload
    settings = get_settings()
    data = await file.read()
    if len(data) > settings.MAX_UPLOAD_SIZE:
        raise AppError(
            413, "file_too_large",
            f"File exceeds {settings.MAX_UPLOAD_SIZE} bytes.",
        )

    # 6. Resolve key creator (uploader for the new Document)
    user_stmt = select(User).where(User.id == matched.created_by)
    creator = (await db.execute(user_stmt)).scalar_one_or_none()
    if creator is None:
        raise AppError(500, "key_owner_missing", "API key owner not found.")

    # 7. Save Document via existing service (validates mime + persists row)
    mime = file.content_type or "application/octet-stream"
    doc = await document_service.upload_document(
        db, project_id=project.id, uploader=creator,
        filename=file.filename or "upload",
        mime_type=mime, data=data,
    )

    # 8. Predict (uses S3 resolve_prompt → active prompt version if any)
    try:
        pr = await predict_svc.predict_single(
            db, document=doc, project=project, user=creator,
            prompt_override=None, processor_key_override=None,
        )
    except predict_svc.PredictError as e:
        raise AppError(500, e.code, e.message)

    return {
        "document_id": doc.id,
        "structured_data": pr.structured_data,
    }

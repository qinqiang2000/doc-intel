"""S5: authed API publish router under /api/v1/projects/{pid}."""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.api_key import ApiKeyCreateRequest, ApiKeyCreateResponse, ApiKeyRead
from app.schemas.project import ProjectRead, PublishRequest
from app.services import api_publish_service as svc

router = APIRouter(prefix="/projects/{project_id}", tags=["api-publish"])


async def _check_project_access(db, project_id: str, user_id: str) -> Project:
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None),
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
    return project


@router.post("/publish", response_model=ProjectRead)
async def publish(
    project_id: str, body: PublishRequest,
    db: DbSession, user: CurrentUser,
) -> ProjectRead:
    await _check_project_access(db, project_id, user.id)
    project = await svc.publish_project(
        db, project_id=project_id, user=user, api_code=body.api_code,
    )
    return ProjectRead.model_validate(project)


@router.post("/unpublish", response_model=ProjectRead)
async def unpublish(
    project_id: str, db: DbSession, user: CurrentUser,
) -> ProjectRead:
    await _check_project_access(db, project_id, user.id)
    project = await svc.unpublish_project(db, project_id=project_id, user=user)
    return ProjectRead.model_validate(project)


@router.get("/api-keys", response_model=list[ApiKeyRead])
async def list_api_keys(
    project_id: str, db: DbSession, user: CurrentUser,
) -> list[ApiKeyRead]:
    await _check_project_access(db, project_id, user.id)
    keys = await svc.list_api_keys(db, project_id=project_id)
    return [ApiKeyRead.model_validate(k) for k in keys]


@router.post(
    "/api-keys",
    response_model=ApiKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_key(
    project_id: str, body: ApiKeyCreateRequest,
    db: DbSession, user: CurrentUser,
) -> ApiKeyCreateResponse:
    await _check_project_access(db, project_id, user.id)
    k, full = await svc.create_api_key(
        db, project_id=project_id, user=user, name=body.name,
    )
    return ApiKeyCreateResponse(
        id=k.id, project_id=k.project_id, name=k.name,
        key_prefix=k.key_prefix, is_active=k.is_active,
        last_used_at=k.last_used_at,
        created_by=k.created_by, created_at=k.created_at,
        key=full,
    )


@router.delete(
    "/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_api_key(
    project_id: str, key_id: str,
    db: DbSession, user: CurrentUser,
) -> None:
    await _check_project_access(db, project_id, user.id)
    await svc.soft_delete_api_key(
        db, project_id=project_id, key_id=key_id,
    )

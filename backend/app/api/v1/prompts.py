"""Prompt versioning router under /api/v1/projects/{project_id}."""
from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.prompt_version import (
    ActivePromptUpdate,
    PromptVersionCreate,
    PromptVersionRead,
)
from app.services import prompt_service as svc

router = APIRouter(prefix="/projects/{project_id}", tags=["prompts"])


async def _check_project_access(db, project_id: str, user_id: str) -> Project:
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
    return project


def _to_read(pv, active_id: str | None) -> PromptVersionRead:
    return PromptVersionRead(
        id=pv.id,
        project_id=pv.project_id,
        version=pv.version,
        prompt_text=pv.prompt_text,
        summary=pv.summary,
        created_by=pv.created_by,
        created_at=pv.created_at,
        is_active=(active_id == pv.id),
    )


@router.get("/prompt-versions", response_model=list[PromptVersionRead])
async def list_versions(
    project_id: str, db: DbSession, user: CurrentUser,
) -> list[PromptVersionRead]:
    project = await _check_project_access(db, project_id, user.id)
    versions = await svc.list_prompt_versions(db, project_id=project_id)
    return [_to_read(v, project.active_prompt_version_id) for v in versions]


@router.post(
    "/prompt-versions",
    response_model=PromptVersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_version(
    project_id: str, body: PromptVersionCreate,
    db: DbSession, user: CurrentUser,
) -> PromptVersionRead:
    project = await _check_project_access(db, project_id, user.id)
    pv = await svc.create_prompt_version(
        db, project_id=project_id, user=user,
        prompt_text=body.prompt_text, summary=body.summary,
    )
    return _to_read(pv, project.active_prompt_version_id)


@router.patch("/active-prompt")
async def update_active(
    project_id: str, body: ActivePromptUpdate,
    db: DbSession, user: CurrentUser,
) -> dict:
    await _check_project_access(db, project_id, user.id)
    project = await svc.set_active_prompt(
        db, project_id=project_id, version_id=body.version_id,
    )
    return {
        "id": project.id,
        "active_prompt_version_id": project.active_prompt_version_id,
    }


@router.delete(
    "/prompt-versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_version(
    project_id: str, version_id: str,
    db: DbSession, user: CurrentUser,
) -> None:
    await _check_project_access(db, project_id, user.id)
    await svc.soft_delete_prompt_version(
        db, project_id=project_id, version_id=version_id,
    )

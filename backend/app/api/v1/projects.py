"""Projects router — nested under /api/v1/workspaces/{wsid}/projects."""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, status

from app.core.deps import (
    CurrentUser,
    DbSession,
    get_workspace_membership,
)
from app.models.workspace_member import WorkspaceMember
from app.schemas.project import (
    ProjectCreate,
    ProjectDetail,
    ProjectRead,
    ProjectUpdate,
    TemplateRead,
)
from app.services import project_service as svc
from app.templates.builtin import get_template

router = APIRouter(
    prefix="/workspaces/{workspace_id}/projects",
    tags=["projects"],
)


@router.get("", response_model=list[ProjectRead])
async def list_projects(
    workspace_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(get_workspace_membership),
    include_deleted: bool = False,
) -> list[ProjectRead]:
    rows = await svc.list_projects(
        db, workspace_id=workspace_id, include_deleted=include_deleted
    )
    return [ProjectRead.model_validate(p) for p in rows]


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    workspace_id: str,
    body: ProjectCreate,
    user: CurrentUser,
    db: DbSession,
    _: WorkspaceMember = Depends(get_workspace_membership),
) -> ProjectRead:
    p = await svc.create_project(
        db,
        workspace_id=workspace_id,
        creator=user,
        name=body.name,
        slug=body.slug,
        description=body.description,
        template_key=body.template_key,
    )
    return ProjectRead.model_validate(p)


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(
    workspace_id: str,
    project_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(get_workspace_membership),
) -> ProjectDetail:
    p = await svc.get_project_or_404(
        db, workspace_id=workspace_id, project_id=project_id
    )
    doc_count = await svc.count_documents(db, project_id)
    tmpl = get_template(p.template_key) if p.template_key else None
    template_read = TemplateRead(**asdict(tmpl)) if tmpl else None
    base = ProjectRead.model_validate(p).model_dump()
    return ProjectDetail(**base, template=template_read, document_count=doc_count)


@router.patch("/{project_id}", response_model=ProjectRead)
async def patch_project(
    workspace_id: str,
    project_id: str,
    body: ProjectUpdate,
    db: DbSession,
    _: WorkspaceMember = Depends(get_workspace_membership),
) -> ProjectRead:
    p = await svc.get_project_or_404(
        db, workspace_id=workspace_id, project_id=project_id
    )
    p = await svc.update_project(db, p, name=body.name, description=body.description)
    return ProjectRead.model_validate(p)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    workspace_id: str,
    project_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(get_workspace_membership),
) -> None:
    p = await svc.get_project_or_404(
        db, workspace_id=workspace_id, project_id=project_id
    )
    await svc.soft_delete_project(db, p)


@router.post("/{project_id}/restore", response_model=ProjectRead)
async def restore_project(
    workspace_id: str,
    project_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(get_workspace_membership),
) -> ProjectRead:
    p = await svc.get_project_or_404(
        db, workspace_id=workspace_id, project_id=project_id, include_deleted=True
    )
    p = await svc.restore_project(db, p)
    return ProjectRead.model_validate(p)

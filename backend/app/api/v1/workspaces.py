"""Workspace router: CRUD + members."""
from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.core.deps import (
    CurrentUser,
    DbSession,
    get_workspace_membership,
    require_workspace_owner,
)
from app.models.workspace_member import WorkspaceMember
from app.schemas.workspace import (
    MemberInvite,
    MemberRead,
    WorkspaceCreate,
    WorkspaceDetail,
    WorkspaceRead,
    WorkspaceUpdate,
)
from app.services import workspace_service as svc
from app.services.auth_service import list_user_workspaces

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[dict])
async def list_my_workspaces(user: CurrentUser, db: DbSession) -> list[dict]:
    return await list_user_workspaces(db, user.id)


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreate, user: CurrentUser, db: DbSession
) -> WorkspaceRead:
    ws = await svc.create_workspace(
        db, owner=user, name=body.name, slug=body.slug, description=body.description
    )
    return WorkspaceRead.model_validate(ws)


@router.get("/{workspace_id}", response_model=WorkspaceDetail)
async def get_workspace(
    workspace_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(get_workspace_membership),
) -> WorkspaceDetail:
    ws = await svc.get_workspace_or_404(db, workspace_id)
    members = await svc.list_members(db, workspace_id)
    return WorkspaceDetail(
        **WorkspaceRead.model_validate(ws).model_dump(),
        members=[MemberRead(**m) for m in members],
    )


@router.patch("/{workspace_id}", response_model=WorkspaceRead)
async def patch_workspace(
    workspace_id: str,
    body: WorkspaceUpdate,
    db: DbSession,
    _: WorkspaceMember = Depends(require_workspace_owner),
) -> WorkspaceRead:
    ws = await svc.get_workspace_or_404(db, workspace_id)
    ws = await svc.update_workspace(db, ws, name=body.name, description=body.description)
    return WorkspaceRead.model_validate(ws)


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(require_workspace_owner),
) -> None:
    ws = await svc.get_workspace_or_404(db, workspace_id)
    await svc.delete_workspace(db, ws)


@router.post(
    "/{workspace_id}/members",
    response_model=MemberRead,
    status_code=status.HTTP_201_CREATED,
)
async def invite_member(
    workspace_id: str,
    body: MemberInvite,
    db: DbSession,
    _: WorkspaceMember = Depends(require_workspace_owner),
) -> MemberRead:
    m = await svc.invite_member(
        db, workspace_id=workspace_id, email=body.email, role=body.role
    )
    return MemberRead(**m)


@router.delete("/{workspace_id}/members/{user_id}", status_code=204)
async def remove_member(
    workspace_id: str,
    user_id: str,
    db: DbSession,
    _: WorkspaceMember = Depends(require_workspace_owner),
) -> None:
    await svc.remove_member(db, workspace_id=workspace_id, user_id=user_id)

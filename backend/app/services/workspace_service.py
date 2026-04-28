"""Workspace service: create, list, get, update, delete, members."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember, WorkspaceRole


async def create_workspace(
    db: AsyncSession,
    *,
    owner: User,
    name: str,
    slug: str,
    description: str | None,
) -> Workspace:
    ws = Workspace(name=name, slug=slug, owner_id=owner.id, description=description)
    db.add(ws)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "workspace_slug_taken", f"Slug '{slug}' already exists.")
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role=WorkspaceRole.OWNER))
    await db.commit()
    await db.refresh(ws)
    return ws


async def get_workspace_or_404(db: AsyncSession, workspace_id: str) -> Workspace:
    ws = (
        await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    ).scalar_one_or_none()
    if ws is None:
        raise AppError(404, "workspace_not_found", "Workspace not found.")
    return ws


async def update_workspace(
    db: AsyncSession,
    workspace: Workspace,
    *,
    name: str | None,
    description: str | None,
) -> Workspace:
    if name is not None:
        workspace.name = name
    if description is not None:
        workspace.description = description
    await db.commit()
    await db.refresh(workspace)
    return workspace


async def delete_workspace(db: AsyncSession, workspace: Workspace) -> None:
    await db.delete(workspace)
    await db.commit()


async def list_members(db: AsyncSession, workspace_id: str) -> list[dict]:
    stmt = (
        select(User, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "user_id": u.id,
            "email": u.email,
            "display_name": u.display_name,
            "role": role.value,
        }
        for u, role in rows
    ]


async def invite_member(
    db: AsyncSession,
    *,
    workspace_id: str,
    email: str,
    role: str,
) -> dict:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        raise AppError(404, "user_not_found", f"No registered user with email '{email}'.")
    existing = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(409, "member_already_exists", "User is already a member.")
    db.add(
        WorkspaceMember(
            workspace_id=workspace_id, user_id=user.id, role=WorkspaceRole(role)
        )
    )
    await db.commit()
    return {
        "user_id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": role,
    }


async def remove_member(db: AsyncSession, *, workspace_id: str, user_id: str) -> None:
    member = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise AppError(404, "user_not_found", "Member not found in this workspace.")
    if member.role == WorkspaceRole.OWNER:
        raise AppError(
            400,
            "cannot_remove_owner",
            "Cannot remove the workspace owner. Transfer ownership first.",
        )
    await db.delete(member)
    await db.commit()

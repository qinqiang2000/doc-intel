"""FastAPI dependencies: auth + DB + workspace membership."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import AppError
from app.core.security import decode_access_token
from app.models.user import User
from app.models.workspace_member import WorkspaceMember, WorkspaceRole

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError(401, "unauthorized", "Missing or malformed Authorization header.")
    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_access_token(token)
    if payload is None:
        raise AppError(401, "unauthorized", "Invalid or expired token.")
    user_id = payload.get("sub")
    if not user_id:
        raise AppError(401, "unauthorized", "Token payload missing subject.")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise AppError(401, "unauthorized", "User not found or inactive.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_workspace_membership(
    workspace_id: str,
    db: DbSession,
    user: CurrentUser,
) -> WorkspaceMember:
    """Return the user's membership in the workspace; 403 if not a member."""
    stmt = select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user.id,
    )
    member = (await db.execute(stmt)).scalar_one_or_none()
    if member is None:
        raise AppError(403, "forbidden", "You are not a member of this workspace.")
    return member


async def require_workspace_owner(
    membership: Annotated[WorkspaceMember, Depends(get_workspace_membership)],
) -> WorkspaceMember:
    if membership.role != WorkspaceRole.OWNER:
        raise AppError(403, "forbidden", "Workspace owner role required.")
    return membership

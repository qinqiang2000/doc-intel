"""Auth service: register / authenticate / list_user_workspaces."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember


async def register_user(
    db: AsyncSession, *, email: str, password: str, display_name: str
) -> tuple[User, str]:
    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing:
        raise AppError(409, "email_already_registered", "Email already registered.")
    user = User(email=email, password_hash=hash_password(password), display_name=display_name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)
    return user, token


async def authenticate_user(
    db: AsyncSession, *, email: str, password: str
) -> tuple[User, str]:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise AppError(401, "invalid_credentials", "Email or password incorrect.")
    if not user.is_active:
        raise AppError(401, "invalid_credentials", "Account inactive.")
    token = create_access_token(user_id=user.id, email=user.email)
    return user, token


async def list_user_workspaces(db: AsyncSession, user_id: str) -> list[dict]:
    """Return [{id, name, slug, role}] for all workspaces the user belongs to."""
    stmt = (
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(Workspace.created_at)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {"id": ws.id, "name": ws.name, "slug": ws.slug, "role": role.value}
        for ws, role in rows
    ]

"""S3: PromptVersion CRUD + active-prompt resolution helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.project import Project
from app.models.prompt_version import PromptVersion
from app.models.user import User


async def create_prompt_version(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
    prompt_text: str,
    summary: str = "",
) -> PromptVersion:
    next_version_stmt = select(func.coalesce(func.max(PromptVersion.version), 0) + 1).where(
        PromptVersion.project_id == project_id,
    )
    next_version = (await db.execute(next_version_stmt)).scalar_one()
    pv = PromptVersion(
        project_id=project_id,
        version=next_version,
        prompt_text=prompt_text,
        summary=summary,
        created_by=user.id,
    )
    db.add(pv)
    await db.commit()
    await db.refresh(pv)
    return pv


async def list_prompt_versions(
    db: AsyncSession, *, project_id: str,
) -> Sequence[PromptVersion]:
    stmt = (
        select(PromptVersion)
        .where(PromptVersion.project_id == project_id, PromptVersion.deleted_at.is_(None))
        .order_by(PromptVersion.version.desc())
    )
    return (await db.execute(stmt)).scalars().all()


async def get_prompt_version_or_404(
    db: AsyncSession, *, project_id: str, version_id: str,
) -> PromptVersion:
    stmt = select(PromptVersion).where(
        PromptVersion.id == version_id,
        PromptVersion.project_id == project_id,
        PromptVersion.deleted_at.is_(None),
    )
    pv = (await db.execute(stmt)).scalar_one_or_none()
    if pv is None:
        raise AppError(404, "prompt_version_not_found", "Prompt version not found.")
    return pv


async def soft_delete_prompt_version(
    db: AsyncSession, *, project_id: str, version_id: str,
) -> None:
    pv = await get_prompt_version_or_404(db, project_id=project_id, version_id=version_id)
    proj_stmt = select(Project).where(Project.id == project_id)
    project = (await db.execute(proj_stmt)).scalar_one()
    if project.active_prompt_version_id == pv.id:
        raise AppError(409, "prompt_in_use", "Cannot delete the active prompt version.")
    pv.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def set_active_prompt(
    db: AsyncSession, *, project_id: str, version_id: str | None,
) -> Project:
    proj_stmt = select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")
    if version_id is not None:
        await get_prompt_version_or_404(db, project_id=project_id, version_id=version_id)
    project.active_prompt_version_id = version_id
    await db.commit()
    await db.refresh(project)
    return project

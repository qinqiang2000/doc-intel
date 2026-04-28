"""Project service: CRUD + soft delete + restore."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.document import Document
from app.models.project import Project
from app.models.user import User


async def create_project(
    db: AsyncSession,
    *,
    workspace_id: str,
    creator: User,
    name: str,
    slug: str,
    description: str | None,
    template_key: str,
) -> Project:
    p = Project(
        workspace_id=workspace_id,
        name=name,
        slug=slug,
        description=description,
        template_key=template_key,
        created_by=creator.id,
    )
    db.add(p)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "project_slug_taken", f"Slug '{slug}' already exists in this workspace.")
    await db.refresh(p)
    return p


async def list_projects(
    db: AsyncSession, *, workspace_id: str, include_deleted: bool = False
) -> list[Project]:
    stmt = select(Project).where(Project.workspace_id == workspace_id)
    if not include_deleted:
        stmt = stmt.where(Project.deleted_at.is_(None))
    stmt = stmt.order_by(Project.created_at.desc())
    return list((await db.execute(stmt)).scalars().all())


async def get_project_or_404(
    db: AsyncSession, *, workspace_id: str, project_id: str, include_deleted: bool = False
) -> Project:
    stmt = select(Project).where(
        Project.id == project_id, Project.workspace_id == workspace_id
    )
    if not include_deleted:
        stmt = stmt.where(Project.deleted_at.is_(None))
    p = (await db.execute(stmt)).scalar_one_or_none()
    if p is None:
        raise AppError(404, "project_not_found", "Project not found.")
    return p


async def count_documents(db: AsyncSession, project_id: str) -> int:
    stmt = (
        select(func.count(Document.id))
        .where(Document.project_id == project_id)
        .where(Document.deleted_at.is_(None))
    )
    return int((await db.execute(stmt)).scalar() or 0)


async def update_project(
    db: AsyncSession,
    project: Project,
    *,
    name: str | None,
    description: str | None,
) -> Project:
    if name is not None:
        project.name = name
    if description is not None:
        project.description = description
    await db.commit()
    await db.refresh(project)
    return project


async def soft_delete_project(db: AsyncSession, project: Project) -> None:
    project.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def restore_project(db: AsyncSession, project: Project) -> Project:
    project.deleted_at = None
    await db.commit()
    await db.refresh(project)
    return project

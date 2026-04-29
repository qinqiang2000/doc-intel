"""S5: API publish service — key generation, verification, state transitions."""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.models.api_key import ApiKey
from app.models.project import Project
from app.models.user import User


_API_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")


def _validate_api_code(code: str) -> None:
    if not _API_CODE_RE.match(code):
        raise AppError(
            400, "api_code_invalid",
            "api_code must be 3-60 lowercase alphanumeric chars with optional hyphens, "
            "no leading/trailing hyphen.",
        )


def generate_api_key() -> tuple[str, str, str]:
    """Returns (full_plaintext_key, key_prefix_12_chars, bcrypt_hash)."""
    raw = secrets.token_urlsafe(32)            # ≈43 chars, URL-safe
    full = f"dik_{raw}"                         # ≈47 chars
    prefix = full[:12]                          # "dik_AbCdEfGh"
    hashed = bcrypt.hashpw(
        full.encode("utf-8"), bcrypt.gensalt(rounds=10),
    ).decode("utf-8")
    return full, prefix, hashed


def _verify_one(presented: str, hashed: str) -> bool:
    """Constant-time bcrypt verify."""
    try:
        return bcrypt.checkpw(presented.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


async def verify_api_key(
    db: AsyncSession, *, project_id: str, presented_key: str,
) -> ApiKey | None:
    """Linear-scan project's active keys; return matching ApiKey or None."""
    stmt = select(ApiKey).where(
        ApiKey.project_id == project_id,
        ApiKey.is_active.is_(True),
        ApiKey.deleted_at.is_(None),
    )
    keys = (await db.execute(stmt)).scalars().all()
    for k in keys:
        if _verify_one(presented_key, k.key_hash):
            return k
    return None


async def publish_project(
    db: AsyncSession, *, project_id: str, user: User, api_code: str,
) -> Project:
    """Publish or re-publish a project under the given api_code."""
    _validate_api_code(api_code)
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")

    if project.api_code is not None and project.api_code != api_code:
        raise AppError(
            400, "api_code_immutable",
            f"api_code '{project.api_code}' cannot be changed; use the existing value.",
        )

    # Check uniqueness across other projects (DB index will also enforce)
    if project.api_code is None:
        dup_stmt = select(Project).where(Project.api_code == api_code)
        dup = (await db.execute(dup_stmt)).scalar_one_or_none()
        if dup is not None and dup.id != project.id:
            raise AppError(409, "api_code_taken", "api_code already taken.")

    if project.api_code is None:
        project.api_code = api_code
        project.api_published_at = datetime.now(timezone.utc)
    project.api_disabled_at = None  # Re-publish from disabled clears this

    await db.commit()
    await db.refresh(project)
    return project


async def unpublish_project(
    db: AsyncSession, *, project_id: str, user: User,
) -> Project:
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")
    if project.api_code is None:
        raise AppError(400, "api_not_published", "Project is not published.")
    if project.api_disabled_at is None:
        project.api_disabled_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(project)
    return project


async def create_api_key(
    db: AsyncSession, *, project_id: str, user: User, name: str = "",
) -> tuple[ApiKey, str]:
    """Create a new key. Returns (ApiKey row, full plaintext key)."""
    full, prefix, hashed = generate_api_key()
    k = ApiKey(
        project_id=project_id,
        name=name,
        key_prefix=prefix,
        key_hash=hashed,
        is_active=True,
        created_by=user.id,
    )
    db.add(k)
    await db.commit()
    await db.refresh(k)
    return k, full


async def list_api_keys(db: AsyncSession, *, project_id: str) -> list[ApiKey]:
    stmt = (
        select(ApiKey)
        .where(
            ApiKey.project_id == project_id,
            ApiKey.deleted_at.is_(None),
        )
        .order_by(ApiKey.created_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def soft_delete_api_key(
    db: AsyncSession, *, project_id: str, key_id: str,
) -> None:
    stmt = select(ApiKey).where(
        ApiKey.id == key_id,
        ApiKey.project_id == project_id,
        ApiKey.deleted_at.is_(None),
    )
    k = (await db.execute(stmt)).scalar_one_or_none()
    if k is None:
        raise AppError(404, "api_key_not_found", "API key not found.")
    k.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def touch_last_used(db: AsyncSession, key: ApiKey) -> None:
    key.last_used_at = datetime.now(timezone.utc)
    await db.commit()

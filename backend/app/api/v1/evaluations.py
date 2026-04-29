"""Evaluations router under /api/v1."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.exceptions import AppError
from app.models.evaluation_field_result import EvaluationFieldResult
from app.models.evaluation_run import EvaluationRun
from app.models.project import Project
from app.models.workspace_member import WorkspaceMember
from app.schemas.evaluation import (
    EvaluationDetailRead,
    EvaluationFieldResultRead,
    EvaluationRunCreate,
    EvaluationRunRead,
)
from app.services import evaluation_service

# Project-scoped (POST + list)
project_router = APIRouter(prefix="/projects/{project_id}", tags=["evaluations"])

# Run-scoped (detail, delete, excel)
run_router = APIRouter(prefix="/evaluations", tags=["evaluations"])


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


async def _load_run_with_access(db, run_id: str, user_id: str) -> EvaluationRun:
    stmt = select(EvaluationRun).where(
        EvaluationRun.id == run_id,
        EvaluationRun.deleted_at.is_(None),
    )
    run = (await db.execute(stmt)).scalar_one_or_none()
    if run is None:
        raise AppError(404, "evaluation_not_found", "Evaluation not found.")
    await _check_project_access(db, run.project_id, user_id)
    return run


@project_router.post(
    "/evaluations",
    response_model=EvaluationRunRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_evaluation(
    project_id: str, body: EvaluationRunCreate,
    db: DbSession, user: CurrentUser,
) -> EvaluationRunRead:
    await _check_project_access(db, project_id, user.id)
    run = await evaluation_service.run_evaluation(
        db, project_id=project_id, user=user, name=body.name,
    )
    return EvaluationRunRead.model_validate(run)


@project_router.get("/evaluations", response_model=list[EvaluationRunRead])
async def list_evaluations(
    project_id: str, db: DbSession, user: CurrentUser,
) -> list[EvaluationRunRead]:
    await _check_project_access(db, project_id, user.id)
    stmt = (
        select(EvaluationRun)
        .where(
            EvaluationRun.project_id == project_id,
            EvaluationRun.deleted_at.is_(None),
        )
        .order_by(EvaluationRun.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [EvaluationRunRead.model_validate(r) for r in rows]


@run_router.get("/{run_id}", response_model=EvaluationDetailRead)
async def get_evaluation_detail(
    run_id: str, db: DbSession, user: CurrentUser,
) -> EvaluationDetailRead:
    run = await _load_run_with_access(db, run_id, user.id)
    fields_stmt = (
        select(EvaluationFieldResult)
        .where(EvaluationFieldResult.run_id == run.id)
        .order_by(
            EvaluationFieldResult.document_filename,
            EvaluationFieldResult.field_name,
        )
    )
    fields = (await db.execute(fields_stmt)).scalars().all()
    return EvaluationDetailRead(
        run=EvaluationRunRead.model_validate(run),
        fields=[EvaluationFieldResultRead.model_validate(f) for f in fields],
    )


@run_router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_evaluation(
    run_id: str, db: DbSession, user: CurrentUser,
) -> None:
    run = await _load_run_with_access(db, run_id, user.id)
    run.deleted_at = datetime.now(timezone.utc)
    await db.commit()

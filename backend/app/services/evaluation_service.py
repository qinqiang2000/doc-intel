"""S4: evaluation service — synchronously compute per-field comparisons."""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.engine.scoring import score_field
from app.models.annotation import Annotation
from app.models.document import Document
from app.models.evaluation_field_result import EvaluationFieldResult
from app.models.evaluation_run import EvaluationRun
from app.models.processing_result import ProcessingResult
from app.models.project import Project
from app.models.user import User

logger = logging.getLogger(__name__)


def _stringify(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, ensure_ascii=False)
    return str(value)


def _field_type_str(ftype: Any) -> str:
    """Coerce field_type (enum or str) to a plain string for score_field."""
    if ftype is None:
        return "string"
    val = getattr(ftype, "value", ftype)
    return str(val) or "string"


async def run_evaluation(
    db: AsyncSession,
    *,
    project_id: str,
    user: User,
    name: str = "",
) -> EvaluationRun:
    """Compute per-field match status for all eligible docs in project; persist."""
    proj_stmt = select(Project).where(
        Project.id == project_id, Project.deleted_at.is_(None),
    )
    project = (await db.execute(proj_stmt)).scalar_one_or_none()
    if project is None:
        raise AppError(404, "project_not_found", "Project not found.")

    docs_stmt = select(Document).where(
        Document.project_id == project_id, Document.deleted_at.is_(None),
    )
    docs = (await db.execute(docs_stmt)).scalars().all()

    field_results: list[EvaluationFieldResult] = []
    num_docs_evaluated = 0
    num_fields = 0
    num_matches = 0

    try:
        for doc in docs:
            pr_stmt = (
                select(ProcessingResult)
                .where(ProcessingResult.document_id == doc.id)
                .order_by(ProcessingResult.updated_at.desc())
                .limit(1)
            )
            pr = (await db.execute(pr_stmt)).scalar_one_or_none()
            if pr is None:
                continue  # skip un-predicted docs

            ann_stmt = select(Annotation).where(Annotation.document_id == doc.id)
            anns = (await db.execute(ann_stmt)).scalars().all()
            expected_by_field: dict[str, Annotation] = {}
            # Latest write wins by updated_at
            for a in sorted(anns, key=lambda x: x.updated_at):
                expected_by_field[a.field_name] = a

            sd: Any = pr.structured_data or {}
            predicted_by_field: dict[str, Any] = dict(sd) if isinstance(sd, dict) else {}

            all_fields = set(predicted_by_field) | set(expected_by_field)
            doc_evaluated_any = False

            for f in sorted(all_fields):
                predicted = predicted_by_field.get(f)
                ann = expected_by_field.get(f)
                expected = ann.field_value if ann else None
                ftype = _field_type_str(ann.field_type if ann else "string")
                status = score_field(predicted, expected, ftype)
                fr = EvaluationFieldResult(
                    run_id="",  # set after run insert
                    document_id=doc.id,
                    document_filename=doc.filename,
                    field_name=f,
                    predicted_value=_stringify(predicted),
                    expected_value=_stringify(expected),
                    match_status=status,
                )
                field_results.append(fr)

                # Accuracy denom: exclude both-null rows (no-signal)
                if predicted is None and expected is None:
                    continue
                num_fields += 1
                if status in ("exact", "fuzzy"):
                    num_matches += 1
                doc_evaluated_any = True

            if doc_evaluated_any:
                num_docs_evaluated += 1

        accuracy = (num_matches / num_fields) if num_fields else 0.0

        run = EvaluationRun(
            project_id=project_id,
            prompt_version_id=project.active_prompt_version_id,
            name=name,
            num_docs=num_docs_evaluated,
            num_fields_evaluated=num_fields,
            num_matches=num_matches,
            accuracy_avg=accuracy,
            status="completed",
            created_by=user.id,
        )
        db.add(run)
        await db.flush()
        for fr in field_results:
            fr.run_id = run.id
            db.add(fr)
        await db.commit()
        await db.refresh(run)
        return run

    except Exception as e:
        logger.exception("evaluation failed for project %s", project_id)
        await db.rollback()
        run = EvaluationRun(
            project_id=project_id,
            prompt_version_id=project.active_prompt_version_id,
            name=name,
            num_docs=0, num_fields_evaluated=0, num_matches=0,
            accuracy_avg=0.0,
            status="failed",
            error_message=str(e),
            created_by=user.id,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return run

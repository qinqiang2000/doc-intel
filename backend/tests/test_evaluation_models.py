"""S4/T1: EvaluationRun + EvaluationFieldResult model tests."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select


@pytest.mark.asyncio
async def test_evaluation_run_basic_insert(db_session, seed_project, seed_user):
    from app.models.evaluation_run import EvaluationRun

    run = EvaluationRun(
        project_id=seed_project.id,
        prompt_version_id=None,
        name="first run",
        num_docs=2,
        num_fields_evaluated=10,
        num_matches=8,
        accuracy_avg=0.8,
        status="completed",
        created_by=seed_user.id,
    )
    db_session.add(run)
    await db_session.commit()
    out = (await db_session.execute(select(EvaluationRun))).scalar_one()
    assert out.name == "first run"
    assert out.accuracy_avg == 0.8
    assert out.status == "completed"
    assert out.deleted_at is None


@pytest.mark.asyncio
async def test_evaluation_field_result_basic_insert(db_session, seed_project, seed_user):
    from app.models.evaluation_run import EvaluationRun
    from app.models.evaluation_field_result import EvaluationFieldResult

    run = EvaluationRun(
        project_id=seed_project.id, name="r", num_docs=1,
        num_fields_evaluated=1, num_matches=1, accuracy_avg=1.0,
        status="completed", created_by=seed_user.id,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    fr = EvaluationFieldResult(
        run_id=run.id, document_id=None, document_filename="x.pdf",
        field_name="invoice_no", predicted_value="INV-1",
        expected_value="INV-1", match_status="exact",
    )
    db_session.add(fr)
    await db_session.commit()
    out = (await db_session.execute(select(EvaluationFieldResult))).scalar_one()
    assert out.match_status == "exact"
    assert out.document_filename == "x.pdf"


@pytest.mark.asyncio
async def test_run_cascade_delete_removes_field_results(db_session, seed_project, seed_user):
    from app.models.evaluation_run import EvaluationRun
    from app.models.evaluation_field_result import EvaluationFieldResult

    run = EvaluationRun(
        project_id=seed_project.id, name="r", num_docs=1,
        num_fields_evaluated=1, num_matches=1, accuracy_avg=1.0,
        status="completed", created_by=seed_user.id,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    db_session.add(EvaluationFieldResult(
        run_id=run.id, document_filename="x.pdf",
        field_name="f", predicted_value="a", expected_value="a",
        match_status="exact",
    ))
    await db_session.commit()

    await db_session.delete(run)
    await db_session.commit()

    fr_rows = (await db_session.execute(select(EvaluationFieldResult))).scalars().all()
    assert fr_rows == []


@pytest.mark.asyncio
async def test_evaluation_run_soft_delete_field_set(db_session, seed_project, seed_user):
    from app.models.evaluation_run import EvaluationRun

    run = EvaluationRun(
        project_id=seed_project.id, name="r", num_docs=0,
        num_fields_evaluated=0, num_matches=0, accuracy_avg=0,
        status="completed", created_by=seed_user.id,
    )
    db_session.add(run)
    await db_session.commit()

    run.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    out = (await db_session.execute(select(EvaluationRun))).scalar_one()
    assert out.deleted_at is not None

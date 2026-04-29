"""S4/T3: evaluation_service tests."""
from __future__ import annotations

import pytest
from sqlalchemy import select


async def _make_doc_with_predict_and_anns(db, project, user, filename, structured_data, annotations):
    """Helper: create a Document + ProcessingResult + Annotations."""
    from app.models.document import Document
    from app.models.processing_result import ProcessingResult
    from app.models.annotation import Annotation

    doc = Document(
        project_id=project.id, filename=filename, file_path=filename,
        file_size=1, mime_type="application/pdf", uploaded_by=user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    pr = ProcessingResult(
        document_id=doc.id, version=1, structured_data=structured_data,
        inferred_schema=None, prompt_used="p", processor_key="mock|m",
        source="predict", created_by=user.id,
    )
    db.add(pr)
    for fname, fval, ftype in annotations:
        db.add(Annotation(
            document_id=doc.id, field_name=fname, field_value=fval,
            field_type=ftype or "string", bounding_box=None,
            source="manual", confidence=None, is_ground_truth=False,
            created_by=user.id, updated_by_user_id=user.id,
        ))
    await db.commit()
    return doc


@pytest.mark.asyncio
async def test_run_evaluation_basic_match(db_session, seed_project, seed_user):
    from app.services.evaluation_service import run_evaluation
    await _make_doc_with_predict_and_anns(
        db_session, seed_project, seed_user, "a.pdf",
        {"invoice_number": "INV-1", "total": 100},
        [("invoice_number", "INV-1", "string"), ("total", "100", "number")],
    )

    run = await run_evaluation(
        db_session, project_id=seed_project.id, user=seed_user, name="t",
    )
    assert run.status == "completed"
    assert run.num_docs == 1
    assert run.num_fields_evaluated == 2
    assert run.num_matches == 2
    assert run.accuracy_avg == 1.0


@pytest.mark.asyncio
async def test_run_evaluation_mismatch_lowers_accuracy(db_session, seed_project, seed_user):
    from app.services.evaluation_service import run_evaluation
    await _make_doc_with_predict_and_anns(
        db_session, seed_project, seed_user, "a.pdf",
        {"invoice_number": "INV-WRONG", "total": 100},
        [("invoice_number", "INV-1", "string"), ("total", "100", "number")],
    )

    run = await run_evaluation(
        db_session, project_id=seed_project.id, user=seed_user, name="t",
    )
    assert run.num_fields_evaluated == 2
    assert run.num_matches == 1
    assert run.accuracy_avg == 0.5


@pytest.mark.asyncio
async def test_run_evaluation_no_data_project(db_session, seed_project, seed_user):
    """Project with no predicted docs -> run completes with zeros."""
    from app.services.evaluation_service import run_evaluation
    run = await run_evaluation(
        db_session, project_id=seed_project.id, user=seed_user, name="empty",
    )
    assert run.status == "completed"
    assert run.num_docs == 0
    assert run.num_fields_evaluated == 0
    assert run.num_matches == 0
    assert run.accuracy_avg == 0.0


@pytest.mark.asyncio
async def test_run_evaluation_persists_field_results(db_session, seed_project, seed_user):
    from app.services.evaluation_service import run_evaluation
    from app.models.evaluation_field_result import EvaluationFieldResult

    await _make_doc_with_predict_and_anns(
        db_session, seed_project, seed_user, "a.pdf",
        {"invoice_number": "INV-1"},
        [("invoice_number", "INV-1", "string")],
    )
    run = await run_evaluation(
        db_session, project_id=seed_project.id, user=seed_user, name="t",
    )
    rows = (await db_session.execute(
        select(EvaluationFieldResult).where(EvaluationFieldResult.run_id == run.id)
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].field_name == "invoice_number"
    assert rows[0].match_status == "exact"
    assert rows[0].document_filename == "a.pdf"

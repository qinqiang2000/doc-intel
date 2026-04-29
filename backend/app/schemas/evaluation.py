"""S4: Evaluation schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EvaluationRunCreate(BaseModel):
    name: str = Field(default="", max_length=200)


class EvaluationRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    prompt_version_id: str | None
    name: str
    num_docs: int
    num_fields_evaluated: int
    num_matches: int
    accuracy_avg: float
    status: str
    error_message: str | None
    created_by: str
    created_at: datetime


class EvaluationFieldResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    document_id: str | None
    document_filename: str
    field_name: str
    predicted_value: str | None
    expected_value: str | None
    match_status: str
    created_at: datetime


class EvaluationDetailRead(BaseModel):
    run: EvaluationRunRead
    fields: list[EvaluationFieldResultRead]

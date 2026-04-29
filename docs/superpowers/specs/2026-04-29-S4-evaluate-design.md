# S4 — Evaluate (batch field comparison + Excel export) (Design)

**Status**: spec.
**Predecessor**: `s3-complete` (372 tests, full prompt versioning + NL correction).
**Successor**: S5 (API publish — final sub-spec).

## 1. Goal

Let users measure prompt quality across a project's documents by comparing
each document's predict output (`ProcessingResult.structured_data`) against
its current annotations (the post-edit truth). Persist the result as a named
evaluation run, list history per project, and export per-run results to
Excel for sharing/audit.

This is the substance of the post-Tune step in the workflow: after iterating
on prompts (S3), users want a quantitative answer to "is this prompt better
than the last one?" S4 gives them that as accuracy %, a field-level summary,
and a downloadable spreadsheet.

## 2. Non-goals

- **API publishing (ApiCode + ApiKey)** — S5.
- **A/B prompt comparison in one run** — users can run two evaluations
  back-to-back after switching `active_prompt_version_id` and compare the
  numbers manually. The complexity of dual-prompt prediction in one run
  (~2× LLM cost, schema for two predicted values per row) is not justified.
- **Scheduled / continuous evaluation** — runs are user-triggered only.
- **Re-running predict during evaluation** — the evaluation reads cached
  `ProcessingResult.structured_data`. If a doc has no ProcessingResult, it's
  excluded from this run. (Users can predict it first, then re-run eval.)
- **Cross-run diff UI** — compare two runs side-by-side. Out of scope; users
  download both Excel files and diff externally.
- **Ground-truth markers on annotations or documents** — the annotations
  themselves are the GT (whatever the user has edited them to). No new
  `is_ground_truth` flags or sibling-doc pairing.
- **SSE progress streaming** — synchronous compute with a single round-trip.
  Sub-second on small projects, a few seconds on larger ones; doesn't need
  streaming.

## 3. Cross-spec references

- `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md` — completes
  the **batch evaluate (LS)** concept with a doc-intel-shaped data model.
- `doc-intel-legacy/backend/app/services/evaluate.py` — algorithm reference
  for `score_field` and Excel formatting.
- S2a `app/services/predict.py` — produces the `ProcessingResult.structured_data`
  this spec consumes.
- S2a `app/models/annotation.py` — annotations whose values are the
  per-field "expected" side of the comparison.

## 4. Architecture

```
backend/
├── app/
│   ├── models/
│   │   ├── evaluation_run.py          NEW
│   │   └── evaluation_field_result.py NEW
│   ├── schemas/
│   │   └── evaluation.py              NEW
│   ├── services/
│   │   ├── evaluation_service.py      NEW   (compute + persist)
│   │   └── evaluation_excel.py        NEW   (xlsx export via openpyxl)
│   ├── engine/
│   │   └── scoring.py                 NEW   (pure score_field helper)
│   └── api/v1/
│       └── evaluations.py             NEW   (5 endpoints)
└── alembic/versions/
    └── f2a8d4e6c5b1_s4_evaluations.py NEW

frontend/
├── src/
│   ├── stores/
│   │   └── predict-store.ts           MODIFY (4 actions + types)
│   ├── pages/
│   │   ├── EvaluatePage.tsx           NEW
│   │   ├── ProjectDocumentsPage.tsx   MODIFY (add 📊 button)
│   │   └── __tests__/
│   │       ├── EvaluatePage.test.tsx  NEW
│   │       └── ProjectDocumentsPage.test.tsx MODIFY (add nav test)
│   └── App.tsx                        MODIFY (add /evaluate route)
```

New backend dependency: `openpyxl` (≈5MB; MIT). No new frontend dependency.

The two new tables sit alongside `prompt_versions` (S3) under `Project`.
No changes to existing tables. Alembic migration `f2a8d4e6c5b1` with
`down_revision = 'e1b5c0d3f7a4'`.

## 5. Data model

### 5.1 EvaluationRun

```python
class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"
    id: str (uuid, primary key)
    project_id: str FK("projects.id", ondelete="CASCADE"), index=True
    prompt_version_id: str | None FK("prompt_versions.id", ondelete="SET NULL")
    name: str (varchar 200, default "")
    num_docs: int
    num_fields_evaluated: int
    num_matches: int
    accuracy_avg: float (0-1, computed = num_matches / num_fields_evaluated, 0 when denom=0)
    status: str (enum: "completed" | "failed", default "completed")
    error_message: str | None
    created_by: str FK("users.id")
    created_at: datetime (server_default now)
    deleted_at: datetime | None
```

### 5.2 EvaluationFieldResult

```python
class EvaluationFieldResult(Base):
    __tablename__ = "evaluation_field_results"
    id: str (uuid, primary key)
    run_id: str FK("evaluation_runs.id", ondelete="CASCADE"), index=True
    document_id: str | None FK("documents.id", ondelete="SET NULL")
    document_filename: str (varchar 255)  # snapshot
    field_name: str (varchar 200)
    predicted_value: str | None (TEXT)
    expected_value: str | None (TEXT)
    match_status: str (enum: "exact" | "fuzzy" | "mismatch" | "missing_pred" | "missing_expected")
    created_at: datetime (server_default now)
```

`document_id` is nullable + SET NULL: deleting a document doesn't cascade-delete
historical eval rows; `document_filename` snapshot keeps the UI useful.

`predicted_value` and `expected_value` are TEXT to handle JSON-stringified
arrays/dicts (e.g., `items: [...]`). Both nullable for `missing_*` cases.

### 5.3 Migration

`backend/alembic/versions/f2a8d4e6c5b1_s4_evaluations.py`:

```python
revision = 'f2a8d4e6c5b1'
down_revision = 'e1b5c0d3f7a4'

def upgrade():
    op.create_table('evaluation_runs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'),
                  index=True, nullable=False),
        sa.Column('prompt_version_id', sa.String(36),
                  sa.ForeignKey('prompt_versions.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('name', sa.String(200), nullable=False, server_default=''),
        sa.Column('num_docs', sa.Integer, nullable=False, server_default='0'),
        sa.Column('num_fields_evaluated', sa.Integer, nullable=False, server_default='0'),
        sa.Column('num_matches', sa.Integer, nullable=False, server_default='0'),
        sa.Column('accuracy_avg', sa.Float, nullable=False, server_default='0'),
        sa.Column('status', sa.String(20), nullable=False, server_default='completed'),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('created_by', sa.String(36),
                  sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime,
                  server_default=sa.func.now(), nullable=False),
        sa.Column('deleted_at', sa.DateTime, nullable=True),
    )
    op.create_table('evaluation_field_results',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('run_id', sa.String(36),
                  sa.ForeignKey('evaluation_runs.id', ondelete='CASCADE'),
                  index=True, nullable=False),
        sa.Column('document_id', sa.String(36),
                  sa.ForeignKey('documents.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('document_filename', sa.String(255), nullable=False),
        sa.Column('field_name', sa.String(200), nullable=False),
        sa.Column('predicted_value', sa.Text, nullable=True),
        sa.Column('expected_value', sa.Text, nullable=True),
        sa.Column('match_status', sa.String(30), nullable=False),
        sa.Column('created_at', sa.DateTime,
                  server_default=sa.func.now(), nullable=False),
    )

def downgrade():
    op.drop_table('evaluation_field_results')
    op.drop_table('evaluation_runs')
```

## 6. Comparison algorithm — `engine/scoring.py`

```python
import json
from typing import Any

MatchStatus = str  # "exact" | "fuzzy" | "mismatch" | "missing_pred" | "missing_expected"


def _normalize(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v, sort_keys=True, ensure_ascii=False)
    return str(v)


def score_field(
    predicted: Any, expected: Any, field_type: str = "string",
) -> MatchStatus:
    if predicted is None and expected is None:
        return "missing_expected"  # both empty: nothing to evaluate; classify as no-signal
    if predicted is None:
        return "missing_pred"
    if expected is None:
        return "missing_expected"

    p = _normalize(predicted)
    e = _normalize(expected)
    assert p is not None and e is not None

    p_str = p.strip()
    e_str = e.strip()

    if field_type == "number":
        try:
            if abs(float(p_str) - float(e_str)) < 1e-6:
                return "exact"
            return "mismatch"
        except ValueError:
            pass  # fall through to string compare

    if field_type == "date":
        try:
            from dateutil.parser import parse as _dp
            if _dp(p_str) == _dp(e_str):
                return "exact"
            return "mismatch"
        except Exception:
            pass

    if p_str == e_str:
        return "exact"
    if p_str.lower() == e_str.lower():
        return "fuzzy"
    return "mismatch"
```

**Accuracy denominator**: `num_fields_evaluated = exact + fuzzy + mismatch + missing_pred`. `missing_expected` rows (both sides empty) don't contribute to either numerator or denominator.

**Numerator**: `num_matches = exact + fuzzy`. Fuzzy matches count toward accuracy because case-only differences are typically not user-visible errors.

## 7. Per-doc field enumeration — `evaluation_service.py`

For each doc in the project (excluding soft-deleted):

```python
async def _enumerate_doc_fields(db, doc) -> list[FieldComparison]:
    # 1. Latest ProcessingResult for this doc
    pr = await fetch_latest_processing_result(db, doc.id)
    if pr is None:
        return []  # skip docs that haven't been predicted

    # 2. Annotations (latest per field_name by updated_at)
    anns = await fetch_annotations_for_doc(db, doc.id)
    expected_by_field: dict[str, Annotation] = {}
    for a in sorted(anns, key=lambda x: x.updated_at):
        expected_by_field[a.field_name] = a  # last write wins

    # 3. Flatten structured_data top-level keys
    sd: dict = pr.structured_data or {}
    predicted_by_field: dict[str, Any] = dict(sd)  # top-level only

    # 4. Compare union of keys
    all_fields = set(predicted_by_field) | set(expected_by_field)
    out: list[FieldComparison] = []
    for f in all_fields:
        predicted = predicted_by_field.get(f)
        ann = expected_by_field.get(f)
        expected = ann.field_value if ann else None
        ftype = (ann.field_type if ann else "string") or "string"
        status = score_field(predicted, expected, ftype)
        out.append(FieldComparison(
            field_name=f, predicted=predicted, expected=expected,
            status=status, document_id=doc.id, document_filename=doc.filename,
        ))
    return out
```

`structured_data` arrays/dicts are kept as-is in `predicted`; `score_field`
JSON-stringifies before string compare. Deep equality of nested objects is
intentional but uses `sort_keys=True` to ignore key ordering noise.

The service then:
- aggregates per `(doc, field)` into `EvaluationFieldResult` rows
- counts totals into the `EvaluationRun` row
- commits both in one transaction

## 8. Backend endpoints

### 8.1 POST /api/v1/projects/{pid}/evaluations
Request body: `{name?: string}` (default empty).
Response: 201 with `EvaluationRunRead` (run row + computed totals; does NOT
include the field results — caller follows up with GET detail if needed).

Synchronous compute. On any internal exception, the run row is still inserted
with `status="failed"` and `error_message`; client gets 201 with that row,
not 500. (This way the run history is never lost.)

### 8.2 GET /api/v1/projects/{pid}/evaluations
Returns `list[EvaluationRunRead]` ordered by `created_at DESC`. Excludes
soft-deleted. Excludes field results (summary list only).

### 8.3 GET /api/v1/evaluations/{rid}
Returns `{run: EvaluationRunRead, fields: list[EvaluationFieldResultRead]}`.
Access check: load run → verify caller is workspace member of run.project.

### 8.4 GET /api/v1/evaluations/{rid}/excel
Streams an .xlsx via `StreamingResponse(io.BytesIO, media_type="application/
vnd.openxmlformats-officedocument.spreadsheetml.sheet")` with
`Content-Disposition: attachment; filename="evaluation-{rid}.xlsx"`.

### 8.5 DELETE /api/v1/evaluations/{rid}
204. Soft-delete: `deleted_at = now()`. List endpoint excludes.

All endpoints require auth + workspace membership. Routes mounted at
`/api/v1/projects/{pid}/evaluations` (POST + GET) and
`/api/v1/evaluations/{rid}` (GET detail, DELETE, GET excel) — the second
group not nested for cleaner URLs.

## 9. Excel format — `evaluation_excel.py`

```python
def render_run_xlsx(run, field_results) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import PatternFill
    wb = Workbook()
    summary = wb.active
    summary.title = "Summary"
    detail = wb.create_sheet("Detail")
    # ... layout below
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
```

**Sheet 1 "Summary"**:
| field_name | exact | fuzzy | mismatch | missing_pred | missing_expected | accuracy |
|---|---|---|---|---|---|---|
| invoice_number | 8 | 0 | 1 | 0 | 0 | 0.889 |
| ... | ... | ... | ... | ... | ... | ... |
| **TOTAL** | 50 | 5 | 8 | 2 | 0 | **0.846** |

**Sheet 2 "Detail"**:
| filename | field_name | predicted | expected | status |
|---|---|---|---|---|
| alpha.pdf | invoice_number | "INV-001" | "INV-001" | exact |
| alpha.pdf | buyer_tax_id | "FI 123 456 789" | "FI123456789" | fuzzy |
| ... |

Status cell `PatternFill(fill_type="solid", fgColor=...)`:
- exact → light green `C6EFCE`
- fuzzy → light yellow `FFEB9C`
- mismatch → light red `FFC7CE`
- missing_pred → light gray `D9D9D9`
- missing_expected → white (no fill)

Column widths set so filename + field_name don't truncate in Excel default
view. Header row bold.

## 10. Frontend

### 10.1 predict-store增量

```ts
export interface EvaluationRun {
  id: string;
  project_id: string;
  prompt_version_id: string | null;
  name: string;
  num_docs: number;
  num_fields_evaluated: number;
  num_matches: number;
  accuracy_avg: number;
  status: "completed" | "failed";
  error_message: string | null;
  created_by: string;
  created_at: string;
}

export interface EvaluationFieldResult {
  id: string;
  run_id: string;
  document_id: string | null;
  document_filename: string;
  field_name: string;
  predicted_value: string | null;
  expected_value: string | null;
  match_status: "exact" | "fuzzy" | "mismatch" | "missing_pred" | "missing_expected";
  created_at: string;
}

// actions on PredictState
runEvaluation: (projectId: string, name?: string) => Promise<EvaluationRun>;
listEvaluations: (projectId: string) => Promise<EvaluationRun[]>;
getEvaluationDetail: (runId: string) => Promise<{ run: EvaluationRun; fields: EvaluationFieldResult[] }>;
deleteEvaluation: (runId: string) => Promise<void>;
downloadEvaluationExcel: (runId: string) => Promise<void>;
```

`downloadEvaluationExcel`: `axios.get(url, { responseType: "blob" })` → `URL.createObjectURL(blob)` → click anchor with `download` attr → revoke URL after a tick.

### 10.2 EvaluatePage

Route: `/workspaces/:slug/projects/:pid/evaluate`. Mounts under existing
`AppShell` like the workspace.

Layout:

```
┌──────────────────────────────────────────────────────────┐
│ ◀ Back to Project       📊 Evaluate · Project name      │
├──────────────────────────────────────────────────────────┤
│ [ Run Evaluation ]  hint: edit annotations first for     │
│                     meaningful accuracy                   │
├──────────────────────────────────────────────────────────┤
│ Run history                                               │
│ ┌────────────────────────────────────────────────────┐   │
│ │ 2026-04-29 14:30 · 78% · 8 docs · 56 fields  📥 🗑 │   │
│ │ 2026-04-29 13:10 · 65% · 8 docs · 50 fields  📥 🗑 │   │
│ │ ...                                                │   │
│ └────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────┤
│ Selected run detail (collapsed by default per row)       │
│  [Summary table] | [Detail table]                        │
└──────────────────────────────────────────────────────────┘
```

Behavior:
- Mount: GET list of evaluations
- Click `Run Evaluation`: POST → spinner → list refresh, new run auto-selected
- Click row: load detail; show summary + detail tables in a region below
- Click 📥 on any row: triggers `downloadEvaluationExcel`
- Click 🗑 on any row: confirm prompt → DELETE → list refresh
- Empty state: "No evaluations yet. Click Run Evaluation."

Detail tables: summary always rendered; detail table behind a `Show {N} per-field rows` collapsible (since it's potentially 100s of rows).

### 10.3 ProjectDocumentsPage modification

Add `📊 Evaluate` button next to existing `+ Batch Predict` and `▶ Next Unreviewed` buttons in the document toolbar. onClick → `navigate('/workspaces/${slug}/projects/${pid}/evaluate')`.

### 10.4 App.tsx route

Add inside the protected `<ProtectedRoute><AppShell /></ProtectedRoute>` block:

```tsx
<Route path="/workspaces/:slug/projects/:pid/evaluate" element={<EvaluatePage />} />
```

## 11. Error handling

- **No predicted docs**: run completes with `num_docs=0, accuracy_avg=0` and a hint in the UI ("This project has no predicted documents yet").
- **All annotations match all predicted fields trivially** (user hasn't edited yet): accuracy will be 100% with `fuzzy`/`exact` only. UI displays the percentage; the hint above the Run button warns users.
- **Service exception during compute**: row inserted with `status=failed`, `error_message=str(e)`. UI shows the run with red status badge and error tooltip.
- **Concurrent runs**: two simultaneous POSTs create two rows. Acceptable.
- **Excel for failed run**: returns 409 `evaluation_failed` (failed runs have no field_results to render). Or simpler: returns an empty xlsx with just the run metadata in summary header. Recommendation: 409, simpler.
- **Soft-deleted run accessed by id**: 404 `evaluation_not_found`.

## 12. Testing

| Layer | Component | New tests |
|---|---|---|
| Backend | EvaluationRun + FieldResult models | 4 (basic, FK SET NULL, soft-delete excluded, run cascade delete cascades to field_results) |
| Backend | scoring.score_field | 5 (exact / fuzzy / mismatch / missing / number+date types) |
| Backend | evaluation_service | 4 (compute basic, accuracy math, multi-doc, no-data project) |
| Backend | evaluations router | 5 (POST, GET list, GET detail, DELETE, GET excel headers/non-empty) |
| **Backend total** | | **18** |
| Frontend | predict-store | 4 (run, list, detail, download) |
| Frontend | EvaluatePage | 6 (empty state, run flow, history, detail expand, delete refresh, excel click) |
| Frontend | ProjectDocumentsPage | 1 (📊 button navigates) |
| Frontend | App routing | 1 (route mounted) |
| **Frontend total** | | **12** |
| **Grand total new** | | **30** |

After S4: backend ≥166 (148 + 18), frontend ≥236 (224 + 12), total ≥402.

(Plan-level test counts may differ slightly per task — these are spec-level estimates.)

## 13. Acceptance smoke (post-tag)

Real Gemini, alpha.pdf already predicted in S2b1/S2b2/S3 setup:

1. Login → project page; click `📊 Evaluate` → blank EvaluatePage
2. Click `Run Evaluation` → wait <2s → run row appears with 100% accuracy (no edits yet)
3. Open run detail → summary shows N fields all `exact`
4. Click 📥 → file `evaluation-{rid}.xlsx` downloads, opens in Excel/Numbers, has Summary + Detail sheets
5. Navigate to workspace → edit `buyer_tax_id` value → return to evaluate
6. Click `Run Evaluation` again → new run with accuracy < 100% (one mismatch)
7. Compare accuracy figures between runs
8. Click 🗑 on the older run → confirm → list shrinks
9. Reload page → list still shows the remaining run

## 14. Out of scope / known limitations

- **Top-level field flattening only**: nested objects (`buyer.name`) compared
  whole. If users want nested-level diff, they should structure their template
  flat (e.g., `buyer_name`).
- **No per-field weighting**: every field counts equally toward accuracy.
  For invoice extraction this is fine; users with critical-fields use cases
  can derive weighted scores from the Excel.
- **Excel formatting is minimal**: no charts, no conditional formatting beyond
  status colors. Keeps openpyxl usage simple.
- **Date parsing uses dateutil**: ambiguous formats ("01/02/2026") may parse
  differently in different locales. Acceptable for v1; users can normalize
  date strings in their prompts.
- **Stale runs**: deleting a document leaves orphaned `evaluation_field_results`
  rows with `document_id=NULL` but `document_filename` snapshot. UI shows the
  filename; the doc detail isn't reachable. Acceptable.

## 15. Estimated effort

≈19h:
- Backend models + alembic + service + scoring + tests: 8h
- Backend Excel export + tests: 3h
- Frontend store + EvaluatePage + tests: 6h
- ProjectDocumentsPage button + App route + smoke: 2h

Plan will break into ≈11 TDD tasks.

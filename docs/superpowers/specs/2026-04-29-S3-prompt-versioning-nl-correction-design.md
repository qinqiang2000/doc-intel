# S3 — Prompt Versioning + Natural-Language Correction (Design)

**Status**: spec.
**Predecessor**: `s2b2-complete` (322 tests, full interactive workspace).
**Successor**: S4 (Evaluate).

## 1. Goal

Make `Project.active_prompt` a versioned, editable, history-aware concept. Replace
the previously locked Tune step (step 4) with a real interactive surface:

- A **history drawer** shows every prompt version saved for the project, allows
  switching the active one, and supports deletion of inactive versions.
- An **AI correction console** lets users describe in natural language how the
  current prompt should change ("把 buyer_tax_id 只保留数字"), streams a revised
  prompt + a re-run predict result via SSE, and lets the user accept (save as new
  version + activate) or discard.

This is the substance of step 4 in the StepIndicator. It is the last UX milestone
before evaluation (S4) and API publishing (S5).

## 2. Non-goals

- **Evaluate (batch field-level diff)** — S4.
- **API publishing (ApiCode + ApiKey)** — S5.
- **Multi-user collaborative editing** of prompts (no realtime sync).
- **Versioned annotations / projects / documents** — only prompts get versioning in
  S3. Existing audit fields on Annotation (S2a) remain unchanged.
- **Diff with historical predict results** — Detailed/Grouped JSON modes (S2b2)
  already cover read-side; we don't render historical comparisons inside
  PromptHistoryPanel beyond the active vs proposed diff in the correction flow.
- **Conversation persistence** — every NL correction session is ephemeral. Only the
  final accepted prompt becomes a versioned row.

## 3. Cross-spec references

- `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md` — S3 completes
  **LS-3** (prompt override, started in S2b1's AdvancedPanel) by giving prompt
  changes a real persistence/version model. Closes the "active prompt" question
  the LS notes flagged.
- design-v2:
  - §7.10 NL correction wizard (general flow we follow)
  - §7.11 prompt history (drawer UX we implement)
- S2a `app/api/v1/predict.py` — SSE pattern for batch predict; we reuse the same
  `text/event-stream` + `event: foo\ndata: {...}\n\n` framing for the correction
  endpoint.

## 4. Architecture

```
WorkspacePage
├── WorkspaceToolbar           [add 📜 history button → opens PromptHistoryPanel]
├── StepIndicator              [step 4 Tune unlocked, click → opens NLCorrectionConsole]
├── three-column flex          [unchanged from S2b2]
├── PromptHistoryPanel (NEW)   right-side slide-over drawer (z-50)
│   └── lists PromptVersion[]; "+ Save current" + per-row Activate/Delete
└── NLCorrectionConsole (NEW)  bottom slide-up panel (z-50)
    ├── input area: textarea + optional "target field" selector
    ├── streaming pane: revised prompt diff + new predict result diff
    └── footer: Discard / Save as new version
```

Backend additions:

```
app/models/prompt_version.py       NEW    SQLAlchemy ORM
app/schemas/prompt_version.py      NEW    Pydantic IO
app/services/prompt_service.py     NEW    list/create/activate/delete
app/services/correction_service.py NEW    SSE async generator
app/api/v1/prompts.py              NEW    4 REST endpoints under /projects/{pid}/prompt-versions
app/api/v1/correction.py           NEW    1 SSE endpoint under /projects/{pid}/documents/{did}/correct
app/engine/prompt.py               MODIFY add async revise_prompt(original, user_message, target_field) → tokens
backend/alembic/versions/...       NEW    migration: prompt_versions table + projects.active_prompt_version_id col
app/models/project.py              MODIFY add active_prompt_version_id column + relationship
```

Frontend additions:

```
frontend/src/stores/predict-store.ts   MODIFY add 4 actions + state for streaming
frontend/src/lib/diff.ts               NEW    line-diff (no dep) + simple JSON shallow diff
frontend/src/lib/__tests__/diff.test.ts
frontend/src/components/workspace/
  PromptHistoryPanel.tsx               NEW
  __tests__/PromptHistoryPanel.test.tsx
  NLCorrectionConsole.tsx              NEW
  __tests__/NLCorrectionConsole.test.tsx
  StepIndicator.tsx                    MODIFY unlock step 4
  __tests__/StepIndicator.test.tsx     MODIFY adapt
frontend/src/pages/WorkspacePage.tsx   MODIFY mount the two panels
frontend/src/pages/__tests__/WorkspacePage.test.tsx MODIFY add wiring tests
```

No deletions. No changes to the bbox / annotation / JsonPreview pipelines.

## 5. Data model

### 5.1 PromptVersion

```python
class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    id: UUID = primary_key
    project_id: UUID = FK("projects.id", ondelete="CASCADE"), index=True
    version: int                          # per-project, monotonically increasing
    prompt_text: Text                     # full prompt body
    summary: str = "" max_length=200      # human label, e.g. "Tax-id digits-only"
    created_by: UUID = FK("users.id")
    created_at: datetime
    deleted_at: datetime | None = None    # soft delete; never destructive

    __table_args__ = (UniqueConstraint("project_id", "version"),)
```

`version` is computed server-side: `max(existing version) + 1` per project; first
save = 1.

### 5.2 Project additions

```python
class Project(Base):
    # existing fields unchanged
    active_prompt_version_id: UUID | None = FK("prompt_versions.id", ondelete="SET NULL")
```

`SET NULL` on delete: even if a version is hard-deleted (we don't, but defensive),
the column reverts to "use template default".

### 5.3 Active prompt resolution

When predicting, the prompt to send the LLM is resolved as:

1. If S2b1's AdvancedPanel passed `promptOverride` → use it (one-shot, not saved)
2. Else if `project.active_prompt_version_id` is set → use that version's `prompt_text`
3. Else → use template-default prompt (existing S1/S2a behavior)

Resolution lives in `predict_service.run_predict`; S3 adds a single helper
`resolve_prompt(project, override) -> str`.

### 5.4 Migration

One alembic revision:

```python
# Up
op.create_table(
    "prompt_versions",
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), index=True),
    sa.Column("version", sa.Integer(), nullable=False),
    sa.Column("prompt_text", sa.Text(), nullable=False),
    sa.Column("summary", sa.String(200), nullable=False, server_default=""),
    sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    sa.Column("deleted_at", sa.DateTime(), nullable=True),
    sa.UniqueConstraint("project_id", "version", name="uq_prompt_versions_project_version"),
)
op.add_column(
    "projects",
    sa.Column("active_prompt_version_id", sa.String(36), sa.ForeignKey("prompt_versions.id", ondelete="SET NULL"), nullable=True),
)

# Down
op.drop_column("projects", "active_prompt_version_id")
op.drop_table("prompt_versions")
```

## 6. Backend endpoints

All four sit under `/api/v1/projects/{project_id}` and follow the same auth +
workspace-membership check as existing `predict.py`.

### 6.1 GET /prompt-versions

Returns versions in `version DESC` order, soft-deleted excluded. Each row:

```json
{
  "id": "uuid",
  "version": 3,
  "summary": "Tax-id digits-only",
  "created_by": "uuid",
  "created_at": "iso",
  "is_active": true,
  "prompt_text": "..."
}
```

`prompt_text` IS included — UI inlines on click rather than fetching detail. Body
is short enough (< few KB) that this is fine.

### 6.2 POST /prompt-versions

Body: `{prompt_text: str, summary?: str}` → 201 → returns the new row (with
`is_active: false`). Server computes `version = max(existing) + 1`. Activation is
a separate step (PATCH below) — caller decides whether to also activate.

### 6.3 PATCH /active-prompt

Body: `{version_id: UUID | null}` → 200 → returns updated Project row.

If `version_id` non-null, validate it belongs to `project_id` and is not soft-
deleted. Null sets the column to null (revert to template default).

### 6.4 DELETE /prompt-versions/{vid}

204 on success. Refuses with 409 (`prompt_in_use`) if the version is currently
active. Soft-delete: sets `deleted_at = now()`. Subsequent GET excludes.

### 6.5 POST /documents/{did}/correct (SSE)

Content-Type: `text/event-stream`.

Body:
```json
{
  "user_message": "把 buyer_tax_id 只保留数字部分",
  "current_prompt": "...",
  "target_field": "buyer_tax_id"
}
```

`current_prompt` is what the front end currently considers active (lets the user
correct an in-flight unsaved prompt without server round-trip first).
`target_field` is optional context for the rewriter.

Events emitted (each as `event: NAME\ndata: JSON\n\n`):

| Event | Payload | Notes |
|---|---|---|
| `prompt_token` | `{"chunk": "..."}` | Streamed LLM tokens for the revised prompt; many emitted |
| `revised_prompt` | `{"prompt_text": "..."}` | After token stream completes; full assembled body |
| `predict_started` | `{}` | Phase 2: re-run predict with revised prompt |
| `predict_result` | `{"structured_data": ..., "annotations": [...]}` | Final result. Annotations preview only, NOT yet persisted to DB |
| `done` | `{}` | Stream complete |
| `error` | `{"code": "...", "message": "..."}` | Terminal; stream closes after |

Two-phase backend: phase 1 calls `engine.prompt.revise_prompt()` (an async
generator yielding tokens); phase 2 calls existing `predict_service.run_predict()`
with the revised prompt text but does NOT persist a ProcessingResult row (this
is a preview). The annotations list is the LLM's interpretation rendered into
Annotation-shaped JSON without DB writes.

The "no DB write" rule keeps the correction flow truly ephemeral — only the
explicit POST /prompt-versions persists state.

## 7. Engine: revise_prompt

`app/engine/prompt.py` adds:

```python
async def revise_prompt(
    *,
    original_prompt: str,
    user_message: str,
    target_field: str | None,
    processor_key: str,
) -> AsyncIterator[str]:
    """Stream tokens of a revised prompt. processor_key chooses which engine
    processor's chat method to use (gemini/openai/etc.)."""
```

Implementation: build a meta-system-prompt:

> You are a prompt engineer. The user is iterating on a document-extraction
> prompt. Given the ORIGINAL prompt, the user's REVISION REQUEST, and an
> optional TARGET FIELD, produce a revised prompt that incorporates the
> request. Keep the structure and field set; only change what's necessary.
> Output only the revised prompt body, no preamble.

Then call the processor's chat-stream method with system-instruction = meta and
user content = `f"ORIGINAL:\n{original_prompt}\n\nREVISION REQUEST:\n{user_message}\n\nTARGET FIELD: {target_field or 'unspecified'}"`. Yield tokens as they arrive.

Processor method needed: `chat_stream(system, user) -> AsyncIterator[str]`. Most
processors don't have this yet. Options:
- (a) Add `chat_stream` to base class, implement in gemini + openai
- (b) Buffer-only fallback: call non-streaming chat, then yield the full
      response as a single token (degrades UX from streaming to "one chunk")

Recommendation: **(a) for gemini + openai** (the realistic processors), **(b) as
fallback** for mock/piaozone. This keeps mock processors viable for tests.

### 7.1 Mock processor (used in tests)

`engine/processors/mock.py` adds a deterministic `chat_stream` that yields a
canned revised prompt in 3 chunks: `"REVISED: "`, then `user_message`, then
`" END"`. Lets backend SSE tests verify event ordering without LLM cost.

## 8. Frontend

### 8.1 predict-store增量

```ts
// state
promptVersions: PromptVersion[]      // last loaded; refreshed on save/activate/delete
correctionStream: {
  active: boolean,
  promptTokens: string[],            // accumulating
  revisedPrompt: string | null,      // assembled when prompt phase ends
  previewResult: ProcessingResult | null,
  error: string | null,
}

// actions
loadPromptVersions(pid)  → PromptVersion[]
saveAsNewVersion(pid, prompt_text, summary)  → PromptVersion
deletePromptVersion(pid, vid)  → void
setActivePrompt(pid, vid | null)  → Project
streamCorrection(pid, did, body, abortSignal?)  → Promise<void>
discardCorrection()  → void                      // resets correctionStream
```

`streamCorrection` uses existing `frontend/src/lib/sse.ts` (S2a). Each SSE event
type maps to a setState slice — cumulative tokens for `prompt_token`; full
`revisedPrompt`; full `previewResult`; `error` sets `error` and clears `active`.
On `done`, `active = false`.

### 8.2 Diff helpers

`frontend/src/lib/diff.ts`:

```ts
export interface LineDiff {
  oldLines: { line: string; status: "same" | "removed" }[];
  newLines: { line: string; status: "same" | "added" }[];
}

export function lineDiff(oldText: string, newText: string): LineDiff;

export interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  status: "added" | "removed" | "changed" | "unchanged";
}

export function fieldDiff(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): FieldDiff[];
```

Implementation: Myers-lite line diff (LCS-based) for `lineDiff`; recursive
shallow object diff for `fieldDiff` (top-level keys only, deep equality at leaf).

This is enough for the correction console UI; we don't ship a generic diff lib.

### 8.3 PromptHistoryPanel

Right-side slide-over (`fixed right-0 top-0 h-full w-[420px]`). Toggle visibility
via predict-store boolean `promptHistoryOpen` (new piece of state).

Layout (top-down):
- Header: "Prompt 历史" + close X
- "+ Save current as new version" CTA → opens summary input modal
- Scrollable list:
  - Each version card: `v{n}` badge, summary (gray italic if empty), created_at, "(active)" badge if active
  - Click card → expands inline to show full `prompt_text` (monospace)
  - Buttons in expanded row: `Set as active` (hidden if active) / `Delete` (disabled if active)
- Footer: "Use template default" button → calls setActivePrompt(pid, null)

Empty state: "尚无 prompt 版本（当前使用模板默认 prompt）"

### 8.4 NLCorrectionConsole

Bottom slide-up (`fixed left-0 right-0 bottom-0 h-[480px] z-50`). Toggle via
predict-store boolean `correctionConsoleOpen`.

Three regions stacked vertically:

1. **Input bar** (top, 80px):
   - Textarea: placeholder "用自然语言描述如何修改 prompt..."
   - "Target field" dropdown: shows annotations of current doc, defaults to
     selectedAnnotationId's field_name
   - Send button (disabled while `correctionStream.active`)

2. **Stream pane** (middle, scrollable):
   - While streaming `prompt_token`: live monospace display of accumulating tokens
     under heading "Revising prompt..."
   - After `revised_prompt`: line-diff view comparing current prompt → revised
   - After `predict_result`: side-by-side `fieldDiff` view comparing previous
     `result.structured_data` → preview
   - On `error`: red banner with the message

3. **Action bar** (bottom, 60px):
   - `Discard` (resets correctionStream)
   - `Save as new version` (opens summary input modal → calls saveAsNewVersion +
     setActivePrompt(pid, newVersion.id))
   - Both disabled until `revised_prompt` and `predict_result` both arrived OR
     stream ended in error.

### 8.5 StepIndicator Tune unlock

S2b2's StepIndicator had Tune (id=4) and GenerateAPI (id=5) marked locked. S3
unlocks Tune (id=4): remove from `LOCKED_STEPS`, append to `REACHABLE_STEPS`.
GenerateAPI stays locked → S5.

Click on step 4: opens NLCorrectionConsole (sets `correctionConsoleOpen = true`)
and sets `currentStep = 4`. The PromptHistoryPanel is opened/closed independently
via toolbar button (so users can review history without entering the correction
flow).

### 8.6 WorkspaceToolbar additions

Add 📜 button to the right of `▶ Next Unreviewed`, toggles
`promptHistoryOpen` in predict-store. No other layout change.

### 8.7 WorkspacePage wiring

- Mount `<PromptHistoryPanel />` and `<NLCorrectionConsole />` as siblings under
  the root `<div>` (after the three-column flex).
- Step auto-advance: clicking step 4 OR opening the correction console sets
  `currentStep = 4`. (Step 4 doesn't auto-advance from anywhere else.)
- After `Save as new version` succeeds, panel closes, history panel opens with
  the new version highlighted.

## 9. Error handling

- **SSE LLM error mid-stream**: emit `error` event, close stream. Frontend shows
  red banner; `Discard` clears state.
- **Network drop**: fetch reader rejects; treated as error.
- **Concurrent send**: second click while `correctionStream.active` is a noop.
  No queue — keep it simple; user can wait.
- **Save with empty summary**: allowed (summary defaults to ""). UI suggests "v3"
  as fallback display.
- **Delete active version**: server returns 409; UI shows toast "请先切换 active
  prompt 才能删除"; no client-side prevent (lets server be authoritative).
- **Concurrent edits across browser tabs**: last write wins. Out of scope to
  prevent.

## 10. Testing

| Layer | Component | New tests |
|---|---|---|
| Backend | PromptVersion model + svc | 6 (create, list, soft-delete, refuse-delete-active, activate, deactivate) |
| Backend | prompts router | 4 (list, create-201, patch-active, delete-204/409) |
| Backend | correction SSE service | 4 (mock processor: prompt tokens emit, revised assembled, predict_result emitted, error path) |
| Backend | correction route integration | 2 (auth, body validation) |
| Backend | predict_service resolve_prompt | 2 (active, override > active) |
| **Backend total** | | **18** |
| Frontend | predict-store | 4 (load/save/activate/stream) |
| Frontend | diff.ts | 5 (line-diff equal/added/removed; field-diff add/remove/change) |
| Frontend | PromptHistoryPanel | 5 (list render, expand, set-active, delete-disabled-when-active, save flow) |
| Frontend | NLCorrectionConsole | 7 (input enabled, stream ordering, prompt diff render, result diff render, save, discard, error banner) |
| Frontend | StepIndicator | 2 (Tune now reachable; click opens console) |
| Frontend | WorkspaceToolbar | 2 (history button toggles; tooltip) |
| Frontend | WorkspacePage wiring | 3 (Tune click flow, save flow integration, history toggle) |
| **Frontend total** | | **28** |
| **Grand total new** | | **46** |

Targets after S3:
- Backend: 126 → 144 (+18)
- Frontend: 196 → 224 (+28)
- Total: 322 → 368 (+46)

### 10.1 SSE testing notes

Backend: use `httpx.AsyncClient` with `stream=True` on the test client; iterate
events via `aiter_lines()` parsing `event:`/`data:` framing manually. Mock
processor's `chat_stream` is deterministic (3 chunks).

Frontend: mock the `fetch` global to return a `ReadableStream` controller; push
canned event lines and assert the store transitions through the expected slices.
This pattern already exists for batch-predict in S2a's tests; reuse the helper.

## 11. Acceptance smoke (post-tag)

Real Gemini, alpha.pdf already predicted (i.e., re-use S2b2 setup):

1. Login → workspace → alpha.pdf loaded
2. Click step 4 (Tune) — was locked, now clickable → bottom panel opens
3. Type `"把 buyer_tax_id 改成只保留数字"`; target_field auto-set to
   `buyer_tax_id`; click Send
4. Watch tokens stream into "Revising prompt..." box
5. After ~2-5s see "Revised prompt:" line-diff; original prompt's tax-id line
   highlighted red, new wording green
6. After 3-10s more see "Predict result:" panel; `buyer_tax_id` row shows the
   numeric-only value highlighted as changed
7. Click `Save as new version` → summary input modal → "tax-id digits only" → OK
8. Both panels close. Right history drawer opens (📜 button) showing v1 marked
   active. Re-running predict from elsewhere yields the new prompt's output
   (verify via JsonPreview)
9. Click "Use template default" in history → setActivePrompt null → toast
   confirms; future predicts use template default (verify by re-clicking step 1
   Preview button: `currentStep = 1`, doesn't trigger predict; instead manually
   click "Re-predict" in AdvancedPanel)

## 12. Out of scope / known limitations

- **Token cost**: each NL correction = 1 LLM call for revision + 1 for predict.
  No usage tracking in S3.
- **Prompt rollback**: switching active prompt is supported, but undoing a save
  (i.e., delete-then-reactivate) requires two clicks. No "undo" affordance.
- **Long prompts (>50KB)**: `prompt_text` column is `Text` (unbounded). Display
  in PromptHistoryPanel uses `whitespace-pre-wrap` + max-height; real users
  shouldn't hit this but no truncation policy is enforced.
- **Concurrent corrections** are rejected client-side; server's SSE endpoint
  doesn't lock per-document, so if two browser tabs send simultaneously both
  proceed, only the last save wins. Acceptable trade-off.

## 13. Estimated effort

≈22h:
- Backend (model, services, endpoints, tests): 7h
- Frontend store + diff helpers: 3h
- PromptHistoryPanel + Save flow: 4h
- NLCorrectionConsole + SSE consumption: 6h
- StepIndicator unlock + WorkspacePage wiring + smoke: 2h

Plan will break into ≈12-13 TDD tasks.

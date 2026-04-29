# S5 — API Publish (Design)

**Status**: spec.
**Predecessor**: `s4-complete` (404 tests, full evaluation pipeline).
**Successor**: none — this is the **final sub-spec**.

## 1. Goal

Let project owners "publish" a project as a one-call extraction API: a stable
public URL `/extract/{api_code}` that accepts a file upload, runs the project's
active prompt + processor, and returns the extracted structured data. Access
is gated by per-project API keys with bcrypt-hashed storage. This is the
substance of step 5 (GenerateAPI) in the StepIndicator.

After S5, the workflow is end-to-end: upload → predict → correct → tune (NL
correction) → format (JSON modes) → evaluate → **generate API**.

## 2. Non-goals

- **Rate limiting / quotas / billing** — public endpoint accepts unlimited
  authenticated calls; FastAPI-level middleware can be added later if needed.
- **API analytics / call history / latency dashboards** — never. Use server
  logs.
- **Webhooks / callbacks / async result delivery** — never. The endpoint is
  synchronous request/response.
- **Multiple API codes per project** — exactly one (the project owns it). Users
  who want multiple codes create multiple projects.
- **Key rotation as a single action** — YAGNI. Users delete the old key and
  create a new one (atomicity isn't critical for a low-frequency operation).
- **Cross-project key sharing** — keys are project-scoped.
- **Public OpenAPI doc generation customization** — FastAPI's auto `/docs`
  already exposes the public route; that's enough.
- **A/B testing different prompts via different api_codes** — see "multiple
  api codes" above.
- **Anonymous (no-key) public extraction** — every call must carry a valid key.

## 3. Cross-spec references

- `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md` — completes
  the **API publish** concept (LS-legacy ApiDefinition + ApiKey).
- `doc-intel-legacy/backend/app/services/api_def.py` — algorithm reference.
- `docs/superpowers/specs/2026-04-28-S2b2-workspace-interactive-design.md`
  §5.1 — StepIndicator step 5 was locked, S5 unlocks it.
- S2a `app/services/predict.py:predict_single` — public extract reuses this
  service to compute structured_data; `predict_service.resolve_prompt` (S3)
  honors `Project.active_prompt_version_id`.

## 4. Architecture

```
backend/
├── app/
│   ├── models/
│   │   ├── project.py          MODIFY (add api_code, api_published_at, api_disabled_at)
│   │   └── api_key.py          NEW
│   ├── schemas/
│   │   ├── project.py          MODIFY (expose api fields)
│   │   └── api_key.py          NEW
│   ├── services/
│   │   ├── api_publish_service.py  NEW (publish/unpublish + key gen + verify)
│   │   └── predict.py          (unchanged — reused)
│   └── api/v1/
│       ├── api_publish.py      NEW (5 authed endpoints)
│       └── extract_public.py   NEW (1 public endpoint, mounted under /extract not /api/v1)
└── alembic/versions/
    └── a3c7d9e2b4f5_s5_api_publish.py  NEW

frontend/
├── src/
│   ├── stores/predict-store.ts          MODIFY (5 actions + types)
│   ├── pages/
│   │   ├── PublishPage.tsx              NEW
│   │   ├── ProjectDocumentsPage.tsx     MODIFY (add 🔌 button)
│   │   └── __tests__/
│   │       ├── PublishPage.test.tsx     NEW
│   │       └── ProjectDocumentsPage.test.tsx  MODIFY
│   ├── components/workspace/
│   │   ├── StepIndicator.tsx            MODIFY (unlock step 5)
│   │   └── __tests__/StepIndicator.test.tsx  MODIFY
│   ├── App.tsx                          MODIFY (add /api route)
│   └── __tests__/App.test.tsx           MODIFY
```

New backend dependency: none. `bcrypt` is already in use (S0 password hashing).
New frontend dependency: none.

## 5. Data model

### 5.1 Project ALTER

Three new columns:

```python
api_code: Mapped[str | None] = mapped_column(
    String(60), unique=True, index=True, nullable=True,
)
api_published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
api_disabled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

`api_code` regex: `^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$` (3-60 chars, same as
slug). Once set, `api_code` is **immutable** — to change it the user must
delete and re-create the project. (This keeps public URLs stable for any key
holder; renaming would silently break callers.)

State machine derived from columns (no enum):

| api_code | api_disabled_at | State |
|---|---|---|
| NULL | — | `draft` |
| set | NULL | `published` |
| set | set | `disabled` |

Transitions:
- draft → published (`POST /publish` with new api_code; sets api_code, sets api_published_at)
- published → disabled (`POST /unpublish`; sets api_disabled_at)
- disabled → published (`POST /publish` again; clears api_disabled_at)

### 5.2 ApiKey (new table)

```python
class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"),
        index=True, nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    key_prefix: Mapped[str] = mapped_column(String(12), nullable=False)  # "dik_AbCdEfGh"
    key_hash: Mapped[str] = mapped_column(String(80), nullable=False)    # bcrypt
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

`key_prefix` stores the first 12 chars (`dik_<8 random chars>`) of the
generated key for display in lists; `key_hash` is the bcrypt hash of the full
key. The full plaintext key is never stored.

### 5.3 Migration `a3c7d9e2b4f5`

```python
revision = 'a3c7d9e2b4f5'
down_revision = 'f2a8d4e6c5b1'

def upgrade():
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('api_code', sa.String(60), nullable=True))
        batch_op.add_column(sa.Column('api_published_at', sa.DateTime, nullable=True))
        batch_op.add_column(sa.Column('api_disabled_at', sa.DateTime, nullable=True))
        batch_op.create_index(batch_op.f('ix_projects_api_code'), ['api_code'], unique=True)

    op.create_table('api_keys',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(120), nullable=False, server_default=''),
        sa.Column('key_prefix', sa.String(12), nullable=False),
        sa.Column('key_hash', sa.String(80), nullable=False),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('last_used_at', sa.DateTime, nullable=True),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('deleted_at', sa.DateTime, nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
    )
    with op.batch_alter_table('api_keys') as batch_op:
        batch_op.create_index(batch_op.f('ix_api_keys_project_id'), ['project_id'], unique=False)

def downgrade():
    with op.batch_alter_table('api_keys') as batch_op:
        batch_op.drop_index(batch_op.f('ix_api_keys_project_id'))
    op.drop_table('api_keys')
    with op.batch_alter_table('projects') as batch_op:
        batch_op.drop_index(batch_op.f('ix_projects_api_code'))
        batch_op.drop_column('api_disabled_at')
        batch_op.drop_column('api_published_at')
        batch_op.drop_column('api_code')
```

## 6. Key generation + verification

### 6.1 Generation

```python
import secrets
import bcrypt

def generate_api_key() -> tuple[str, str, str]:
    """Returns (full_plaintext_key, key_prefix_12_chars, bcrypt_hash)."""
    raw = secrets.token_urlsafe(32)            # ≈43 chars, URL-safe
    full = f"dik_{raw}"                         # ≈47 chars, "dik_" prefix marks our keys
    prefix = full[:12]                          # "dik_AbCdEfGh"
    hashed = bcrypt.hashpw(full.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")
    return full, prefix, hashed
```

`bcrypt.gensalt(rounds=10)` matches the rounds used for password hashing (S0).

### 6.2 Verification at /extract endpoint

```python
async def verify_api_key(db, project_id: str, presented_key: str) -> ApiKey | None:
    """Linear-scan project's active keys; return matching ApiKey or None."""
    stmt = select(ApiKey).where(
        ApiKey.project_id == project_id,
        ApiKey.is_active.is_(True),
        ApiKey.deleted_at.is_(None),
    )
    keys = (await db.execute(stmt)).scalars().all()
    for k in keys:
        if bcrypt.checkpw(presented_key.encode("utf-8"), k.key_hash.encode("utf-8")):
            return k
    return None
```

Linear scan is fine — projects rarely have more than a handful of keys.
Constant-time comparison is bcrypt's responsibility (`checkpw` is constant
time per hash; the linear scan adds at most O(n_keys) checks per request,
acceptable for n_keys < 100).

On match: update `k.last_used_at = now()` and commit.

### 6.3 Token format choice

Format: `dik_<43 url-safe base64>` (≈47 chars). Reasoning:
- `dik_` prefix mirrors GitHub's `ghp_` / Stripe's `sk_` convention — secret
  scanners can detect leaked keys.
- 32 bytes of entropy (`secrets.token_urlsafe(32)` = 256 bits) — well above
  brute-force feasibility.
- URL-safe alphabet — no escaping needed in cURL.

## 7. Backend endpoints

### 7.1 Authed routes (under `/api/v1/projects/{pid}`)

#### POST /publish

Body: `{api_code: string}`. Validates regex; checks uniqueness across all
projects (DB unique index will reject collisions). Transitions:

- If `api_code` is NULL: set `api_code = body.api_code`, `api_published_at = now()`.
- If `api_code` is set + `api_disabled_at` is set: clear `api_disabled_at` (re-publish from disabled). Body's `api_code` MUST equal current `api_code` or 400 `api_code_immutable`.
- If `api_code` is set + `api_disabled_at` is NULL: idempotent — body's `api_code` must match; otherwise 400.

Returns updated `ProjectRead` with new fields.

#### POST /unpublish

No body. Sets `api_disabled_at = now()`. Idempotent (re-call has no effect on
already-disabled). Returns ProjectRead.

#### GET /api-keys

Returns `list[ApiKeyRead]` excluding soft-deleted, ordered `created_at DESC`.
`ApiKeyRead` exposes: `id, name, key_prefix, is_active, last_used_at,
created_by, created_at`. Never `key_hash` or full key.

#### POST /api-keys

Body: `{name?: string}`. Generates key. Persists with `key_prefix + key_hash`.
Returns 201 `ApiKeyCreateResponse` = `{...ApiKeyRead, key: full_plaintext}`.
The full key appears ONLY in this response — the UI must surface it once and
discard.

#### DELETE /api-keys/{kid}

204 on success. Soft-delete (`deleted_at = now()`). Subsequent extract calls
with that key return 401 (because the verify query excludes soft-deleted).

### 7.2 Public route

Mounted at `/extract/{api_code}` (NOT under `/api/v1` — this is the
public-facing root).

#### POST /extract/{api_code}

Auth header: `X-Api-Key: dik_...`.
Body: `multipart/form-data` with `file` field.

Algorithm:
1. Look up Project by `api_code` (unique index); 404 if not found
2. If `api_disabled_at IS NOT NULL`: 403 `api_disabled`
3. Read X-Api-Key header (or `?api_key=` query as fallback); 401 `missing_api_key` if absent
4. Run `verify_api_key(db, project.id, header_value)`; 401 `invalid_api_key` if no match
5. Update matched key's `last_used_at = now()`
6. Save uploaded file via `storage.save_upload()` (existing S1 service)
7. Create Document row with `project_id=project.id, uploaded_by=key.created_by`
8. Call `predict_service.predict_single(db, document=doc, project=project, user=<load from key.created_by>)` — uses S3 `resolve_prompt` so the active prompt version applies
9. Return 200 `{document_id: doc.id, structured_data: pr.structured_data}`

Errors:
- 401: missing or invalid api_key
- 403: api disabled
- 404: api_code not found
- 413: file too large (`MAX_UPLOAD_SIZE` from settings, same as auth-side upload)
- 500: predict_service error

The public route does NOT return ProcessingResult version, prompt_used, etc.
— minimal payload by design. The auth'd UI can see those via the regular
project endpoints.

### 7.3 Why persist Documents from public calls

The public endpoint creates real Document + ProcessingResult rows. Trade-off:
- **Pro**: full audit trail; users can browse public-call docs in the
  workspace; reuse for fine-tuning data.
- **Con**: storage growth; "anonymous" docs cluttering the project view.

Mitigation: docs from public calls have `Document.uploaded_by = key.created_by`,
not a synthetic user. Workspace UI shows them naturally. If users want to
purge, they can delete the documents (existing S1 endpoint).

## 8. Frontend

### 8.1 predict-store增量

```ts
export interface ApiKey {
  id: string;
  project_id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_by: string;
  created_at: string;
}

export interface ApiKeyCreateResponse extends ApiKey {
  key: string;  // full plaintext, ONLY here
}

// actions on PredictState
publishApi: (projectId: string, apiCode: string) => Promise<{ id: string; api_code: string; api_published_at: string; api_disabled_at: string | null }>;
unpublishApi: (projectId: string) => Promise<{ id: string; api_disabled_at: string }>;
listApiKeys: (projectId: string) => Promise<ApiKey[]>;
createApiKey: (projectId: string, name: string) => Promise<ApiKeyCreateResponse>;
deleteApiKey: (projectId: string, keyId: string) => Promise<void>;
```

Store does NOT cache `ApiKeyCreateResponse.key` — caller (PublishPage modal)
holds it in component state until the user dismisses the modal.

### 8.2 PublishPage at `/workspaces/:slug/projects/:pid/api`

Layout:
```
┌────────────────────────────────────────────────┐
│ ◀ Back · 🔌 API for "{project.name}"          │
├────────────────────────────────────────────────┤
│ Status: [DRAFT|PUBLISHED|DISABLED] badge       │
│                                                 │
│ Draft state:                                    │
│  api_code: [_________ slug-style input]        │
│  [Publish]                                      │
│ Published state:                                │
│  api_code: receipts (immutable)                 │
│  Public URL: {API_BASE}/extract/receipts        │
│  [Unpublish]                                    │
│ Disabled state:                                 │
│  api_code: receipts                             │
│  [Re-Publish]                                   │
├────────────────────────────────────────────────┤
│ API Keys                          [+ New Key]  │
│ ┌──────────────────────────────────────────┐  │
│ │ dik_AbCdEfGh···  "production"  · 5m ago  │  │
│ │  🗑                                       │  │
│ └──────────────────────────────────────────┘  │
│ (empty state: "No keys. Create one to start") │
├────────────────────────────────────────────────┤
│ Try it (cURL):                                  │
│ curl -X POST "{API_BASE}/extract/{code}" \     │
│   -H "X-Api-Key: dik_..." \                    │
│   -F "file=@invoice.pdf"                        │
└────────────────────────────────────────────────┘
```

New-key modal flow:
1. Click `+ New Key`
2. Modal: input "Key name" (e.g. "production")
3. Submit → POST → response includes full key
4. Modal switches to "key revealed" view: monospace box with full key + Copy button + warning:
   > **This is the only time you'll see this key.** Store it safely; we cannot show it again.
5. User clicks `Done` → modal closes; list refreshes (new row with prefix)

Delete flow: click 🗑 → `confirm("Delete this API key?")` → DELETE → list refreshes.

### 8.3 StepIndicator step 5 unlock

`StepIndicator.tsx`:
- Move `{ id: 5, label: "GenerateAPI" }` from `LOCKED_STEPS` to `REACHABLE_STEPS`.
- `LOCKED_STEPS` becomes empty; remove the JSX loop or keep for forward compat (zero items renders nothing).
- Click on step 5 → navigate to PublishPage URL. The store's `currentStep` widens to `0|1|2|3|4|5`.

### 8.4 ProjectDocumentsPage 🔌 button

Add a `🔌 API` button next to the existing `📊 Evaluate` button (introduced in S4/T10). onClick → `navigate('/workspaces/${slug}/projects/${pid}/api')`.

### 8.5 App.tsx route

Add inside the protected `<ProtectedRoute><AppShell /></ProtectedRoute>` block:
```tsx
<Route path="/workspaces/:slug/projects/:pid/api" element={<PublishPage />} />
```

## 9. Error handling

| Scenario | HTTP status | Code | Notes |
|---|---|---|---|
| Authed POST /publish with bad regex | 400 | api_code_invalid | Pydantic validation |
| Authed POST /publish with taken api_code | 409 | api_code_taken | UNIQUE constraint |
| Authed POST /publish trying to change api_code | 400 | api_code_immutable | |
| Authed POST /api-keys before publish | 200 | (allowed) | keys can pre-exist publish |
| Public /extract: missing api_code | 404 | api_code_not_found | |
| Public /extract: disabled | 403 | api_disabled | |
| Public /extract: missing X-Api-Key | 401 | missing_api_key | |
| Public /extract: invalid X-Api-Key | 401 | invalid_api_key | |
| Public /extract: file too large | 413 | file_too_large | |
| Public /extract: predict failure | 500 | predict_failed | error_message hidden |

The public endpoint MUST NOT leak project identifiers in error messages. `api_code_not_found` and `invalid_api_key` are intentionally indistinguishable from a probing attacker's perspective: both return 404/401 without project details.

## 10. Testing

| Layer | Component | New tests |
|---|---|---|
| Backend | Project ALTER + ApiKey model | 4 (project new fields, key insert, soft-delete excluded, FK CASCADE on project delete) |
| Backend | api_publish_service | 4 (publish state transitions, re-publish from disabled, key gen produces dik_ prefix, bcrypt verify) |
| Backend | authed router | 5 (POST publish 200 + 409 conflict + 400 immutable, POST unpublish, GET keys list, POST key returns full + DELETE 204) |
| Backend | extract router | 3 (happy path with mock processor, 401 invalid key, 403 disabled) |
| Backend | predict_service smoke for api-key path | 2 (uploaded_by attribution; resolve_prompt honors active version) |
| **Backend total** | | **18** |
| Frontend | predict-store | 5 (publish, unpublish, list, create with full key, delete) |
| Frontend | PublishPage | 4 (draft state UI, published state UI, new key modal flow, delete flow) |
| Frontend | StepIndicator | 1 (GenerateAPI now reachable) |
| Frontend | ProjectDocumentsPage | 1 (🔌 button navigates) |
| Frontend | App routing | 1 (/api mounts PublishPage) |
| **Frontend total** | | **12** |
| **Grand total** | | **30** |

After S5: backend ≥184 (166 + 18), frontend ≥250 (238 + 12), total ≥434.

## 11. Acceptance smoke (post-tag)

Real Gemini, alpha.pdf already in a project:

1. Login → project page → click `🔌 API` → PublishPage shows "Draft"
2. Type api_code "receipts" → click Publish → status "Published" + Public URL shown
3. Click `+ New Key` → name "production" → modal shows full key once
4. Copy the full key from modal → click Done → modal closes; list shows prefix
5. cURL with the key:
   ```bash
   curl -X POST "http://127.0.0.1:8000/extract/receipts" \
     -H "X-Api-Key: dik_..." \
     -F "file=@alpha.pdf"
   ```
6. Verify response: `{"document_id": "...", "structured_data": {...}}` — real Gemini extraction
7. Click `Unpublish` → status "Disabled"; same cURL → 403 `api_disabled`
8. Click `Re-Publish` → status "Published"; cURL works again
9. Click 🗑 on the key → DELETE; cURL → 401 `invalid_api_key`
10. Click step 5 (GenerateAPI) in StepIndicator (now unlocked) from inside a workspace → navigates to /api page

## 12. Out of scope / known limitations

- **Public endpoint persists Documents under api_key.created_by** — workspace
  view will show these alongside user-uploaded docs. Mitigation: filter
  workspace by upload source if needed in S2c (out of scope).
- **No call-rate metering** — accidental loops or abuse can balloon LLM
  spend. Users own their api_code distribution.
- **Linear scan over project's API keys per request** — fine for n_keys < 100;
  becomes O(n × bcrypt_cost) at higher counts. Hashing prefix as an index
  could be added later if needed.
- **No CORS for the public endpoint** — designed for server-to-server cURL.
  Browser callers from different origins need a proxy. Acceptable.
- **Public endpoint inherits backend's MAX_UPLOAD_SIZE** — currently 50 MB.
  Same limit as authed upload.
- **Failed extract calls bill against LLM** — the predict happens before
  response. If the LLM returns garbage we return whatever it produced. No
  retry, no quality gate.

## 13. Estimated effort

≈20h:
- Backend models + alembic + service: 4h
- Backend authed router + tests: 3h
- Public extract endpoint + auth + tests: 4h
- Frontend store + PublishPage + tests: 6h
- StepIndicator unlock + nav button + App route: 1h
- E2E smoke + tag: 2h

Plan will break into ≈11 TDD tasks.

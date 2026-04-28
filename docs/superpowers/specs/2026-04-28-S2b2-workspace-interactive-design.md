# S2b2 — Workspace Interactive Polish (Design)

**Status**: spec.
**Predecessor**: `s2b1-complete` (284 tests, three-column static rendering).
**Successor**: S3 (Prompt Versioning + NL Correction).

## 1. Goal

Make the three-column workspace interactive: surface the 6-step progress, let users
adjust bounding boxes (drag, resize, create), switch JSON output formats, and have
column A and column B selection mirror each other.

This is the second half of S2b. S2b1 produced the static composition; S2b2 adds the
pointer-driven editing affordances design-v2 calls for.

## 2. Non-goals

- **Tune step (4)** UI — gated; drives users to "S3 coming soon" placeholder.
- **GenerateAPI step (5)** UI — gated; drives users to "S5 coming soon" placeholder.
- **New backend endpoints** — drag/resize/create persist via existing
  `POST /api/v1/documents/{id}/annotations`, `PATCH /api/v1/documents/{id}/annotations/{aid}`,
  `DELETE /api/v1/documents/{id}/annotations/{aid}` (all available since S2a).
- **Multi-user collaboration** (no realtime sync, no awareness cursors).
- **Schema-aware field-type validation** beyond what AnnotationEditor already does.
- **Prompt versioning, evaluate, API publish** — separate sub-specs.

## 3. Cross-spec references

- LS-features mapping: `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`.
  S2b2 fully realizes:
  - **LS-2** (bbox edit) — drag + resize + create.
  - **LS-9** (workspace state machine UI) — StepIndicator.
- design-v2 for invoice extraction:
  - §7.6 three-column workspace (S2b1 already covers static composition).
  - §7.7 step indicator.
  - §7.8 JSON format toggle.

## 4. Architecture

Pure frontend changes. predict-store fields `currentStep`, `apiFormat`,
`selectedAnnotationId` (added in S2b1/T1) are wired to UI. One backend touch:
none.

```
WorkspacePage (already exists)
├── WorkspaceToolbar (S2b1)                  unchanged
├── StepIndicator (NEW)                       reads currentStep, dispatches setStep
└── three-column flex
    ├── A column
    │   ├── AdvancedPanel (S2b1)              unchanged
    │   └── DocumentCanvas (REFACTORED)       per-page render-prop overlay
    │         └── BboxOverlay (UPGRADED)      drag, resize, rubber-band create
    ├── B column
    │   └── AnnotationEditor (UPGRADED)       selected highlight + scroll-into-view
    └── C column
        └── JsonPreview (UPGRADED)            toggle bar + 3 format transformers
```

Touched files:

| Path | Change |
|---|---|
| `frontend/src/components/workspace/StepIndicator.tsx` | NEW — 6-step bar |
| `frontend/src/components/workspace/__tests__/StepIndicator.test.tsx` | NEW |
| `frontend/src/components/workspace/DocumentCanvas.tsx` | refactor `children` slot → render-prop `renderOverlay(pageNumber, pageRect)` |
| `frontend/src/components/workspace/__tests__/DocumentCanvas.test.tsx` | update for new prop shape |
| `frontend/src/components/workspace/BboxOverlay.tsx` | drag/resize/create + 8 handles |
| `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx` | append interaction tests |
| `frontend/src/components/workspace/JsonPreview.tsx` | toggle bar + transformers |
| `frontend/src/components/workspace/__tests__/JsonPreview.test.tsx` | append format tests |
| `frontend/src/lib/json-formats.ts` | NEW — `flat / detailed / grouped` pure transformers |
| `frontend/src/lib/__tests__/json-formats.test.ts` | NEW |
| `frontend/src/components/predict/AnnotationEditor.tsx` | read `selectedAnnotationId`, highlight + scroll |
| `frontend/src/components/predict/__tests__/AnnotationEditor.test.tsx` | append sync tests |
| `frontend/src/pages/WorkspacePage.tsx` | mount StepIndicator; pass annotations array's `mime_type` aware page rendering through |
| `frontend/src/pages/__tests__/WorkspacePage.test.tsx` | append step-advance assertions |

No backend or DB changes.

## 5. Component specs

### 5.1 StepIndicator

```tsx
interface Step { id: 0|1|2|3|4|5; label: string; locked: boolean; }
const STEPS: Step[] = [
  { id: 0, label: "Upload",      locked: false },
  { id: 1, label: "Preview",     locked: false },
  { id: 2, label: "Correct",     locked: false },
  { id: 3, label: "ApiFormat",   locked: false },
  { id: 4, label: "Tune",        locked: true  }, // → S3
  { id: 5, label: "GenerateAPI", locked: true  }, // → S5
];
```

Render: horizontal pill row in a sticky band below `WorkspaceToolbar`. Each step is a
button with three visual states:

- **completed** (id < currentStep): filled bg, white text.
- **current** (id === currentStep): bordered, indigo accent.
- **upcoming reachable** (id > currentStep, !locked): muted bg, gray text.
- **locked** (id > currentStep, locked): same as upcoming reachable + 🔒 icon, `disabled`.

Click handler:

- locked → noop.
- reached or upcoming-reachable → `setStep(id)`.
- No URL change. State lives in predict-store only.

Step auto-advance hooks (lifted into `WorkspacePage` via simple effects):

| Trigger | New step |
|---|---|
| First result loaded for `docId` and `currentStep === 0 \|\| 1` | `setStep(1)` |
| User-driven annotation patch/delete/add (any) | `setStep(2)` |
| `apiFormat` changes from `"flat"` to anything else | `setStep(3)` |

Auto-advance never *decreases* current step. Manual click can move any direction
within reached range.

### 5.2 DocumentCanvas refactor (per-page render-prop)

S2b1's API: `<DocumentCanvas previewUrl mimeType filename>{children}</DocumentCanvas>`
where `children` was rendered once after all pages.

S2b2 adds an alternative API for the PDF case:

```tsx
interface Props {
  previewUrl: string;
  mimeType: string;
  filename: string;
  // For images: a single overlay positioned over the <img>.
  overlay?: React.ReactNode;
  // For PDFs: render one overlay per page, positioned over that page's canvas.
  renderPageOverlay?: (pageNumber: number, pageRect: DOMRect) => React.ReactNode;
}
```

Backwards compatibility: keep `children` slot as deprecated alias of `overlay`. The
S2b2 implementation phases this in by replacing `children` usage in WorkspacePage
with `overlay` (image) and `renderPageOverlay` (PDF) — but the `children` prop stays
around for image branch use until it's all swapped.

PDF rendering loop:

```tsx
{Array.from({ length: numPages || 1 }, (_, i) => (
  <PageWithOverlay
    key={i}
    pageNumber={i + 1}
    renderOverlay={renderPageOverlay}
  />
))}
```

`PageWithOverlay`:

- Wraps react-pdf `<Page>` and absolutely-positions a `<div>` matching the page's
  rendered canvas size (use a ref + ResizeObserver to track DOMRect).
- Calls `renderPageOverlay(pageNumber, pageRect)` and renders the result inside.

This makes BboxOverlay drag math correct for multi-page PDFs.

### 5.3 BboxOverlay (writable)

New props:

```tsx
interface Props {
  pageNumber?: number;                // 1-based; undefined = image (single page=0)
  pageRect: DOMRect;                  // pixel bounds of containing page
  annotations: Annotation[];          // S2b1 (caller filters by page)
  selectedAnnotationId: string | null;
  onSelect: (id: string | null) => void;
  onPatchBbox: (id: string, bbox: BoundingBox) => Promise<void>;
  onCreateBbox: (bbox: BoundingBox, fieldName: string) => Promise<void>;
}
type BoundingBox = { x: number; y: number; w: number; h: number; page: number };
```

Caller (WorkspacePage) filters `annotations` so each per-page overlay only sees its
own annotations (`a.bounding_box?.page === pageNumber - 1`, with `pageNumber - 1`
because S2a stores pages as 0-indexed).

Behaviors:

- **Hover** any bbox → cursor `move`, light highlight.
- **Click** a bbox → `onSelect(id)` + show 8 resize handles on that bbox only.
- **Click empty area** → `onSelect(null)`.
- **Drag** a selected bbox body → updates local pixel position; on pointer-up,
  computes normalized `{x, y, w, h, page}` (page = `pageNumber - 1`) and calls
  `onPatchBbox(id, bbox)`.
- **Drag** a corner/side handle → resizes; on pointer-up, same `onPatchBbox` call.
- **Drag** on empty area (rubber-band):
  - On pointer-down on empty area, capture origin.
  - On pointer-move, draw indigo dashed rectangle.
  - On pointer-up:
    - If `w * h < 0.0005 * pageW * pageH` (i.e. < 0.05% page area) → cancel.
    - Else show floating "字段名" input anchored at the box. Enter →
      `onCreateBbox(bbox, name)`; Esc or click-outside → cancel.

Coordinate math (drag body):

```ts
// deltaPx = current - originPx
const newX = origBboxFraction.x + deltaPx.x / pageRect.width;
const newY = origBboxFraction.y + deltaPx.y / pageRect.height;
// clamp to [0, 1 - w] / [0, 1 - h]
```

Handles (resize): each of the 8 handles maps to an `(anchorCorner, axes)` pair, e.g.
SE handle anchors NW, scales both x and y. Standard pattern. Math:

```ts
// SE handle, dragging by deltaPx:
const newW = origBbox.w + deltaPx.x / pageRect.width;
const newH = origBbox.h + deltaPx.y / pageRect.height;
// clamp newW, newH ≥ 0.005 (0.5% min)
// origin (x, y) unchanged
```

Pointer events use `setPointerCapture` so dragging outside the overlay still tracks
correctly.

Optimistic local update: while dragging, compute and apply pixel position directly
(no store round-trip per frame). On pointer-up, the single `onPatchBbox` call
reconciles backend; failure reverts to pre-drag fraction (parent component's
responsibility, surfaced via promise rejection from `patchAnnotation`).

### 5.4 JSON format transformers

`frontend/src/lib/json-formats.ts`:

```ts
import type { Annotation } from "../stores/predict-store";

type Format = "flat" | "detailed" | "grouped";

interface Args {
  structuredData: Record<string, unknown> | null;
  annotations: Annotation[];
}

export function transform(format: Format, args: Args): unknown { ... }
```

Behavior per format:

**flat**: returns `args.structuredData` as-is. (JsonPreview formats with `JSON.stringify`.)

**detailed**: replaces every leaf scalar / nested object/array's leaves with
`{ value, confidence, bbox }`, drawn from the annotations table by exact `field_name`
match. Algorithm:

```
function detailify(node, path):
  if node is array → node.map((el, i) => detailify(el, [...path, i]))
  if node is object → { ...node mapped: detailify(node[k], [...path, k]) }
  else → look up annotation where field_name === path.join(".") (or last segment for arrays);
         return { value: node, confidence: ann?.confidence ?? null, bbox: ann?.bounding_box ?? null }
```

Field-name lookup uses the annotation whose `field_name` matches the dotted path, falling
back to the last segment if no exact match. Items inside arrays match `field_name === "items"`
once and are not deepened (avoid combinatorial blow-up).

**grouped**: heuristic by prefix on top-level keys of `structured_data`:

| Prefix in field name | Group |
|---|---|
| `buyer_*` | `buyer: { ... }` |
| `seller_*` | `seller: { ... }` |
| `items` (any value type) | `line_items: <kept as-is>` |
| anything else | `meta: { ... }` |

Within each group, the `_<suffix>` part becomes the inner key (e.g.
`buyer_name` → `buyer.name`). For non-invoice templates the heuristic keeps everything
under `meta` rather than mis-grouping (acceptable, calling out in spec).

These transformers are pure functions — fully unit-testable without React.

### 5.5 JsonPreview toggle bar

New prop: `annotations: Annotation[]` (used by detailed mode).

Header layout:

```
[ STRUCTURED DATA · v2 ]              [ Flat | Detailed | Grouped ]
```

Three buttons. Active button has indigo background. Click → calls
`setApiFormat(format)` from predict-store. Body re-renders by calling
`transform(format, { structuredData, annotations })` and `JSON.stringify(out, null, 2)`.

Side effect (lifted to WorkspacePage effect): when `apiFormat !== "flat"` and
`currentStep < 3`, advance to step 3.

### 5.6 AnnotationEditor sync

Currently a presentational component receiving `annotations`, `onPatch`, etc. S2b2
adds:

- subscribe to `selectedAnnotationId` from predict-store.
- when selected, the matching `<li>` (or row) gets `border-2 border-[#6366f1]` and
  calls `scrollIntoView({ behavior: "smooth", block: "nearest" })` once on the
  selection change.
- clicking the row body calls `setSelectedAnnotationId(a.id)`.
- existing edit-input clicks must NOT trigger row selection changes — use
  `e.stopPropagation()` on input/select wrappers.

The component's existing prop interface is unchanged; the new behaviors come from
direct store subscription. WorkspacePage's wiring stays the same.

### 5.7 WorkspacePage updates

- Mount `<StepIndicator />` between `<WorkspaceToolbar />` and the three-column flex.
- Replace `<DocumentCanvas><BboxOverlay /></DocumentCanvas>` with two branches:
  - Image: pass `overlay={<BboxOverlay pageRect={imgRect} pageNumber={1} ... />}`.
    A single image gets a single overlay; needs an imgRect ref + ResizeObserver
    similar to PageWithOverlay, OR (simpler) BboxOverlay computes its own rect
    from a ref to its parent.
  - PDF: pass `renderPageOverlay={(p, r) => <BboxOverlay pageNumber={p} pageRect={r}
    annotations={anns.filter(a => a.bounding_box?.page === p-1)} ... />}`
- Add three step-advance effects (per §5.1 table).
- Provide `onPatchBbox` and `onCreateBbox` handlers that call existing
  `patchAnnotation` and `addAnnotation` store actions; on success, refresh local
  annotations array. On failure, throw — BboxOverlay logs.

## 6. Data model (no changes)

S2a's `Annotation.bounding_box: Record<string, number> | null` shape is preserved
({ x, y, w, h, page }, all 0-1 except page which is 0-indexed integer). Existing
PATCH handler accepts the partial update. No alembic migration needed.

## 7. Error handling

- **PATCH / POST failure during bbox drag**: BboxOverlay catches the rejected
  promise, logs to console, and (since the parent stores `annotations` in local
  state) the parent's local state remains the optimistic post-drag value. To recover
  the truth, user can refresh or click "Reload annotations" — leave reload UI for
  S3 polish. For S2b2, just `console.error` and revert state on the next prop pass
  by re-reading from predict-store. Acceptable trade-off; not a data-loss bug.
- **Invalid bbox coordinates** (e.g., negative w/h after clamp escape): clamp at
  call sites; assert in tests.
- **Unsupported file type for create-bbox**: only PDF + image branches show
  BboxOverlay; unsupported placeholder branch never mounts BboxOverlay (S2b1 already
  enforced this).

## 8. Testing

| Component | New tests | Total target |
|---|---|---|
| StepIndicator | 4 | 4 |
| BboxOverlay (interaction) | 12 | 5 (S2b1) + 12 = 17 |
| DocumentCanvas (refactor) | 2 (renderPageOverlay branch) | 4 (S2b1) + 2 = 6 |
| JSON format transformers | 8 | 8 |
| JsonPreview (toggle UI) | 4 | 2 (S2b1) + 4 = 6 |
| AnnotationEditor (sync) | 4 | (existing) + 4 |
| WorkspacePage (step advance) | 3 | 8 (S2b1) + 3 = 11 |
| **Total new** | **37** | **frontend ≥ 195 (158 + 37)** |

Backend test count unchanged at 126.

Strict TDD pattern continues: every new test must be written failing first, captured
RED, then implementation lands GREEN. Plan-level RED→GREEN gates apply per task.

### 8.1 Bbox interaction test mechanics

Pointer events in jsdom: use `fireEvent.pointerDown / pointerMove / pointerUp` with
`clientX/clientY`. The component computes from `pageRect` (passed as prop in tests
via a stub DOMRect-shaped object). No real layout needed — the math is purely
arithmetic on the prop. This keeps tests fast and deterministic.

Drag-end persistence: spy on a mock `onPatchBbox` prop and assert it was called
once with the expected normalized fractions (within 0.001 epsilon for floating-point).

Rubber-band create: simulate pointerDown on empty area → pointerMove → pointerUp,
verify the inline name input appears, type a name, press Enter, assert
`onCreateBbox` called with new bbox.

### 8.2 JSON format unit tests

Tests live in `frontend/src/lib/__tests__/json-formats.test.ts` and cover:

- **flat**: passthrough (returns reference equal to input).
- **detailed**:
  - leaf scalar with annotation → `{ value, confidence, bbox }`.
  - leaf scalar without matching annotation → `{ value, confidence: null, bbox: null }`.
  - nested object recurses.
  - top-level `items` array is preserved (no deep detailify on items).
- **grouped**:
  - all 4 prefix categories with synthetic data.
  - empty input → `{ meta: {} }`.
  - non-invoice template (no buyer/seller fields) → `{ meta: { ... } }`.

## 9. Out of scope (recap)

- Tune (S3) and GenerateAPI (S5) actual UIs.
- Backend changes.
- Multi-user editing.
- Bbox vector-snapping or grid alignment.
- Field-type-aware grouped heuristic (good-enough for invoices; templates with
  different shapes will land all under `meta`).
- Save-draft / revert-bbox-to-server toolbar — recovering from PATCH failure relies
  on full reload, which is acceptable for S2b2.

## 10. Open issues

None blocking. Two paragraphs of attention items, all explicitly out of scope:

- The **grouped heuristic** is invoice-tuned. When S3 adds template-aware grouping,
  this transformer should accept a `template_key` arg and dispatch.
- **Drag-failure recovery** uses console + manual reload. A toast + "revert" button
  would be polish; deferred to S3 or to a UX-polish backlog item.

## 11. Acceptance smoke (post-tag)

Manual browser walk after `s2b2-complete` tagging:

1. Login → workspace → select alpha.pdf.
2. Wait for predict, verify three columns + StepIndicator showing step 1.
3. Click an existing bbox → 8 resize handles appear on it.
4. Drag the body 50px to the right → mouse-up → PATCH fires → bbox stays at new
   position.
5. Drag SE handle to enlarge → PATCH fires → bbox grows; JSON `bbox` reflects
   new w/h in detailed mode.
6. Verify StepIndicator advanced to step 2 (Correct).
7. Drag rubber-band on empty area → "字段名" input appears → type "test_field" →
   Enter → new annotation appears in B column with empty value, in A column with
   the new bbox highlighted.
8. Click a row in B column → bbox in A column highlights.
9. Toggle JSON to Detailed → see `{ value, confidence, bbox }` per field.
10. Toggle to Grouped → see `buyer/seller/line_items/meta` partition.
11. Verify StepIndicator now at step 3 (ApiFormat).
12. Multi-page check: switch to a multi-page PDF (if available in fixtures) →
    bbox on page 2 drag works correctly relative to that page's rect, not the
    whole document.

If steps 1-11 pass, tag `s2b2-complete`. Step 12 is contingent on multi-page PDF
fixture; can be deferred to S3 if no fixture exists.

## 12. Estimated effort

≈ 20h (StepIndicator 3h, DocumentCanvas refactor 2h, BboxOverlay drag/resize/create
10h, JSON formats + JsonPreview UI 4h, AnnotationEditor sync 1h, WorkspacePage
wiring + smoke 0h covered by integration). Plan will break into 8-10 TDD tasks.

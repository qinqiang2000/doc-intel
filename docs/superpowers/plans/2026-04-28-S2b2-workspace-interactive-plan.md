# S2b2 — Workspace Interactive Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **TDD is mandatory** — every code unit must have its failing test written first, observed RED, then GREEN.

**Goal:** Make the S2b1 three-column workspace interactive: 6-step indicator, writable BboxOverlay (drag/resize/create), JSON format toggle (flat/detailed/grouped), and B-column ↔ A-column selection sync.

**Architecture:** Pure frontend changes. predict-store fields `currentStep`, `apiFormat`, `selectedAnnotationId` (added in S2b1/T1) get wired to UI. DocumentCanvas refactors `children` slot into `renderPageOverlay(pageNumber, pageRect)` so each PDF page owns its own overlay (fixes multi-page bbox positioning). Pure transformer module `frontend/src/lib/json-formats.ts` handles the 3 JSON shapes. Bbox interactions use native pointer events (no new dep). All persistence goes through existing predict-store actions (`patchAnnotation`, `addAnnotation`).

**Tech Stack:** Vite 8 + React 19 + Zustand + react-router 6 + react-pdf 9 + axios + vitest + RTL + native pointer events.

**Spec:** `docs/superpowers/specs/2026-04-28-S2b2-workspace-interactive-design.md`
**LS-features cross-spec:** `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md` — completes **LS-2** (bbox edit) and **LS-9** (workspace state machine UI).
**Repo root:** `/Users/qinqiang02/colab/codespace/ai/doc-intel/`
**Baseline:** tag `s2b1-complete` (126 backend + 158 frontend = 284 tests).
**Target:** ≥126 backend (unchanged) + ≥195 frontend = ≥321 tests.

---

## Test infrastructure note (read once before any pointer-event task)

jsdom does not implement `setPointerCapture` / `releasePointerCapture` natively. The
BboxOverlay code calls these for proper drag tracking. Add the polyfill **once** in
the existing test setup file. Locate it:

```bash
grep -rn "setupFiles" /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend/vitest.config.* /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend/vite.config.* 2>&1 | head
```

If a setup file is referenced (likely `frontend/src/test-setup.ts`), append:

```ts
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function () {};
  HTMLElement.prototype.releasePointerCapture = function () {};
  HTMLElement.prototype.hasPointerCapture = function () { return false; };
}
```

If no setup file exists, add this snippet at the top of the first pointer-event
test file in T6, and reference it from later test files via a shared import. **Task
6 will own this responsibility.**

For pointer events, use `fireEvent.pointerDown / pointerMove / pointerUp` from
`@testing-library/react`. Each call needs `clientX`, `clientY`, and `pointerId`:

```ts
fireEvent.pointerDown(el, { clientX: 100, clientY: 50, pointerId: 1, button: 0 });
fireEvent.pointerMove(el, { clientX: 150, clientY: 70, pointerId: 1 });
fireEvent.pointerUp(el,   { clientX: 150, clientY: 70, pointerId: 1 });
```

---

## Phase A — Pure transformers (zero React)

### Task 1: `json-formats.ts` pure transformers + 8 unit tests

**Files:**
- Create: `frontend/src/lib/json-formats.ts`
- Create: `frontend/src/lib/__tests__/json-formats.test.ts`

This task introduces the transformer used by `JsonPreview` in T9. No React, no
store coupling — easy to verify in isolation.

- [ ] **Step 1: Add failing test file (RED)**

Create `frontend/src/lib/__tests__/json-formats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { transform } from "../json-formats";
import type { Annotation } from "../../stores/predict-store";

const ann = (
  id: string,
  field_name: string,
  partial: Partial<Annotation> = {}
): Annotation => ({
  id, document_id: "d-1", field_name,
  field_value: "v", field_type: "string",
  bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 },
  source: "ai_detected", confidence: 0.95, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "", updated_at: "",
  ...partial,
});

describe("json-formats.transform", () => {
  describe("flat", () => {
    it("returns structured_data unchanged (reference-equal)", () => {
      const sd = { a: 1, b: "x" };
      expect(transform("flat", { structuredData: sd, annotations: [] })).toBe(sd);
    });
  });

  describe("detailed", () => {
    it("wraps a leaf scalar with matching annotation as {value, confidence, bbox}", () => {
      const sd = { invoice_number: "INV-001" };
      const anns = [ann("a-1", "invoice_number", { confidence: 0.9 })];
      const out = transform("detailed", { structuredData: sd, annotations: anns });
      expect(out).toEqual({
        invoice_number: {
          value: "INV-001",
          confidence: 0.9,
          bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 },
        },
      });
    });

    it("wraps leaf without matching annotation as {value, confidence: null, bbox: null}", () => {
      const sd = { unknown_field: "x" };
      const out = transform("detailed", { structuredData: sd, annotations: [] });
      expect(out).toEqual({
        unknown_field: { value: "x", confidence: null, bbox: null },
      });
    });

    it("recurses into nested objects", () => {
      const sd = { meta: { rev: 2 } };
      const anns = [ann("a-1", "meta.rev", { confidence: 0.5 })];
      const out = transform("detailed", { structuredData: sd, annotations: anns });
      expect(out).toEqual({
        meta: { rev: { value: 2, confidence: 0.5, bbox: anns[0].bounding_box } },
      });
    });

    it("treats arrays as leaves (does not recurse into items)", () => {
      const sd = { items: [{ qty: 1 }, { qty: 2 }] };
      const anns = [ann("a-1", "items", { confidence: 0.7 })];
      const out = transform("detailed", { structuredData: sd, annotations: anns }) as {
        items: { value: unknown; confidence: number | null; bbox: unknown };
      };
      expect(out.items.value).toEqual([{ qty: 1 }, { qty: 2 }]);
      expect(out.items.confidence).toBe(0.7);
    });
  });

  describe("grouped", () => {
    it("partitions buyer_/seller_/items/other into named groups", () => {
      const sd = {
        buyer_name: "Acme", buyer_tax_id: "X1",
        seller_name: "F9", seller_tax_id: "Y2",
        items: [{ qty: 1 }],
        invoice_number: "INV-001",
      };
      const out = transform("grouped", { structuredData: sd, annotations: [] });
      expect(out).toEqual({
        buyer: { name: "Acme", tax_id: "X1" },
        seller: { name: "F9", tax_id: "Y2" },
        line_items: [{ qty: 1 }],
        meta: { invoice_number: "INV-001" },
      });
    });

    it("returns { meta: {} } for empty input", () => {
      expect(transform("grouped", { structuredData: {}, annotations: [] })).toEqual({
        meta: {},
      });
    });

    it("returns { meta: null } for null input (and never crashes)", () => {
      expect(transform("grouped", { structuredData: null, annotations: [] })).toEqual({
        meta: {},
      });
    });

    it("non-invoice template keeps everything under meta", () => {
      const sd = { article_id: "A1", word_count: 200 };
      expect(transform("grouped", { structuredData: sd, annotations: [] })).toEqual({
        meta: { article_id: "A1", word_count: 200 },
      });
    });
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run json-formats 2>&1 | tail -10
```

Expected: `Failed to resolve import "../json-formats"`. Capture error.

- [ ] **Step 3: Implement transformers**

Create `frontend/src/lib/json-formats.ts`:

```ts
import type { Annotation } from "../stores/predict-store";

export type JsonFormat = "flat" | "detailed" | "grouped";

interface Args {
  structuredData: Record<string, unknown> | null;
  annotations: Annotation[];
}

interface Detailed {
  value: unknown;
  confidence: number | null;
  bbox: Record<string, number> | null;
}

function findAnn(anns: Annotation[], path: string[]): Annotation | undefined {
  const dotted = path.join(".");
  return (
    anns.find((a) => a.field_name === dotted) ??
    anns.find((a) => a.field_name === path[path.length - 1])
  );
}

function detailify(node: unknown, path: string[], anns: Annotation[]): unknown {
  if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(node as Record<string, unknown>)) {
      out[k] = detailify((node as Record<string, unknown>)[k], [...path, k], anns);
    }
    return out;
  }
  // leaf (scalar OR array)
  const ann = findAnn(anns, path);
  return {
    value: node,
    confidence: ann?.confidence ?? null,
    bbox: ann?.bounding_box ?? null,
  } satisfies Detailed;
}

function group(
  sd: Record<string, unknown> | null,
): Record<string, unknown> {
  const buyer: Record<string, unknown> = {};
  const seller: Record<string, unknown> = {};
  const meta: Record<string, unknown> = {};
  let lineItems: unknown = undefined;

  if (sd) {
    for (const k of Object.keys(sd)) {
      const v = sd[k];
      if (k === "items") {
        lineItems = v;
      } else if (k.startsWith("buyer_")) {
        buyer[k.slice("buyer_".length)] = v;
      } else if (k.startsWith("seller_")) {
        seller[k.slice("seller_".length)] = v;
      } else {
        meta[k] = v;
      }
    }
  }

  const out: Record<string, unknown> = {};
  if (Object.keys(buyer).length) out.buyer = buyer;
  if (Object.keys(seller).length) out.seller = seller;
  if (lineItems !== undefined) out.line_items = lineItems;
  out.meta = meta; // always present
  return out;
}

export function transform(format: JsonFormat, args: Args): unknown {
  if (format === "flat") return args.structuredData;
  if (format === "detailed") {
    if (args.structuredData === null) return null;
    return detailify(args.structuredData, [], args.annotations);
  }
  return group(args.structuredData);
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run json-formats 2>&1 | tail -10
```

Expected: 8 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 166 passed (158 + 8).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/lib/json-formats.ts frontend/src/lib/__tests__/json-formats.test.ts
git commit -m "S2b2/Task 1 (TDD): json-formats transformers + 8 tests

Pure functions for the 3 JSON output modes:
- flat: passthrough
- detailed: each leaf wrapped with {value, confidence, bbox}
            from annotations (arrays are leaves; do not recurse into items)
- grouped: buyer_*/seller_*/items/* heuristic into 4 named groups
           (meta is always present; empty groups omitted)

Frontend: 158 -> 166."
```

---

## Phase B — StepIndicator

### Task 2: StepIndicator + 4 tests

**Files:**
- Create: `frontend/src/components/workspace/StepIndicator.tsx`
- Create: `frontend/src/components/workspace/__tests__/StepIndicator.test.tsx`

- [ ] **Step 1: Add failing tests (RED)**

Create `frontend/src/components/workspace/__tests__/StepIndicator.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import StepIndicator from "../StepIndicator";

beforeEach(() => {
  usePredictStore.setState({
    selectedAnnotationId: null,
    currentStep: 0,
    apiFormat: "flat",
    processorOverride: "",
    promptOverride: "",
  });
});
afterEach(() => vi.clearAllMocks());

describe("StepIndicator", () => {
  it("renders all 6 steps", () => {
    render(<StepIndicator />);
    for (const label of ["Upload", "Preview", "Correct", "ApiFormat", "Tune", "GenerateAPI"]) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it("renders 🔒 on Tune and GenerateAPI", () => {
    render(<StepIndicator />);
    const tune = screen.getByRole("button", { name: /Tune/ });
    const gen = screen.getByRole("button", { name: /GenerateAPI/ });
    expect(tune.textContent).toMatch(/🔒/);
    expect(gen.textContent).toMatch(/🔒/);
    expect(tune).toBeDisabled();
    expect(gen).toBeDisabled();
  });

  it("clicking a reachable step calls setStep with that id", async () => {
    usePredictStore.setState({ currentStep: 3 });
    const user = userEvent.setup();
    render(<StepIndicator />);
    await user.click(screen.getByRole("button", { name: /Preview/ }));
    expect(usePredictStore.getState().currentStep).toBe(1);
  });

  it("highlights the current step with aria-current=step", () => {
    usePredictStore.setState({ currentStep: 2 });
    render(<StepIndicator />);
    expect(screen.getByRole("button", { name: /Correct/ })).toHaveAttribute(
      "aria-current",
      "step"
    );
    expect(screen.getByRole("button", { name: /Upload/ })).not.toHaveAttribute(
      "aria-current"
    );
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run StepIndicator 2>&1 | tail -10
```
Expected: `Failed to resolve import "../StepIndicator"`.

- [ ] **Step 3: Implement StepIndicator**

Create `frontend/src/components/workspace/StepIndicator.tsx`:

```tsx
import { usePredictStore } from "../../stores/predict-store";

interface Step {
  id: 0 | 1 | 2 | 3;
  label: string;
}
const REACHABLE_STEPS: Step[] = [
  { id: 0, label: "Upload" },
  { id: 1, label: "Preview" },
  { id: 2, label: "Correct" },
  { id: 3, label: "ApiFormat" },
];
const LOCKED_STEPS = [
  { id: 4, label: "Tune" },
  { id: 5, label: "GenerateAPI" },
];

export default function StepIndicator() {
  const currentStep = usePredictStore((s) => s.currentStep);
  const setStep = usePredictStore((s) => s.setStep);

  return (
    <div className="bg-[#0f1117] border-b border-[#2a2e3d] px-4 py-2 flex items-center gap-1 text-xs">
      {REACHABLE_STEPS.map((s) => {
        const isCurrent = s.id === currentStep;
        const isCompleted = s.id < currentStep;
        const cls = isCurrent
          ? "border border-[#6366f1] text-[#818cf8] font-semibold"
          : isCompleted
          ? "bg-[#312e81] text-white"
          : "bg-[#1a1d27] text-[#94a3b8]";
        return (
          <button
            key={s.id}
            type="button"
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => setStep(s.id)}
            className={`${cls} px-3 py-1 rounded hover:border-[#818cf8] hover:border`}
          >
            {s.id + 1}. {s.label}
          </button>
        );
      })}
      {LOCKED_STEPS.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled
          className="bg-[#1a1d27] text-[#475569] px-3 py-1 rounded opacity-50 cursor-not-allowed"
        >
          🔒 {s.id + 1}. {s.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run StepIndicator 2>&1 | tail -10
```
Expected: 4 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 170 passed (166 + 4).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/StepIndicator.tsx frontend/src/components/workspace/__tests__/StepIndicator.test.tsx
git commit -m "S2b2/Task 2 (TDD): StepIndicator + 4 tests

6-step bar wired to predict-store.currentStep:
- Upload(0) Preview(1) Correct(2) ApiFormat(3) clickable (setStep)
- Tune(4) GenerateAPI(5) locked (🔒, disabled, gated for S3/S5)
- aria-current=step on the current step
- visual states: completed (filled), current (bordered indigo), upcoming (muted)

Frontend: 166 -> 170."
```

---

## Phase C — DocumentCanvas refactor (per-page render-prop)

### Task 3: DocumentCanvas `renderPageOverlay` + `overlay` props + 2 tests

**Files:**
- Modify: `frontend/src/components/workspace/DocumentCanvas.tsx` (refactor signature)
- Modify: `frontend/src/components/workspace/__tests__/DocumentCanvas.test.tsx` (4 existing tests get updated; 2 new tests for new prop shape)

DocumentCanvas currently takes `children` and renders it once after the PDF page
loop. We replace this with two explicit slots:

- `overlay?: ReactNode` — single overlay for the image branch.
- `renderPageOverlay?: (pageNumber: number, pageRect: DOMRect) => ReactNode` —
  per-page overlay for the PDF branch.

Existing `children` callers will be updated in T11 (WorkspacePage). For now, the
refactored DocumentCanvas no longer accepts `children`.

- [ ] **Step 1: Update existing tests + add new tests (RED)**

Open `frontend/src/components/workspace/__tests__/DocumentCanvas.test.tsx` and
REPLACE its content with:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-pdf", () => ({
  Document: ({ children, file, onLoadSuccess }: {
    children: React.ReactNode;
    file: string;
    onLoadSuccess?: (a: { numPages: number }) => void;
  }) => {
    queueMicrotask(() => onLoadSuccess?.({ numPages: 2 }));
    return <div data-testid="pdf-document" data-file={file}>{children}</div>;
  },
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`pdf-page-${pageNumber}`} data-page={pageNumber}>Page {pageNumber}</div>
  ),
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
}));

import DocumentCanvas from "../DocumentCanvas";

afterEach(() => vi.clearAllMocks());

describe("DocumentCanvas", () => {
  it("renders <img> for image mime types with single `overlay` slot", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview"
        mimeType="image/png"
        filename="x.png"
        overlay={<span data-testid="image-overlay">o</span>}
      />
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "http://x/preview");
    expect(screen.getByTestId("image-overlay")).toBeInTheDocument();
  });

  it("renders react-pdf Document for application/pdf", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview.pdf"
        mimeType="application/pdf"
        filename="x.pdf"
        renderPageOverlay={() => null}
      />
    );
    expect(screen.getByTestId("pdf-document")).toHaveAttribute(
      "data-file",
      "http://x/preview.pdf"
    );
  });

  it("renders unsupported placeholder for xlsx and ignores overlay", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview.xlsx"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename="x.xlsx"
        overlay={<span data-testid="ignored-overlay">should not show</span>}
      />
    );
    expect(screen.getByText(/暂不支持预览/)).toBeInTheDocument();
    expect(screen.queryByTestId("ignored-overlay")).not.toBeInTheDocument();
  });

  it("calls renderPageOverlay once per page after onLoadSuccess fires", async () => {
    const renderPageOverlay = vi.fn((p: number) => (
      <span data-testid={`overlay-page-${p}`}>p{p}</span>
    ));
    render(
      <DocumentCanvas
        previewUrl="http://x/p.pdf"
        mimeType="application/pdf"
        filename="p.pdf"
        renderPageOverlay={renderPageOverlay}
      />
    );
    expect(await screen.findByTestId("overlay-page-1")).toBeInTheDocument();
    expect(await screen.findByTestId("overlay-page-2")).toBeInTheDocument();
    expect(renderPageOverlay).toHaveBeenCalledWith(1, expect.any(Object));
    expect(renderPageOverlay).toHaveBeenCalledWith(2, expect.any(Object));
  });

  it("works without an overlay prop on image branch (renders image only)", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/p.png"
        mimeType="image/jpeg"
        filename="p.jpg"
      />
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "http://x/p.png");
  });

  it("works without renderPageOverlay on PDF branch (renders pages only)", async () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/p.pdf"
        mimeType="application/pdf"
        filename="p.pdf"
      />
    );
    expect(await screen.findByTestId("pdf-page-1")).toBeInTheDocument();
    expect(await screen.findByTestId("pdf-page-2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run DocumentCanvas 2>&1 | tail -15
```

Expected: failures referring to `renderPageOverlay`, `overlay` props missing, or
`pdf-page-*` testids missing.

- [ ] **Step 3: Refactor DocumentCanvas**

REPLACE `frontend/src/components/workspace/DocumentCanvas.tsx` content with:

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Document, Page } from "react-pdf";

interface Props {
  previewUrl: string;
  mimeType: string;
  filename: string;
  /** Single overlay for the image branch. Ignored on PDF / unsupported branches. */
  overlay?: ReactNode;
  /** Per-page overlay for the PDF branch. Ignored on image / unsupported branches. */
  renderPageOverlay?: (pageNumber: number, pageRect: DOMRect) => ReactNode;
}

export default function DocumentCanvas({
  previewUrl, mimeType, filename, overlay, renderPageOverlay,
}: Props) {
  const [numPages, setNumPages] = useState<number>(0);

  if (mimeType.startsWith("image/")) {
    return (
      <div className="relative inline-block">
        <img src={previewUrl} alt={filename} className="max-w-full block" />
        {overlay}
      </div>
    );
  }

  if (mimeType === "application/pdf") {
    return (
      <div className="relative">
        <Document
          file={previewUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="text-sm text-[#94a3b8] p-4">加载 PDF...</div>}
        >
          {Array.from({ length: numPages || 1 }, (_, i) => (
            <PageWithOverlay
              key={i}
              pageNumber={i + 1}
              renderOverlay={renderPageOverlay}
            />
          ))}
        </Document>
      </div>
    );
  }

  return (
    <div className="text-center text-[#94a3b8] p-12 border border-dashed border-[#2a2e3d] rounded">
      <div className="text-sm mb-1">📄 {filename}</div>
      <div className="text-xs text-[#64748b]">暂不支持预览此文件类型 ({mimeType})</div>
    </div>
  );
}

interface PageWithOverlayProps {
  pageNumber: number;
  renderOverlay?: (pageNumber: number, pageRect: DOMRect) => ReactNode;
}

function PageWithOverlay({ pageNumber, renderOverlay }: PageWithOverlayProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setRect(el.getBoundingClientRect());
    const ro = new ResizeObserver(() => {
      setRect(el.getBoundingClientRect());
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="relative mb-2 border border-[#2a2e3d]">
      <Page pageNumber={pageNumber} renderTextLayer={false} renderAnnotationLayer={false} />
      {renderOverlay && rect ? renderOverlay(pageNumber, rect) : null}
    </div>
  );
}
```

The `ResizeObserver` is needed because react-pdf's Page resizes asynchronously after
onLoadSuccess. In jsdom tests, ResizeObserver is provided by `@testing-library`'s
default polyfill (or via vitest's jsdom env); the test mocks `Page` so the actual
canvas rendering is bypassed but a div with size 0×0 is still observable, so
`renderOverlay` is called with a zero-sized rect — sufficient for testing the call
itself.

If tests fail with `ResizeObserver is not defined`, add this stub at the top of
`DocumentCanvas.test.tsx`:

```ts
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof StubResizeObserver })
  .ResizeObserver = StubResizeObserver;
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run DocumentCanvas 2>&1 | tail -10
```
Expected: 6 passed.

⚠️ **WorkspacePage currently passes `children`** (S2b1 used the old slot). With this
refactor, that prop is silently dropped and the BboxOverlay disappears. T11 fixes
WorkspacePage to use the new props. **Do not run the full suite yet** — it will
fail in WorkspacePage tests until T11. Just confirm DocumentCanvas tests pass.

For sanity, confirm only WorkspacePage fails:

```bash
npm test 2>&1 | tail -10
```
Expected: 1 file failing (WorkspacePage). Other 25+ files green. Document the
breakage in commit message.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/DocumentCanvas.tsx frontend/src/components/workspace/__tests__/DocumentCanvas.test.tsx
git commit -m "S2b2/Task 3 (TDD): DocumentCanvas per-page renderPageOverlay + 6 tests

Refactor children slot to two explicit props:
- overlay?: ReactNode             -> image branch
- renderPageOverlay?: (n, rect)   -> PDF branch (per-page)

PageWithOverlay wraps each react-pdf Page, tracks its DOMRect via
ResizeObserver, and invokes renderPageOverlay(pageNumber, rect) so
BboxOverlay can position relative to the actual page (multi-page fix).

Frontend tests: DocumentCanvas 6/6. WorkspacePage tests temporarily
broken (still pass old children prop); fixed in T11.

LS-9 (workspace state machine UI) progresses; LS-2 (bbox edit) unblocks."
```

---

## Phase D — BboxOverlay incremental upgrade (5 tasks)

### Task 4: BboxOverlay accepts `pageNumber`/`pageRect`/`onPatchBbox`/`onCreateBbox` (read-only behaviour preserved) + existing tests still pass

**Files:**
- Modify: `frontend/src/components/workspace/BboxOverlay.tsx` (extend prop interface, no behavior change)
- Modify: `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx` (update existing 5 tests' renderProps; add helpers)

This task only widens the prop surface so T5–T8 can layer behaviors. Existing 5
tests should still pass after adapting their render calls.

- [ ] **Step 1: Update existing tests with new required props (RED)**

Open `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx`. At the
top, ADD a helper:

```tsx
const STUB_RECT: DOMRect = {
  x: 0, y: 0, width: 1000, height: 1400,
  top: 0, left: 0, right: 1000, bottom: 1400,
  toJSON() { return this; },
};
```

In each existing call to `<BboxOverlay ... />`, ADD these props:

```tsx
pageNumber={1}
pageRect={STUB_RECT}
onPatchBbox={vi.fn()}
onCreateBbox={vi.fn()}
```

(Existing `annotations`, `selectedAnnotationId`, `onSelect` props remain unchanged.)

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -15
```

Expected: 5 failures complaining about missing required props (TypeScript type
errors at runtime won't trigger; instead the test will pass values that the
component does not use). Actually — since the props are added as required to the
interface, TS-checked tests will fail compilation. To force RED *behaviorally*, the
component should *type-error*. Run:

```bash
npx tsc -p . --noEmit 2>&1 | tail -10
```

Expected: errors about missing props in `BboxOverlay.test.tsx`. Capture.

- [ ] **Step 3: Extend BboxOverlay prop interface (no new behavior)**

Open `frontend/src/components/workspace/BboxOverlay.tsx`. Replace the existing
`interface Props` and component signature; the body of the rendering loop
(skipping bbox-less, sizing buttons, click → onSelect) STAYS UNCHANGED.

```tsx
import type { Annotation } from "../../stores/predict-store";

type BoundingBox = { x: number; y: number; w: number; h: number; page: number };

interface Props {
  pageNumber: number;       // 1-based; for image branch caller passes 1
  pageRect: DOMRect;        // pixel bounds of the containing page
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelect: (id: string | null) => void;
  onPatchBbox: (id: string, bbox: BoundingBox) => Promise<void>;
  onCreateBbox: (bbox: BoundingBox, fieldName: string) => Promise<void>;
}

const COLOR_SELECTED = "#6366f1";
const COLOR_HI = "#22c55e";
const COLOR_MID = "#f59e0b";
const COLOR_LO = "#ef4444";

function colorFor(a: Annotation, isSelected: boolean): string {
  if (isSelected) return COLOR_SELECTED;
  const c = a.confidence;
  if (c == null) return COLOR_LO;
  if (c >= 0.95) return COLOR_HI;
  if (c >= 0.90) return COLOR_MID;
  return COLOR_LO;
}

export default function BboxOverlay({
  annotations, selectedAnnotationId, onSelect,
  // T5+ uses these; reference them so unused-var lint stays quiet
  pageNumber: _pageNumber, pageRect: _pageRect,
  onPatchBbox: _onPatchBbox, onCreateBbox: _onCreateBbox,
}: Props) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      {annotations
        .filter((a) => a.bounding_box != null)
        .map((a) => {
          const bbox = a.bounding_box!;
          const isSelected = selectedAnnotationId === a.id;
          const color = colorFor(a, isSelected);
          return (
            <button
              key={a.id}
              type="button"
              aria-label={a.field_name}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(a.id);
              }}
              className="absolute pointer-events-auto cursor-pointer"
              style={{
                left: `${bbox.x * 100}%`,
                top: `${bbox.y * 100}%`,
                width: `${bbox.w * 100}%`,
                height: `${bbox.h * 100}%`,
                border: `${isSelected ? 4 : 2}px solid ${color}`,
                backgroundColor: `${color}1f`,
                padding: 0,
                boxSizing: "border-box",
              }}
            >
              <span
                className="absolute -top-5 left-0 text-[9px] font-semibold text-white px-1 rounded-t"
                style={{ backgroundColor: color }}
              >
                {a.field_name}
                {a.confidence != null && ` ${Math.round(a.confidence * 100)}%`}
              </span>
            </button>
          );
        })}
    </div>
  );
}
```

(The `_pageNumber`, `_pageRect`, `_onPatchBbox`, `_onCreateBbox` underscore names
silence "declared but unused" warnings; T5–T8 will rename them to active names as
behaviors land.)

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npx tsc -p . --noEmit 2>&1 | tail -5
npm test -- --run BboxOverlay 2>&1 | tail -10
```

Expected: tsc clean; 5 BboxOverlay tests pass (existing behaviors preserved).

⚠️ WorkspacePage tests are *also* still red from T3, plus now WorkspacePage's
existing `<BboxOverlay>` callsite is missing the new props. T11 fixes both.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/BboxOverlay.tsx frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx
git commit -m "S2b2/Task 4 (TDD): BboxOverlay extended prop surface (no behavior yet)

Adds required props pageNumber, pageRect, onPatchBbox, onCreateBbox to
prepare for T5-T8 (drag/resize/create). Behavior is unchanged: still
read-only with click-to-select. Existing 5 tests pass with stub DOMRect
+ vi.fn() for new callbacks.

WorkspacePage tests still red (fixed in T11)."
```

---

### Task 5: Resize handles render on selected bbox + 2 tests

**Files:**
- Modify: `frontend/src/components/workspace/BboxOverlay.tsx` (render 8 handles when selected)
- Modify: `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx` (append 2 tests)

8 handles: 4 corners (NW, NE, SE, SW) + 4 sides (N, E, S, W). Visible only on the
currently-selected bbox. T5 only renders them — wiring drag math comes in T7.

- [ ] **Step 1: Append 2 failing tests (RED)**

In `BboxOverlay.test.tsx`, append at the bottom of the existing
`describe("BboxOverlay", ...)` block (before the closing `})`):

```tsx
  it("renders 8 resize handles on selected bbox only", () => {
    const annotations = [ann("a-1"), ann("a-2")];
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={annotations}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    const handles = screen.getAllByTestId(/^bbox-handle-a-1-/);
    expect(handles).toHaveLength(8);
    expect(screen.queryAllByTestId(/^bbox-handle-a-2-/)).toHaveLength(0);
  });

  it("does not render handles when nothing is selected", () => {
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1")]}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    expect(screen.queryAllByTestId(/^bbox-handle-/)).toHaveLength(0);
  });
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -15
```
Expected: 2 failures (handles testid not found).

- [ ] **Step 3: Add handle rendering**

In `BboxOverlay.tsx`, modify the bbox button JSX to render handles when
`isSelected`. Locate the existing `<span ...>{a.field_name}...</span>` block and
add immediately after it (still inside the `<button>` for the bbox):

```tsx
              {isSelected && HANDLE_KEYS.map((h) => (
                <span
                  key={h}
                  data-testid={`bbox-handle-${a.id}-${h}`}
                  className={`absolute pointer-events-auto bg-[#6366f1] ${HANDLE_CLASS[h]}`}
                  style={{ width: 8, height: 8, marginLeft: -4, marginTop: -4 }}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ))}
```

At top of `BboxOverlay.tsx` (after color constants), add:

```tsx
const HANDLE_KEYS = ["nw","n","ne","e","se","s","sw","w"] as const;
type HandleKey = typeof HANDLE_KEYS[number];

const HANDLE_CLASS: Record<HandleKey, string> = {
  nw: "left-0 top-0 cursor-nwse-resize",
  n:  "left-1/2 top-0 cursor-ns-resize",
  ne: "left-full top-0 cursor-nesw-resize",
  e:  "left-full top-1/2 cursor-ew-resize",
  se: "left-full top-full cursor-nwse-resize",
  s:  "left-1/2 top-full cursor-ns-resize",
  sw: "left-0 top-full cursor-nesw-resize",
  w:  "left-0 top-1/2 cursor-ew-resize",
};
```

The `e.stopPropagation` keeps handle pointer-down from bubbling into the body's
click → onSelect handler. T7 will add the actual drag logic.

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -10
```
Expected: 7 passed (5 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/BboxOverlay.tsx frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx
git commit -m "S2b2/Task 5 (TDD): BboxOverlay 8 resize handles (visual only) + 2 tests

8 handles (NW/N/NE/E/SE/S/SW/W) render on the selected bbox with
direction-appropriate cursors. Handle pointerDown stops propagation
so the body click->onSelect doesn't fire from the handle.

T7 will wire actual resize drag math.

Frontend: BboxOverlay 5 -> 7."
```

---

### Task 6: Drag bbox body to move + onPatchBbox + 4 tests + setPointerCapture polyfill

**Files:**
- Locate or create: `frontend/src/test-setup.ts` (one-time pointer-capture polyfill)
- Modify: `frontend/src/components/workspace/BboxOverlay.tsx` (drag-body logic)
- Modify: `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx` (append 4 drag tests)

This is the trickiest task. Drag the body of the selected bbox: while pointer is
down, track delta in pixels; on pointer-up, normalize delta to fractions and call
`onPatchBbox(id, { x, y, w, h, page })`.

- [ ] **Step 0: Confirm or create test setup file with pointer polyfill**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
grep -n "setupFiles" vitest.config.* vite.config.* 2>&1 | head
```

If a setup file is referenced, append the polyfill there. Otherwise:

```bash
cat vite.config.ts 2>&1 | grep -A 5 "test:" | head
```

If no `test.setupFiles` config, edit `vite.config.ts` to add it. Locate the
`test:` block (or add one) and ensure it includes:

```ts
test: {
  globals: true,
  environment: "jsdom",
  setupFiles: ["./src/test-setup.ts"],
}
```

Then create `frontend/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function () {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = function () {};
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = function () {
    return false;
  };
}

if (typeof globalThis.ResizeObserver === "undefined") {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver })
    .ResizeObserver = StubResizeObserver;
}
```

If a setup file already exists at `src/test-setup.ts`, append only the new
prototype/ResizeObserver blocks (don't duplicate existing imports).

Verify nothing's broken by setup:

```bash
npm test 2>&1 | tail -3
```

Expected: same passing count as before (170 — no behavior change from polyfill).

- [ ] **Step 1: Append 4 failing drag tests (RED)**

In `BboxOverlay.test.tsx`, add at top of file (after the existing imports):

```tsx
import { fireEvent } from "@testing-library/react";
```

Then append at the bottom of `describe("BboxOverlay", ...)`:

```tsx
  it("dragging the bbox body calls onPatchBbox with shifted x/y on pointer-up", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const box = screen.getByRole("button", { name: /field-a-1/ });

    fireEvent.pointerDown(box, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(box, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(box,   { clientX: 300, clientY: 200, pointerId: 1 });

    // 100 px / 1000 px = 0.1 fraction; new x = 0.1 + 0.1 = 0.2
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch.mock.calls[0][0]).toBe("a-1");
    const sent = onPatch.mock.calls[0][1] as { x: number; y: number; w: number; h: number; page: number };
    expect(sent.x).toBeCloseTo(0.2, 3);
    expect(sent.y).toBeCloseTo(0.1, 3);
    expect(sent.w).toBeCloseTo(0.2, 3);
    expect(sent.h).toBeCloseTo(0.05, 3);
    expect(sent.page).toBe(0);
  });

  it("does NOT call onPatchBbox when pointer-up fires without movement (click-only)", async () => {
    const onPatch = vi.fn();
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1")]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const box = screen.getByRole("button", { name: /field-a-1/ });
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(box,   { clientX: 100, clientY: 100, pointerId: 1 });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("clamps x to [0, 1-w] when drag would push beyond page edge", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.7, y: 0.1, w: 0.2, h: 0.05, page: 0 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const box = screen.getByRole("button", { name: /field-a-1/ });
    // Try to drag 500 px right → would push x past 1.0
    fireEvent.pointerDown(box, { clientX: 800, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(box, { clientX: 1300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(box,   { clientX: 1300, clientY: 200, pointerId: 1 });

    const sent = onPatch.mock.calls[0][1] as { x: number };
    // Clamped: max x = 1 - 0.2 = 0.8
    expect(sent.x).toBeCloseTo(0.8, 3);
  });

  it("preserves bbox.page from the existing annotation when patching", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={2}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 1 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const box = screen.getByRole("button", { name: /field-a-1/ });
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(box, { clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(box,   { clientX: 150, clientY: 100, pointerId: 1 });

    const sent = onPatch.mock.calls[0][1] as { page: number };
    expect(sent.page).toBe(1);  // matches the annotation's existing page
  });
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -25
```
Expected: 4 new failures (onPatch never called).

- [ ] **Step 3: Add drag-body logic**

In `BboxOverlay.tsx`, add `useState` and `useRef` imports at top:

```tsx
import { useRef, useState } from "react";
```

Replace the bbox `<button ...>` JSX with this expanded version that handles drag.
The full updated component is:

```tsx
import { useRef, useState } from "react";
import type { Annotation } from "../../stores/predict-store";

type BoundingBox = { x: number; y: number; w: number; h: number; page: number };

interface Props {
  pageNumber: number;
  pageRect: DOMRect;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelect: (id: string | null) => void;
  onPatchBbox: (id: string, bbox: BoundingBox) => Promise<void>;
  onCreateBbox: (bbox: BoundingBox, fieldName: string) => Promise<void>;
}

const COLOR_SELECTED = "#6366f1";
const COLOR_HI = "#22c55e";
const COLOR_MID = "#f59e0b";
const COLOR_LO = "#ef4444";

const HANDLE_KEYS = ["nw","n","ne","e","se","s","sw","w"] as const;
type HandleKey = typeof HANDLE_KEYS[number];

const HANDLE_CLASS: Record<HandleKey, string> = {
  nw: "left-0 top-0 cursor-nwse-resize",
  n:  "left-1/2 top-0 cursor-ns-resize",
  ne: "left-full top-0 cursor-nesw-resize",
  e:  "left-full top-1/2 cursor-ew-resize",
  se: "left-full top-full cursor-nwse-resize",
  s:  "left-1/2 top-full cursor-ns-resize",
  sw: "left-0 top-full cursor-nesw-resize",
  w:  "left-0 top-1/2 cursor-ew-resize",
};

function colorFor(a: Annotation, isSelected: boolean): string {
  if (isSelected) return COLOR_SELECTED;
  const c = a.confidence;
  if (c == null) return COLOR_LO;
  if (c >= 0.95) return COLOR_HI;
  if (c >= 0.90) return COLOR_MID;
  return COLOR_LO;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface DragState {
  id: string;
  origin: { x: number; y: number };       // pointer origin in CSS pixels
  origBbox: BoundingBox;
  moved: boolean;
  delta: { dx: number; dy: number };       // last pixel delta during drag
}

export default function BboxOverlay({
  pageNumber, pageRect, annotations, selectedAnnotationId, onSelect,
  onPatchBbox,
  onCreateBbox: _onCreateBbox,
}: Props) {
  // suppress unused-var until T7+T8 wire them
  void pageNumber;
  void _onCreateBbox;
  const [drag, setDrag] = useState<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function handleBodyPointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    a: Annotation
  ) {
    if (a.bounding_box == null) return;
    e.stopPropagation();
    onSelect(a.id);
    setDrag({
      id: a.id,
      origin: { x: e.clientX, y: e.clientY },
      origBbox: a.bounding_box as BoundingBox,
      moved: false,
      delta: { dx: 0, dy: 0 },
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleBodyPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const dx = e.clientX - drag.origin.x;
    const dy = e.clientY - drag.origin.y;
    setDrag({ ...drag, delta: { dx, dy }, moved: drag.moved || (dx !== 0 || dy !== 0) });
  }

  async function handleBodyPointerUp(
    e: React.PointerEvent<HTMLButtonElement>,
    a: Annotation
  ) {
    if (!drag || drag.id !== a.id) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const { dx, dy } = drag.delta;
    const moved = drag.moved;
    setDrag(null);
    if (!moved) return;
    const fx = dx / pageRect.width;
    const fy = dy / pageRect.height;
    const ob = drag.origBbox;
    const newBbox: BoundingBox = {
      x: clamp(ob.x + fx, 0, 1 - ob.w),
      y: clamp(ob.y + fy, 0, 1 - ob.h),
      w: ob.w,
      h: ob.h,
      page: ob.page,
    };
    try {
      await onPatchBbox(a.id, newBbox);
    } catch (err) {
      console.error("[BboxOverlay] patch failed", err);
    }
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      {annotations
        .filter((a) => a.bounding_box != null)
        .map((a) => {
          const bbox = a.bounding_box! as BoundingBox;
          const isSelected = selectedAnnotationId === a.id;
          const color = colorFor(a, isSelected);
          const isDragging = drag?.id === a.id && drag.moved;
          const xPct = isDragging
            ? (bbox.x + drag.delta.dx / pageRect.width) * 100
            : bbox.x * 100;
          const yPct = isDragging
            ? (bbox.y + drag.delta.dy / pageRect.height) * 100
            : bbox.y * 100;
          return (
            <button
              key={a.id}
              type="button"
              aria-label={a.field_name}
              onPointerDown={(e) => handleBodyPointerDown(e, a)}
              onPointerMove={handleBodyPointerMove}
              onPointerUp={(e) => void handleBodyPointerUp(e, a)}
              onClick={(e) => {
                e.stopPropagation();
                if (!drag || !drag.moved) onSelect(a.id);
              }}
              className="absolute pointer-events-auto cursor-move"
              style={{
                left: `${xPct}%`,
                top: `${yPct}%`,
                width: `${bbox.w * 100}%`,
                height: `${bbox.h * 100}%`,
                border: `${isSelected ? 4 : 2}px solid ${color}`,
                backgroundColor: `${color}1f`,
                padding: 0,
                boxSizing: "border-box",
              }}
            >
              <span
                className="absolute -top-5 left-0 text-[9px] font-semibold text-white px-1 rounded-t pointer-events-none"
                style={{ backgroundColor: color }}
              >
                {a.field_name}
                {a.confidence != null && ` ${Math.round(a.confidence * 100)}%`}
              </span>
              {isSelected && HANDLE_KEYS.map((h) => (
                <span
                  key={h}
                  data-testid={`bbox-handle-${a.id}-${h}`}
                  className={`absolute pointer-events-auto bg-[#6366f1] ${HANDLE_CLASS[h]}`}
                  style={{ width: 8, height: 8, marginLeft: -4, marginTop: -4 }}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ))}
            </button>
          );
        })}
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -10
```
Expected: 11 passed (5 existing + 2 handle visibility + 4 drag).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/test-setup.ts frontend/vite.config.ts frontend/src/components/workspace/BboxOverlay.tsx frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx
git commit -m "S2b2/Task 6 (TDD): BboxOverlay drag-body to move + 4 tests + pointer polyfill

- Native pointer events: down -> capture origin, move -> delta, up -> patch
- Optimistic local position while dragging
- Clamps new x to [0, 1-w]; preserves page from existing bbox
- Click-without-move still triggers onSelect (no patch fired)
- One-time test-setup.ts polyfill for jsdom setPointerCapture +
  ResizeObserver

Frontend: BboxOverlay 7 -> 11."
```

---

### Task 7: Resize via 8 handles + onPatchBbox + 4 tests

**Files:**
- Modify: `frontend/src/components/workspace/BboxOverlay.tsx` (handle drag logic)
- Modify: `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx` (append 4 tests)

Each handle resizes by anchoring the opposite corner. SE handle expands w/h; NW
shrinks x/y while expanding w/h; sides change one axis only.

- [ ] **Step 1: Append 4 failing resize tests (RED)**

```tsx
  it("dragging SE handle increases w and h on pointer-up", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const handle = screen.getByTestId("bbox-handle-a-1-se");
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 210, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 400, clientY: 280, pointerId: 1 });
    fireEvent.pointerUp(handle,   { clientX: 400, clientY: 280, pointerId: 1 });

    // dx=100/1000=0.1; dy=70/1400=0.05
    const sent = onPatch.mock.calls[0][1] as BoundingBox_;
    expect(sent.x).toBeCloseTo(0.1, 3);
    expect(sent.y).toBeCloseTo(0.1, 3);
    expect(sent.w).toBeCloseTo(0.3, 3);
    expect(sent.h).toBeCloseTo(0.1, 3);
  });

  it("dragging NW handle moves x/y and grows w/h", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.5, y: 0.5, w: 0.2, h: 0.1, page: 0 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const handle = screen.getByTestId("bbox-handle-a-1-nw");
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 700, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 400, clientY: 560, pointerId: 1 });
    fireEvent.pointerUp(handle,   { clientX: 400, clientY: 560, pointerId: 1 });

    // dx=-100/1000=-0.1, dy=-140/1400=-0.1
    const sent = onPatch.mock.calls[0][1] as BoundingBox_;
    expect(sent.x).toBeCloseTo(0.4, 3);
    expect(sent.y).toBeCloseTo(0.4, 3);
    expect(sent.w).toBeCloseTo(0.3, 3);
    expect(sent.h).toBeCloseTo(0.2, 3);
  });

  it("E side handle changes w only", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const handle = screen.getByTestId("bbox-handle-a-1-e");
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 175, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 400, clientY: 175, pointerId: 1 });
    fireEvent.pointerUp(handle,   { clientX: 400, clientY: 175, pointerId: 1 });

    const sent = onPatch.mock.calls[0][1] as BoundingBox_;
    expect(sent.x).toBeCloseTo(0.1, 3);
    expect(sent.y).toBeCloseTo(0.1, 3);
    expect(sent.w).toBeCloseTo(0.3, 3);
    expect(sent.h).toBeCloseTo(0.05, 3);
  });

  it("clamps minimum size to 0.005 fraction (no zero-or-negative)", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    // Drag SE handle inward more than the box's size
    const handle = screen.getByTestId("bbox-handle-a-1-se");
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 210, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX:  50, clientY:  50, pointerId: 1 });
    fireEvent.pointerUp(handle,   { clientX:  50, clientY:  50, pointerId: 1 });

    const sent = onPatch.mock.calls[0][1] as BoundingBox_;
    expect(sent.w).toBeGreaterThanOrEqual(0.005);
    expect(sent.h).toBeGreaterThanOrEqual(0.005);
  });
```

Add type import at top of test file (right after the existing imports):

```tsx
type BoundingBox_ = { x: number; y: number; w: number; h: number; page: number };
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -25
```
Expected: 4 failures.

- [ ] **Step 3: Implement handle drag**

In `BboxOverlay.tsx`, replace the inner handle `<span>` (in the
`isSelected && HANDLE_KEYS.map(...)` block) with a draggable version, and add the
resize state machinery. Updated component diff (replace handle render + add new
state + handlers):

Add a second drag state for resize:

```tsx
interface ResizeState {
  id: string;
  handle: HandleKey;
  origin: { x: number; y: number };
  origBbox: BoundingBox;
  moved: boolean;
  delta: { dx: number; dy: number };
}
```

In the component body (after `const [drag, setDrag] = ...`):

```tsx
const [resize, setResize] = useState<ResizeState | null>(null);
```

Add three new handlers:

```tsx
function handleHandlePointerDown(
  e: React.PointerEvent<HTMLSpanElement>,
  a: Annotation,
  handle: HandleKey,
) {
  if (a.bounding_box == null) return;
  e.stopPropagation();
  setResize({
    id: a.id,
    handle,
    origin: { x: e.clientX, y: e.clientY },
    origBbox: a.bounding_box as BoundingBox,
    moved: false,
    delta: { dx: 0, dy: 0 },
  });
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function handleHandlePointerMove(e: React.PointerEvent<HTMLSpanElement>) {
  if (!resize) return;
  const dx = e.clientX - resize.origin.x;
  const dy = e.clientY - resize.origin.y;
  setResize({ ...resize, delta: { dx, dy }, moved: resize.moved || (dx !== 0 || dy !== 0) });
}

async function handleHandlePointerUp(
  e: React.PointerEvent<HTMLSpanElement>,
  a: Annotation,
) {
  if (!resize || resize.id !== a.id) return;
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  const { handle, delta, origBbox, moved } = resize;
  setResize(null);
  if (!moved) return;
  const fx = delta.dx / pageRect.width;
  const fy = delta.dy / pageRect.height;
  const newBbox = applyResize(origBbox, handle, fx, fy);
  try {
    await onPatchBbox(a.id, newBbox);
  } catch (err) {
    console.error("[BboxOverlay] resize patch failed", err);
  }
}
```

Add a top-level helper:

```tsx
const MIN_DIM = 0.005;

function applyResize(
  b: BoundingBox, handle: HandleKey, fx: number, fy: number,
): BoundingBox {
  let { x, y, w, h } = b;
  if (handle.includes("e")) w = Math.max(MIN_DIM, w + fx);
  if (handle.includes("s")) h = Math.max(MIN_DIM, h + fy);
  if (handle.includes("w")) {
    const newW = Math.max(MIN_DIM, w - fx);
    x = clamp(x + (w - newW), 0, 1 - newW);
    w = newW;
  }
  if (handle.includes("n")) {
    const newH = Math.max(MIN_DIM, h - fy);
    y = clamp(y + (h - newH), 0, 1 - newH);
    h = newH;
  }
  // Clamp x+w and y+h to [0,1]
  x = clamp(x, 0, 1 - w);
  y = clamp(y, 0, 1 - h);
  return { x, y, w, h, page: b.page };
}
```

Update handle JSX to attach handlers:

```tsx
{isSelected && HANDLE_KEYS.map((h) => (
  <span
    key={h}
    data-testid={`bbox-handle-${a.id}-${h}`}
    className={`absolute pointer-events-auto bg-[#6366f1] ${HANDLE_CLASS[h]}`}
    style={{ width: 8, height: 8, marginLeft: -4, marginTop: -4 }}
    onPointerDown={(e) => handleHandlePointerDown(e, a, h)}
    onPointerMove={handleHandlePointerMove}
    onPointerUp={(e) => void handleHandlePointerUp(e, a)}
  />
))}
```

For optimistic preview while resizing, update the bbox computation block (where
`isDragging` and `xPct/yPct` are computed) to also account for resize. Replace
that block with:

```tsx
const isDragging = drag?.id === a.id && drag.moved;
const isResizing = resize?.id === a.id && resize.moved;
let dispBbox = bbox;
if (isDragging) {
  dispBbox = {
    ...bbox,
    x: bbox.x + drag.delta.dx / pageRect.width,
    y: bbox.y + drag.delta.dy / pageRect.height,
  };
} else if (isResizing) {
  dispBbox = applyResize(
    bbox, resize.handle,
    resize.delta.dx / pageRect.width,
    resize.delta.dy / pageRect.height,
  );
}
```

And use `dispBbox` instead of `bbox` for the inline `style={{ left, top, width, height }}` — replace those four lines with:

```tsx
left: `${dispBbox.x * 100}%`,
top: `${dispBbox.y * 100}%`,
width: `${dispBbox.w * 100}%`,
height: `${dispBbox.h * 100}%`,
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -10
```
Expected: 15 passed (11 existing + 4 resize).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/BboxOverlay.tsx frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx
git commit -m "S2b2/Task 7 (TDD): BboxOverlay 8-handle resize + 4 tests

applyResize helper handles all 8 directions:
- e/w handles change w (and x for w-side)
- n/s handles change h (and y for n-side)
- corner handles (nw/ne/se/sw) compose two
- min size 0.005 fraction; x+w / y+h clamped to [0, 1]

Optimistic dispBbox while dragging shows live resize preview before
the on-pointer-up onPatchBbox call.

Frontend: BboxOverlay 11 -> 15."
```

---

### Task 8: Rubber-band create + floating field-name input + 2 tests

**Files:**
- Modify: `frontend/src/components/workspace/BboxOverlay.tsx` (rubber-band on empty area + name input)
- Modify: `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx` (append 2 tests)

When the user pointer-downs on the overlay's empty area (not on any bbox or
handle), draw a rubber-band rectangle. On pointer-up, if the rectangle is large
enough, show a floating "字段名" input. On Enter → call `onCreateBbox`. On Esc or
input blur → cancel.

- [ ] **Step 1: Append 2 failing tests (RED)**

```tsx
  it("rubber-band drag on empty overlay area shows field-name input on pointer-up", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[]}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
        onPatchBbox={vi.fn()}
        onCreateBbox={onCreate}
      />
    );
    const overlay = screen.getByTestId("bbox-overlay-root");
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(overlay,   { clientX: 300, clientY: 200, pointerId: 1 });

    const input = await screen.findByPlaceholderText(/字段名/);
    const user = userEvent.setup();
    await user.type(input, "test_field{enter}");

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [bboxArg, name] = onCreate.mock.calls[0];
    expect(name).toBe("test_field");
    expect(bboxArg).toEqual({
      x: expect.closeTo(0.1, 3),
      y: expect.closeTo(0.071, 2),
      w: expect.closeTo(0.2, 3),
      h: expect.closeTo(0.071, 2),
      page: 0,
    });
  });

  it("rubber-band smaller than 0.05% page area is cancelled silently", async () => {
    const onCreate = vi.fn();
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[]}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
        onPatchBbox={vi.fn()}
        onCreateBbox={onCreate}
      />
    );
    const overlay = screen.getByTestId("bbox-overlay-root");
    // 5px x 5px = 25px², way under 0.0005 * 1000 * 1400 = 700px²
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 105, clientY: 105, pointerId: 1 });
    fireEvent.pointerUp(overlay,   { clientX: 105, clientY: 105, pointerId: 1 });

    expect(screen.queryByPlaceholderText(/字段名/)).not.toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });
```

Note: `expect.closeTo` requires vitest 1.0+. If unavailable, replace with manual
checks like `expect(Math.abs(bboxArg.x - 0.1)).toBeLessThan(0.005)`.

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -15
```
Expected: 2 failures (testid `bbox-overlay-root` not found; or input never rendered).

- [ ] **Step 3: Add rubber-band + name input**

In `BboxOverlay.tsx`, add a third drag-state and state for the pending creation:

```tsx
interface RubberState {
  origin: { x: number; y: number };
  current: { x: number; y: number };
  active: boolean;
}

interface PendingCreate {
  bbox: BoundingBox;
}
```

In the component body (after `resize` state):

```tsx
const [rubber, setRubber] = useState<RubberState | null>(null);
const [pending, setPending] = useState<PendingCreate | null>(null);
const [pendingName, setPendingName] = useState("");
```

Add the overlay-root pointer handlers (these run when target===currentTarget — so
clicks on bbox bodies don't trigger):

```tsx
function handleRootPointerDown(e: React.PointerEvent<HTMLDivElement>) {
  if (e.target !== e.currentTarget) return;
  setRubber({
    origin: { x: e.clientX, y: e.clientY },
    current: { x: e.clientX, y: e.clientY },
    active: true,
  });
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function handleRootPointerMove(e: React.PointerEvent<HTMLDivElement>) {
  if (!rubber) return;
  setRubber({ ...rubber, current: { x: e.clientX, y: e.clientY } });
}

function handleRootPointerUp(e: React.PointerEvent<HTMLDivElement>) {
  if (!rubber) return;
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  const ox = rubber.origin.x;
  const oy = rubber.origin.y;
  const cx = rubber.current.x;
  const cy = rubber.current.y;
  setRubber(null);
  const xPx = Math.min(ox, cx);
  const yPx = Math.min(oy, cy);
  const wPx = Math.abs(cx - ox);
  const hPx = Math.abs(cy - oy);
  // Reject tiny rubber-bands
  const areaFrac = (wPx / pageRect.width) * (hPx / pageRect.height);
  if (areaFrac < 0.0005) return;
  const bbox: BoundingBox = {
    x: clamp(xPx / pageRect.width, 0, 1),
    y: clamp(yPx / pageRect.height, 0, 1),
    w: Math.min(wPx / pageRect.width, 1),
    h: Math.min(hPx / pageRect.height, 1),
    page: pageNumber - 1,
  };
  setPending({ bbox });
  setPendingName("");
}

async function handleCreateConfirm() {
  if (!pending) return;
  const name = pendingName.trim();
  if (!name) {
    setPending(null);
    setPendingName("");
    return;
  }
  try {
    await onCreateBbox(pending.bbox, name);
  } catch (err) {
    console.error("[BboxOverlay] create failed", err);
  } finally {
    setPending(null);
    setPendingName("");
  }
}

function handleCreateCancel() {
  setPending(null);
  setPendingName("");
}
```

Update the root `<div>` to add `data-testid="bbox-overlay-root"` and the new
handlers:

```tsx
<div
  ref={containerRef}
  data-testid="bbox-overlay-root"
  className="absolute inset-0 pointer-events-auto"
  onPointerDown={handleRootPointerDown}
  onPointerMove={handleRootPointerMove}
  onPointerUp={handleRootPointerUp}
  onClick={(e) => {
    if (e.target === e.currentTarget) onSelect(null);
  }}
>
```

Note `pointer-events-auto` here (was `pointer-events-none` in S2b1) so the empty
area receives pointer events. Each bbox `<button>` already has
`pointer-events-auto` and stops propagation correctly.

Render the rubber-band rectangle while active:

```tsx
{rubber && (
  <div
    className="absolute border-2 border-dashed border-[#6366f1] pointer-events-none"
    style={{
      left: Math.min(rubber.origin.x, rubber.current.x) - pageRect.left,
      top: Math.min(rubber.origin.y, rubber.current.y) - pageRect.top,
      width: Math.abs(rubber.current.x - rubber.origin.x),
      height: Math.abs(rubber.current.y - rubber.origin.y),
    }}
  />
)}
```

Render the floating name input when pending:

```tsx
{pending && (
  <div
    className="absolute bg-[#1a1d27] border border-[#6366f1] rounded p-1 pointer-events-auto"
    style={{
      left: `${pending.bbox.x * 100}%`,
      top: `calc(${(pending.bbox.y + pending.bbox.h) * 100}% + 4px)`,
    }}
  >
    <input
      autoFocus
      value={pendingName}
      placeholder="字段名"
      onChange={(e) => setPendingName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") void handleCreateConfirm();
        if (e.key === "Escape") handleCreateCancel();
      }}
      onBlur={handleCreateCancel}
      className="bg-transparent text-sm text-white outline-none px-1"
    />
  </div>
)}
```

Use the active `_onCreateBbox` reference: rename the destructured prop from
`onCreateBbox: _onCreateBbox` back to `onCreateBbox` and remove the `void
_onCreateBbox` line. Same for `pageNumber` (still `void pageNumber`? — actually
now we use it: remove the `void pageNumber` line).

Final destructure:

```tsx
export default function BboxOverlay({
  pageNumber, pageRect, annotations, selectedAnnotationId, onSelect,
  onPatchBbox, onCreateBbox,
}: Props) {
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -10
```
Expected: 17 passed (15 existing + 2 create).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/BboxOverlay.tsx frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx
git commit -m "S2b2/Task 8 (TDD): BboxOverlay rubber-band create + 2 tests

- pointerDown on overlay empty area starts a dashed rubber-band
- pointerUp:
    - if area < 0.05% page: cancel silently
    - else show floating field-name input anchored under the new bbox
- Enter -> onCreateBbox(bbox, name); Esc/blur -> cancel
- bbox.page = pageNumber - 1 (S2a's 0-indexed page convention)

Frontend: BboxOverlay 15 -> 17."
```

---

## Phase E — JsonPreview toggle + transformer wiring

### Task 9: JsonPreview toggle bar + transform integration + 4 tests

**Files:**
- Modify: `frontend/src/components/workspace/JsonPreview.tsx`
- Modify: `frontend/src/components/workspace/__tests__/JsonPreview.test.tsx` (append 4 tests)

JsonPreview accepts annotations + reads `apiFormat` from predict-store. Toggle
buttons set `apiFormat`.

- [ ] **Step 1: Append 4 failing tests (RED)**

In `JsonPreview.test.tsx`, REPLACE the 2 existing tests so the calls pass `annotations` and the toggle UI is exercised. New full test file content:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore, type Annotation } from "../../../stores/predict-store";
import JsonPreview from "../JsonPreview";

const ann = (
  field_name: string, partial: Partial<Annotation> = {}
): Annotation => ({
  id: `${field_name}-id`, document_id: "d-1",
  field_name, field_value: "v", field_type: "string",
  bounding_box: { x: 0, y: 0, w: 0.1, h: 0.05, page: 0 },
  source: "ai_detected", confidence: 0.9, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "", updated_at: "",
  ...partial,
});

beforeEach(() => {
  usePredictStore.setState({ apiFormat: "flat", currentStep: 0 });
});
afterEach(() => vi.clearAllMocks());

describe("JsonPreview", () => {
  it("renders structured_data as flat formatted JSON by default", () => {
    render(<JsonPreview structuredData={{ a: 1, b: "x" }} version={2} annotations={[]} />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it("shows placeholder when data is null", () => {
    render(<JsonPreview structuredData={null} version={null} annotations={[]} />);
    expect(screen.getByText(/尚无 predict 结果/)).toBeInTheDocument();
  });

  it("toggle to Detailed shows {value, confidence, bbox} per field", async () => {
    const user = userEvent.setup();
    render(
      <JsonPreview
        structuredData={{ invoice_number: "INV-1" }}
        version={1}
        annotations={[ann("invoice_number", { confidence: 0.88 })]}
      />
    );
    await user.click(screen.getByRole("button", { name: /Detailed/ }));
    expect(screen.getByText(/"value": "INV-1"/)).toBeInTheDocument();
    expect(screen.getByText(/"confidence": 0.88/)).toBeInTheDocument();
  });

  it("toggle to Grouped partitions buyer/seller/items/meta", async () => {
    const user = userEvent.setup();
    render(
      <JsonPreview
        structuredData={{
          buyer_name: "Acme",
          seller_name: "F9",
          items: [{ q: 1 }],
          invoice_number: "INV-1",
        }}
        version={1}
        annotations={[]}
      />
    );
    await user.click(screen.getByRole("button", { name: /Grouped/ }));
    expect(screen.getByText(/"buyer":/)).toBeInTheDocument();
    expect(screen.getByText(/"seller":/)).toBeInTheDocument();
    expect(screen.getByText(/"line_items":/)).toBeInTheDocument();
    expect(screen.getByText(/"meta":/)).toBeInTheDocument();
  });

  it("clicking a toggle button updates predict-store.apiFormat", async () => {
    const user = userEvent.setup();
    render(<JsonPreview structuredData={{ a: 1 }} version={1} annotations={[]} />);
    await user.click(screen.getByRole("button", { name: /Detailed/ }));
    expect(usePredictStore.getState().apiFormat).toBe("detailed");
    await user.click(screen.getByRole("button", { name: /Grouped/ }));
    expect(usePredictStore.getState().apiFormat).toBe("grouped");
    await user.click(screen.getByRole("button", { name: /Flat/ }));
    expect(usePredictStore.getState().apiFormat).toBe("flat");
  });

  it("highlights the active format button", () => {
    usePredictStore.setState({ apiFormat: "detailed" });
    render(<JsonPreview structuredData={{ a: 1 }} version={1} annotations={[]} />);
    const detailed = screen.getByRole("button", { name: /Detailed/ });
    expect(detailed).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Flat/ })).toHaveAttribute(
      "aria-pressed", "false"
    );
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run JsonPreview 2>&1 | tail -15
```
Expected: 6 failures (annotations prop missing, toggle buttons absent, etc.).

- [ ] **Step 3: Update JsonPreview**

REPLACE `frontend/src/components/workspace/JsonPreview.tsx` content:

```tsx
import { transform, type JsonFormat } from "../../lib/json-formats";
import { usePredictStore, type Annotation } from "../../stores/predict-store";

interface Props {
  structuredData: Record<string, unknown> | null;
  version: number | null;
  annotations: Annotation[];
}

const FORMATS: JsonFormat[] = ["flat", "detailed", "grouped"];
const LABELS: Record<JsonFormat, string> = {
  flat: "Flat",
  detailed: "Detailed",
  grouped: "Grouped",
};

export default function JsonPreview({ structuredData, version, annotations }: Props) {
  const apiFormat = usePredictStore((s) => s.apiFormat);
  const setApiFormat = usePredictStore((s) => s.setApiFormat);

  const transformed = transform(apiFormat, { structuredData, annotations });
  const body =
    transformed === null
      ? null
      : JSON.stringify(transformed, null, 2);

  return (
    <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8]">
          Structured Data{version != null && ` · v${version}`}
        </div>
        <div className="flex gap-1">
          {FORMATS.map((f) => {
            const active = f === apiFormat;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => setApiFormat(f)}
                className={`text-xs px-2 py-0.5 rounded ${
                  active
                    ? "bg-[#6366f1] text-white"
                    : "bg-[#0f1117] text-[#94a3b8] hover:text-white"
                }`}
              >
                {LABELS[f]}
              </button>
            );
          })}
        </div>
      </div>
      {body !== null ? (
        <pre
          className="text-xs leading-relaxed whitespace-pre-wrap text-[#a5f3fc]"
          style={{ fontFamily: "Fira Code, Courier New, monospace" }}
        >
          {body}
        </pre>
      ) : (
        <div className="text-xs text-[#64748b]">尚无 predict 结果</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run JsonPreview 2>&1 | tail -10
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/JsonPreview.tsx frontend/src/components/workspace/__tests__/JsonPreview.test.tsx
git commit -m "S2b2/Task 9 (TDD): JsonPreview toggle bar + transform integration + 4 tests

Adds 3-button toggle (Flat/Detailed/Grouped) bound to predict-store.apiFormat.
Body renders JSON.stringify(transform(apiFormat, {structuredData, annotations})).

Frontend: JsonPreview 2 -> 6."
```

---

## Phase F — AnnotationEditor selection sync

### Task 10: AnnotationEditor reads `selectedAnnotationId` + click-to-select + 4 tests

**Files:**
- Modify: `frontend/src/components/predict/AnnotationEditor.tsx`
- Modify: `frontend/src/components/predict/__tests__/AnnotationEditor.test.tsx` (append 4 tests)

When `selectedAnnotationId` matches a row: indigo border + `scrollIntoView`.
Clicking the row body calls `setSelectedAnnotationId(a.id)`.

- [ ] **Step 1: Append 4 failing tests (RED)**

Open `frontend/src/components/predict/__tests__/AnnotationEditor.test.tsx`. Append
at the bottom (before the final `})` of the outer describe):

```tsx
  it("highlights the row whose id matches selectedAnnotationId", () => {
    usePredictStore.setState({ selectedAnnotationId: "a-2" });
    render(
      <AnnotationEditor
        annotations={[
          {
            id: "a-1", document_id: "d-1", field_name: "field-1",
            field_value: "v1", field_type: "string", bounding_box: null,
            source: "ai_detected", confidence: null, is_ground_truth: false,
            created_by: "u-1", updated_by_user_id: null,
            created_at: "", updated_at: "",
          },
          {
            id: "a-2", document_id: "d-1", field_name: "field-2",
            field_value: "v2", field_type: "string", bounding_box: null,
            source: "ai_detected", confidence: null, is_ground_truth: false,
            created_by: "u-1", updated_by_user_id: null,
            created_at: "", updated_at: "",
          },
        ]}
        onPatch={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
      />
    );
    const row1 = screen.getByText("field-1").closest("[data-row-id]") as HTMLElement;
    const row2 = screen.getByText("field-2").closest("[data-row-id]") as HTMLElement;
    expect(row1.className).not.toMatch(/border-\[#6366f1\]/);
    expect(row2.className).toMatch(/border-\[#6366f1\]/);
  });

  it("clicking a row body sets selectedAnnotationId in store", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={[{
          id: "a-1", document_id: "d-1", field_name: "field-1",
          field_value: "v1", field_type: "string", bounding_box: null,
          source: "ai_detected", confidence: null, is_ground_truth: false,
          created_by: "u-1", updated_by_user_id: null,
          created_at: "", updated_at: "",
        }]}
        onPatch={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
      />
    );
    await user.click(screen.getByText("field-1"));
    expect(usePredictStore.getState().selectedAnnotationId).toBe("a-1");
  });

  it("clicking the value input does NOT trigger row selection", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={[{
          id: "a-1", document_id: "d-1", field_name: "field-1",
          field_value: "v1", field_type: "string", bounding_box: null,
          source: "ai_detected", confidence: null, is_ground_truth: false,
          created_by: "u-1", updated_by_user_id: null,
          created_at: "", updated_at: "",
        }]}
        onPatch={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
      />
    );
    usePredictStore.setState({ selectedAnnotationId: null });
    const input = screen.getByDisplayValue("v1");
    await user.click(input);
    expect(usePredictStore.getState().selectedAnnotationId).toBeNull();
  });

  it("calls scrollIntoView on the selected row when selection changes", () => {
    const scrollFn = vi.fn();
    Element.prototype.scrollIntoView = scrollFn;
    usePredictStore.setState({ selectedAnnotationId: "a-1" });
    render(
      <AnnotationEditor
        annotations={[{
          id: "a-1", document_id: "d-1", field_name: "field-1",
          field_value: "v1", field_type: "string", bounding_box: null,
          source: "ai_detected", confidence: null, is_ground_truth: false,
          created_by: "u-1", updated_by_user_id: null,
          created_at: "", updated_at: "",
        }]}
        onPatch={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
      />
    );
    expect(scrollFn).toHaveBeenCalledWith(
      expect.objectContaining({ block: "nearest" })
    );
  });
```

Also add at the top of the test file (after existing imports):

```tsx
import { usePredictStore } from "../../../stores/predict-store";
```

(If this import already exists, skip.)

If the existing test file imports `userEvent` already, skip — otherwise add:

```tsx
import userEvent from "@testing-library/user-event";
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run AnnotationEditor 2>&1 | tail -15
```
Expected: 4 failures (no border highlight, no scroll, click doesn't update store).

- [ ] **Step 3: Update AnnotationEditor**

REPLACE `frontend/src/components/predict/AnnotationEditor.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import {
  usePredictStore,
  type Annotation, type AnnotationPatch, type NewAnnotation,
} from "../../stores/predict-store";

interface Props {
  annotations: Annotation[];
  onPatch: (id: string, patch: AnnotationPatch) => Promise<Annotation>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (input: NewAnnotation) => Promise<Annotation>;
}

export default function AnnotationEditor({
  annotations, onPatch, onDelete, onAdd,
}: Props) {
  const selectedAnnotationId = usePredictStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = usePredictStore((s) => s.setSelectedAnnotationId);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newType, setNewType] = useState("string");
  const [error, setError] = useState<string | null>(null);

  const selectedRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedAnnotationId]);

  async function handleBlur(a: Annotation, value: string) {
    if (value === a.field_value) return;
    try {
      await onPatch(a.id, { field_value: value });
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "保存失败");
    }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    try {
      await onAdd({ field_name: newName, field_value: newValue, field_type: newType });
      setNewName(""); setNewValue(""); setNewType("string"); setAdding(false);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "添加失败");
    }
  }

  return (
    <div className="space-y-2">
      {annotations.map((a) => {
        const isSelected = selectedAnnotationId === a.id;
        return (
          <div
            key={a.id}
            data-row-id={a.id}
            ref={isSelected ? selectedRowRef : null}
            onClick={() => setSelectedAnnotationId(a.id)}
            className={`flex items-center gap-2 text-sm rounded px-1 py-0.5 cursor-pointer ${
              isSelected ? "border-2 border-[#6366f1] bg-[#1a1d27]" : "border-2 border-transparent"
            }`}
          >
            <span className="text-xs text-[#94a3b8] w-32 truncate" title={a.field_name}>
              {a.field_name}
            </span>
            <input
              type="text"
              defaultValue={a.field_value ?? ""}
              onBlur={(e) => void handleBlur(a, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm focus:border-[#6366f1] outline-none"
            />
            <span className="text-xs">
              {a.source === "ai_detected" ? "🤖" : "✏️"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void onDelete(a.id);
              }}
              className="text-xs text-[#ef4444] hover:underline"
            >
              删除
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="bg-[#0f1117] border border-[#2a2e3d] rounded p-2 space-y-2">
          <label className="block text-xs">
            字段名
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            值
            <input
              value={newValue} onChange={(e) => setNewValue(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            类型
            <select
              value={newType} onChange={(e) => setNewType(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="array">array</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button" onClick={() => void handleAdd()}
              className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded"
            >
              保存
            </button>
            <button
              type="button" onClick={() => setAdding(false)}
              className="text-xs text-[#94a3b8]"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button" onClick={() => setAdding(true)}
          className="text-xs text-[#6366f1] hover:underline"
        >
          + 添加字段
        </button>
      )}

      {error && <div className="text-xs text-[#ef4444]">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run AnnotationEditor 2>&1 | tail -10
```
Expected: existing AnnotationEditor tests + 4 new = pass count grows by 4.

(The exact pre-existing AnnotationEditor count — verify by running and reading
output. Expected delta: +4.)

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/predict/AnnotationEditor.tsx frontend/src/components/predict/__tests__/AnnotationEditor.test.tsx
git commit -m "S2b2/Task 10 (TDD): AnnotationEditor selection sync + 4 tests

Reads selectedAnnotationId from predict-store, applies indigo border
to the matching row, calls scrollIntoView({block: 'nearest'}) when
the selection changes. Row body click sets the store; input/button
click stopPropagation so editing doesn't fire row selection.

Frontend AnnotationEditor: existing -> existing + 4."
```

---

## Phase G — WorkspacePage integration

### Task 11: WorkspacePage wires StepIndicator + per-page overlay + auto-advance + 3 tests

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx`
- Modify: `frontend/src/pages/__tests__/WorkspacePage.test.tsx` (update preview mocks; append 3 wiring tests)

This task lights everything up:

1. Mounts `<StepIndicator />` between toolbar and the three columns.
2. Replaces the old `<DocumentCanvas><BboxOverlay /></DocumentCanvas>` pattern
   with `overlay` (image branch) + `renderPageOverlay` (PDF branch).
3. Provides `onPatchBbox` and `onCreateBbox` handlers wired to predict-store
   `patchAnnotation` and `addAnnotation` actions.
4. Adds three step auto-advance effects:
   - `result` first becomes truthy and `currentStep <= 1` → `setStep(1)`
   - any `annotations` change driven by user (we approximate: any patch/delete/add) → `setStep(2)`
   - `apiFormat` becomes non-flat → `setStep(3)`
5. Threads `annotations` into JsonPreview.

- [ ] **Step 1: Update existing tests + append 3 wiring tests (RED)**

Open `frontend/src/pages/__tests__/WorkspacePage.test.tsx`. Existing tests already
mock `/preview` returning a Blob (from S2b1 smoke fix). Verify each existing test
that mocks the predict POST also handles the GET annotations call.

In `beforeEach`, also reset `currentStep` and `apiFormat`:

```tsx
beforeEach(() => {
  mock = new MockAdapter(api);
  navigateMock.mockReset();
  usePredictStore.setState({
    results: {}, loading: {}, batchProgress: null,
    selectedAnnotationId: null,
    currentStep: 0,
    apiFormat: "flat",
    processorOverride: "",
    promptOverride: "",
  });
});
```

Append 3 new wiring tests at the bottom of `describe("WorkspacePage", ...)`:

```tsx
  it("auto-advances currentStep to 1 once predict result loads", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1,
      structured_data: { hello: "world" }, inferred_schema: null,
      prompt_used: "p", processor_key: "mock|m", source: "predict",
      created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await waitFor(() => {
      expect(usePredictStore.getState().currentStep).toBe(1);
    });
  });

  it("auto-advances currentStep to 3 when apiFormat changes from flat", async () => {
    // Pre-seed result so the bootstrap doesn't fight us
    usePredictStore.setState({
      results: {
        "d-1": {
          id: "pr-1", document_id: "d-1", version: 1,
          structured_data: { a: 1 }, inferred_schema: null,
          prompt_used: "", processor_key: "mock|m", source: "predict",
          created_by: "u-1", created_at: "",
        },
      },
      currentStep: 1,
    });
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await screen.findByText(/"a": 1/);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Detailed/ }));
    await waitFor(() => {
      expect(usePredictStore.getState().currentStep).toBe(3);
    });
  });

  it("renders StepIndicator showing 6 steps in the workspace", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1, structured_data: {},
      inferred_schema: null, prompt_used: "", processor_key: "mock|m",
      source: "predict", created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    for (const label of ["Upload", "Preview", "Correct", "ApiFormat", "Tune", "GenerateAPI"]) {
      expect(await screen.findByText(new RegExp(label))).toBeInTheDocument();
    }
  });
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run WorkspacePage 2>&1 | tail -15
```
Expected: many failures (StepIndicator absent + DocumentCanvas children prop
removed → bbox overlay gone → JSON renders fine but step never advances).

- [ ] **Step 3: Update WorkspacePage**

REPLACE `frontend/src/pages/WorkspacePage.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";
import AdvancedPanel from "../components/workspace/AdvancedPanel";
import BboxOverlay from "../components/workspace/BboxOverlay";
import DocumentCanvas from "../components/workspace/DocumentCanvas";
import JsonPreview from "../components/workspace/JsonPreview";
import StepIndicator from "../components/workspace/StepIndicator";
import WorkspaceToolbar from "../components/workspace/WorkspaceToolbar";
import AnnotationEditor from "../components/predict/AnnotationEditor";
import {
  usePredictStore,
  type Annotation, type AnnotationPatch, type NewAnnotation,
} from "../stores/predict-store";

interface DocBrief { id: string; filename: string; mime_type?: string; }
interface DocDetail extends DocBrief { mime_type: string; }

type BoundingBox = { x: number; y: number; w: number; h: number; page: number };

export default function WorkspacePage() {
  const { slug, pid } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const docId = searchParams.get("doc");

  const [docs, setDocs] = useState<DocBrief[]>([]);
  const [currentDoc, setCurrentDoc] = useState<DocDetail | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [imgRect, setImgRect] = useState<DOMRect | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = usePredictStore((s) => (docId ? s.results[docId] : null));
  const loading = usePredictStore((s) => (docId ? s.loading[docId] ?? false : false));
  const selectedAnnotationId = usePredictStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = usePredictStore((s) => s.setSelectedAnnotationId);
  const apiFormat = usePredictStore((s) => s.apiFormat);
  const currentStep = usePredictStore((s) => s.currentStep);
  const setStep = usePredictStore((s) => s.setStep);
  const predictSingle = usePredictStore((s) => s.predictSingle);
  const loadAnnotations = usePredictStore((s) => s.loadAnnotations);
  const patchAnnotation = usePredictStore((s) => s.patchAnnotation);
  const deleteAnnotation = usePredictStore((s) => s.deleteAnnotation);
  const addAnnotation = usePredictStore((s) => s.addAnnotation);

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Bootstrap: load docs list, redirect if no ?doc=
  useEffect(() => {
    if (!pid || !slug) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<{ items: DocBrief[] }>(
          `/api/v1/projects/${pid}/documents?page=1&page_size=200`
        );
        if (cancelled) return;
        setDocs(r.data.items);
        if (!docId) {
          if (r.data.items.length === 0) setEmpty(true);
          else navigate(
            `/workspaces/${slug}/projects/${pid}/workspace?doc=${r.data.items[0].id}`,
            { replace: true }
          );
        }
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => { cancelled = true; };
  }, [pid, slug, docId, navigate]);

  // Load doc detail + preview blob
  useEffect(() => {
    if (!pid || !docId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const r = await api.get<DocDetail>(
          `/api/v1/projects/${pid}/documents/${docId}`
        );
        if (cancelled) return;
        setCurrentDoc(r.data);
        const blobResp = await api.get<Blob>(
          `/api/v1/projects/${pid}/documents/${docId}/preview`,
          { responseType: "blob" }
        );
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blobResp.data);
        setPreviewObjectUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pid, docId]);

  // Load annotations + auto-predict
  useEffect(() => {
    if (!pid || !docId) return;
    let cancelled = false;
    async function reloadAnns() {
      if (!docId) return;
      try {
        const arr = await loadAnnotations(docId);
        if (!cancelled) setAnnotations(arr);
      } catch { /* non-fatal */ }
    }
    void (async () => {
      if (!result) {
        try {
          await predictSingle(pid, docId);
        } catch (e) {
          if (!cancelled) setError((e as { message?: string })?.message ?? "Predict failed");
        }
      }
      await reloadAnns();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, docId]);

  // Auto-advance step 1 (Preview) once result loads
  useEffect(() => {
    if (result && currentStep <= 1 && currentStep !== 1) {
      setStep(1);
    }
  }, [result, currentStep, setStep]);

  // Auto-advance step 3 (ApiFormat) when format becomes non-flat
  useEffect(() => {
    if (apiFormat !== "flat" && currentStep < 3) setStep(3);
  }, [apiFormat, currentStep, setStep]);

  function onSwitchDoc(newDocId: string) {
    if (!pid || !slug) return;
    setSelectedAnnotationId(null);
    navigate(`/workspaces/${slug}/projects/${pid}/workspace?doc=${newDocId}`);
  }

  async function handlePatch(id: string, patch: AnnotationPatch): Promise<Annotation> {
    if (!docId) throw new Error("no doc");
    const out = await patchAnnotation(docId, id, patch);
    setAnnotations((arr) => arr.map((a) => (a.id === id ? out : a)));
    if (currentStep < 2) setStep(2);
    return out;
  }

  async function handleDelete(id: string): Promise<void> {
    if (!docId) return;
    await deleteAnnotation(docId, id);
    setAnnotations((arr) => arr.filter((a) => a.id !== id));
    if (currentStep < 2) setStep(2);
  }

  async function handleAdd(input: NewAnnotation): Promise<Annotation> {
    if (!docId) throw new Error("no doc");
    const out = await addAnnotation(docId, input);
    setAnnotations((arr) => [...arr, out]);
    if (currentStep < 2) setStep(2);
    return out;
  }

  async function handlePatchBbox(id: string, bbox: BoundingBox): Promise<void> {
    await handlePatch(id, { bounding_box: bbox } as AnnotationPatch);
  }

  async function handleCreateBbox(bbox: BoundingBox, fieldName: string): Promise<void> {
    await handleAdd({
      field_name: fieldName,
      field_value: "",
      field_type: "string",
      bounding_box: bbox,
    } as NewAnnotation);
  }

  if (empty) {
    return (
      <div className="text-center text-[#94a3b8] py-12">
        <div className="text-sm mb-2">这个 Project 还没有任何文档</div>
        <div className="text-xs text-[#64748b]">请先上传文档</div>
      </div>
    );
  }
  if (error) {
    return <div className="text-center text-[#ef4444] py-12 text-sm">{error}</div>;
  }
  if (!docId || !currentDoc) {
    return <div className="text-center text-[#94a3b8] py-12 text-sm">Loading workspace...</div>;
  }

  const isImage = currentDoc.mime_type.startsWith("image/");
  const annsForPage = (page: number) =>
    annotations.filter((a) => (a.bounding_box?.page ?? 0) === page);

  // For the image branch, observe the rendered image's rect
  const imageOverlay =
    isImage && imgRect ? (
      <BboxOverlay
        pageNumber={1}
        pageRect={imgRect}
        annotations={annsForPage(0)}
        selectedAnnotationId={selectedAnnotationId}
        onSelect={setSelectedAnnotationId}
        onPatchBbox={handlePatchBbox}
        onCreateBbox={handleCreateBbox}
      />
    ) : undefined;

  return (
    <div className="flex flex-col h-full -m-6">
      <WorkspaceToolbar
        workspaceSlug={slug ?? ""}
        projectId={pid ?? ""}
        projectName="Project"
        documents={docs}
        currentDocId={docId}
        onSwitch={onSwitchDoc}
      />
      <StepIndicator />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-3">
          <AdvancedPanel projectId={pid ?? ""} documentId={docId} />
          {loading && !result ? (
            <div className="text-sm text-[#94a3b8] p-4">⏳ Predicting (10-30s)...</div>
          ) : previewObjectUrl ? (
            isImage ? (
              <div className="relative inline-block">
                <img
                  ref={(el) => {
                    imgRef.current = el;
                    if (el) setImgRect(el.getBoundingClientRect());
                  }}
                  src={previewObjectUrl}
                  alt={currentDoc.filename}
                  className="max-w-full block"
                  onLoad={() => imgRef.current && setImgRect(imgRef.current.getBoundingClientRect())}
                />
                {imageOverlay}
              </div>
            ) : (
              <DocumentCanvas
                previewUrl={previewObjectUrl}
                mimeType={currentDoc.mime_type}
                filename={currentDoc.filename}
                renderPageOverlay={(p, rect) => (
                  <BboxOverlay
                    pageNumber={p}
                    pageRect={rect}
                    annotations={annsForPage(p - 1)}
                    selectedAnnotationId={selectedAnnotationId}
                    onSelect={setSelectedAnnotationId}
                    onPatchBbox={handlePatchBbox}
                    onCreateBbox={handleCreateBbox}
                  />
                )}
              />
            )
          ) : (
            <div className="text-sm text-[#94a3b8] p-4">⏳ Loading preview...</div>
          )}
        </div>
        <div className="w-[360px] border-l border-[#2a2e3d] overflow-auto p-3">
          <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-2">
            Fields
          </div>
          <AnnotationEditor
            annotations={annotations}
            onPatch={handlePatch}
            onDelete={handleDelete}
            onAdd={handleAdd}
          />
        </div>
        <div className="w-[380px] border-l border-[#2a2e3d] overflow-auto p-3">
          <JsonPreview
            structuredData={result?.structured_data ?? null}
            version={result?.version ?? null}
            annotations={annotations}
          />
        </div>
      </div>
    </div>
  );
}
```

The image-branch handles `<img>` directly (not via DocumentCanvas) so we can
observe its rect for the BboxOverlay's `pageRect` prop. DocumentCanvas's image
branch is now used only when a caller doesn't need a writable overlay.

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test 2>&1 | tail -5
```
Expected: 195 passed (158 from S2b1-complete - 0 + 8 json-formats + 4 StepIndicator
+ 2 DocumentCanvas refactor + 12 BboxOverlay (2+4+4+2) + 4 JsonPreview + 4
AnnotationEditor + 3 WorkspacePage = 158 + 37 = 195).

If any test fails, run targeted:
```bash
npm test -- --run WorkspacePage 2>&1 | tail -25
```

Most likely issue: react-pdf mock not shared across test files. The
DocumentCanvas test mocks react-pdf locally; WorkspacePage tests don't, so when
WorkspacePage renders DocumentCanvas with a PDF mime, react-pdf's real machinery
runs in jsdom and may print noisy errors. The wiring assertions don't care
because they target Fields/JSON columns, but if a test relies on a specific PDF
test-id, mock react-pdf globally — but for S2b2 the WorkspacePage tests assert
on text rendered in JSON column / StepIndicator, which is independent of PDF
rendering. Verify with a clean run; the noise should be tolerable.

Production build:
```bash
npm run build 2>&1 | tail -3
```
Expected: built (≤500ms or so).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/pages/WorkspacePage.tsx frontend/src/pages/__tests__/WorkspacePage.test.tsx
git commit -m "S2b2/Task 11 (TDD): WorkspacePage wires StepIndicator + per-page overlay + 3 tests

- StepIndicator mounted between toolbar and three-column flex
- Image branch managed inline (img + overlay) so BboxOverlay can observe rect
- PDF branch uses DocumentCanvas.renderPageOverlay; one BboxOverlay per page
- onPatchBbox / onCreateBbox handlers call patchAnnotation / addAnnotation
- 3 step auto-advance effects: result -> 1, edits -> 2, apiFormat!=flat -> 3
- annotations threaded into JsonPreview for detailed mode

Frontend: 158 -> 195. Production build green."
```

---

## Phase H — Smoke + tag

### Task 12: end-to-end smoke + s2b2-complete tag

**Files:** none modified — orchestrator runs Playwright + smoke verification.

This is **the orchestrator's job** (not a subagent task). Steps documented for
consistency.

- [ ] **Step 1: Reset DB + start servers** (using `scripts/run-dev.sh` from S2b1)

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
RESET_DB=1 \
  API_KEY="$API_KEY" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  ./scripts/run-dev.sh
```

Or run `uvicorn` + `npm run dev` separately as in S2b1's smoke.

- [ ] **Step 2: Bootstrap test data via curl**

```bash
BASE=http://127.0.0.1:9000/api/v1
TOKEN=$(curl -s --noproxy '*' -X POST $BASE/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"pass1234","display_name":"Alice"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

WSID=$(curl -s --noproxy '*' -X POST $BASE/workspaces \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Demo","slug":"demo"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

PID=$(curl -s --noproxy '*' -X POST $BASE/workspaces/$WSID/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Receipts","slug":"receipts","template_key":"china_vat"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

ALPHA=/Users/qinqiang02/colab/codespace/ai/doc-intel/testing/test1_honor/3744516.pdf
curl -s --noproxy '*' -X POST $BASE/projects/$PID/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$ALPHA;filename=alpha.pdf;type=application/pdf"
echo "PID=$PID"
```

- [ ] **Step 3: Walk spec §11 acceptance flow with Playwright MCP**

Open browser at `http://localhost:5173/`. Login as alice. Click into Receipts →
click 工作台 on alpha row.

For each step (spec §11.1–§11.11), drive the action via Playwright tools and
capture a snapshot. The 11+1 step list is in spec §11. Step 12 (multi-page
verification) is best-effort: requires a multi-page PDF fixture; if none
available, defer.

- [ ] **Step 4: Run tests + build**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest --tb=no -q 2>&1 | tail -2
# Expected: 126 passed (unchanged)

cd ../frontend
npm test 2>&1 | tail -3
# Expected: ≥195 passed
npm run build 2>&1 | tail -5
# Expected: built
```

- [ ] **Step 5: Stop servers + tag**

```bash
lsof -ti :9000 :5173 2>/dev/null | sort -u | xargs -r kill 2>/dev/null
pkill -f vite 2>/dev/null

cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git tag -a s2b2-complete -m "S2b2 Workspace Interactive Polish complete

UX additions on top of S2b1 three-column workspace:
- StepIndicator (LS-9): 6-step bar with locked Tune/GenerateAPI
- BboxOverlay (LS-2): drag body, 8 resize handles, rubber-band create
  with floating field-name input — all persisting via PATCH/POST annotations
- JsonPreview: 3-format toggle (Flat / Detailed / Grouped) backed by
  pure transformers in lib/json-formats.ts
- AnnotationEditor: bidirectional selection sync with A column via
  predict-store.selectedAnnotationId; scrollIntoView on selection change
- WorkspacePage: per-page BboxOverlay via DocumentCanvas.renderPageOverlay
  (multi-page bbox positioning fix)
- Step auto-advance: result -> Preview, edit -> Correct, format -> ApiFormat

Tests: 321+ (126 backend unchanged + 195+ frontend = +37 net frontend).
Production build green.

Smoke (spec §11) walked end-to-end."

git tag --list | grep complete
```

- [ ] **Step 6: Update memory**

Edit `/Users/qinqiang02/.claude/projects/-Users-qinqiang02-colab-codespace-ai-label-studio/memory/project_doc_intel_redesign.md`
to mark S2b2 status: completed.

---

## Self-review

**1. Spec coverage check:**

| Spec section | Tasks |
|---|---|
| §4 Architecture (file map) | T1 (json-formats), T2 (StepIndicator), T3 (DocumentCanvas), T4-T8 (BboxOverlay), T9 (JsonPreview), T10 (AnnotationEditor), T11 (WorkspacePage) |
| §5.1 StepIndicator | T2 |
| §5.2 DocumentCanvas refactor | T3 |
| §5.3 BboxOverlay drag/resize/create | T4 (props), T5 (handles), T6 (drag), T7 (resize), T8 (rubber-band) |
| §5.4 JSON transformers | T1 |
| §5.5 JsonPreview toggle | T9 |
| §5.6 AnnotationEditor sync | T10 |
| §5.7 WorkspacePage updates | T11 |
| §6 Data model unchanged | (no task — by construction) |
| §7 Error handling | T6 (catch + console.error), T8 (catch), T9 (NA) |
| §8 Test counts | All tasks contribute; 195 target hit at end of T11 |
| §9 Out of scope | (no task — by construction) |
| §11 Smoke | T12 |

No gaps found.

**2. Placeholder scan:** No `TBD`, `TODO`, `implement later`, or
"add validation as needed". Every step has runnable code or runnable commands.

**3. Type consistency:**

- `BoundingBox` shape `{x, y, w, h, page}` consistent across T6/T7/T8/T11.
- `Annotation` type imports from `predict-store` consistently.
- `JsonFormat` literal `"flat" | "detailed" | "grouped"` consistent.
- `pageRect: DOMRect` consistent prop shape.
- `pageNumber` is 1-indexed in component layer; converted to 0-indexed for
  `bbox.page` at the BboxOverlay create-call site (T8).
- Function names: `setStep`, `setApiFormat`, `setSelectedAnnotationId`,
  `patchAnnotation`, `addAnnotation`, `loadAnnotations` — all match
  predict-store names from S2b1/T1.

No inconsistencies found.

---

**Total: 12 tasks, ≈20h.** Acceptance via spec §11 smoke in T12.

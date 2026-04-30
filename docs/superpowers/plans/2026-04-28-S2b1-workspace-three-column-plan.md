# S2b1 — Workspace Three-Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **TDD is mandatory** — every code unit must have its failing test written first, observed RED, then GREEN.

**Goal:** Replace S2a's PredictModal with a three-column workspace UX at `/workspaces/:slug/projects/:pid/workspace?doc=:did`: PDF/image rendering with read-only bbox overlay (left), reused AnnotationEditor (middle), raw JSON preview (right), document switcher + Next Unreviewed in toolbar, and ⚙️ advanced panel for per-predict processor/prompt override.

**Architecture:** Pure frontend reorganization. No backend changes. Routes added to `App.tsx`. New `WorkspacePage` composes existing `AnnotationEditor` plus new components: `DocumentCanvas` (react-pdf + image), `BboxOverlay` (absolute-positioned divs over rendered document), `WorkspaceToolbar` (dropdown + prev/next), `AdvancedPanel` (processor/prompt override), `JsonPreview` (raw JSON). Three-way binding via `selectedAnnotationId` in predict-store; click bbox / field / JSON path syncs across columns. PredictModal deleted; ProjectDocumentsPage row buttons re-route to workspace.

**Tech Stack:** Vite 8 + React 19 + Zustand + react-router 6 + react-pdf 9 + axios + vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-04-28-S2b1-workspace-three-column-design.md`
**LS-features cross-spec:** `docs/superpowers/specs/2026-04-27-ls-features-to-preserve.md`
**Repo root:** `/Users/qinqiang02/colab/codespace/ai/doc-intel/`
**Baseline:** tag `s2a-complete` (126 backend + 129 frontend = 255 tests)
**Target:** ≥126 backend (unchanged) + ≥148 frontend = ≥274 tests

---

## Phase A — Store + cleanup

### Task 1: predict-store增量 + 5 new tests

**Files:**
- Modify: `frontend/src/stores/predict-store.ts` (add 5 fields + setters)
- Modify: `frontend/src/stores/__tests__/predict-store.test.ts` (5 new tests)

- [ ] **Step 1: Add failing tests (RED)**

Open `frontend/src/stores/__tests__/predict-store.test.ts`. Find the existing `beforeEach` and update the reset to include new fields:

```typescript
beforeEach(() => {
  mock = new MockAdapter(api);
  usePredictStore.setState({
    loading: {}, results: {}, batchProgress: null,
    selectedAnnotationId: null,
    currentStep: 0,
    apiFormat: "flat",
    processorOverride: "",
    promptOverride: "",
  });
});
```

Then at the bottom of the existing `describe("predict-store", ...)` block (before the closing `})`), add:

```typescript
  describe("workspace state (S2b1 additions)", () => {
    it("setSelectedAnnotationId updates state", () => {
      usePredictStore.getState().setSelectedAnnotationId("a-1");
      expect(usePredictStore.getState().selectedAnnotationId).toBe("a-1");
      usePredictStore.getState().setSelectedAnnotationId(null);
      expect(usePredictStore.getState().selectedAnnotationId).toBeNull();
    });

    it("setStep updates currentStep", () => {
      usePredictStore.getState().setStep(2);
      expect(usePredictStore.getState().currentStep).toBe(2);
    });

    it("setApiFormat updates apiFormat", () => {
      usePredictStore.getState().setApiFormat("detailed");
      expect(usePredictStore.getState().apiFormat).toBe("detailed");
    });

    it("setProcessorOverride updates processorOverride", () => {
      usePredictStore.getState().setProcessorOverride("openai|gpt-4o");
      expect(usePredictStore.getState().processorOverride).toBe("openai|gpt-4o");
    });

    it("setPromptOverride updates promptOverride", () => {
      usePredictStore.getState().setPromptOverride("custom prompt");
      expect(usePredictStore.getState().promptOverride).toBe("custom prompt");
    });
  });
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -10
```
Expected: 5 new failures (state fields don't exist).

- [ ] **Step 3: Add fields + setters to predict-store.ts**

Open `frontend/src/stores/predict-store.ts`. Find the `PredictState` interface and add these fields (after `batchProgress`):

```typescript
  selectedAnnotationId: string | null;
  currentStep: 0 | 1 | 2 | 3;
  apiFormat: "flat" | "detailed" | "grouped";
  processorOverride: string;
  promptOverride: string;
  setSelectedAnnotationId: (id: string | null) => void;
  setStep: (step: 0 | 1 | 2 | 3) => void;
  setApiFormat: (f: "flat" | "detailed" | "grouped") => void;
  setProcessorOverride: (s: string) => void;
  setPromptOverride: (s: string) => void;
```

In the `create<PredictState>((set, get) => ({...}))` body, add to the initial state:

```typescript
  selectedAnnotationId: null,
  currentStep: 0,
  apiFormat: "flat",
  processorOverride: "",
  promptOverride: "",

  setSelectedAnnotationId: (id) => set({ selectedAnnotationId: id }),
  setStep: (step) => set({ currentStep: step }),
  setApiFormat: (f) => set({ apiFormat: f }),
  setProcessorOverride: (s) => set({ processorOverride: s }),
  setPromptOverride: (s) => set({ promptOverride: s }),
```

- [ ] **Step 4: Run (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run predict-store 2>&1 | tail -10
```
Expected: 13 passed (8 original + 5 new).

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 134 passed (129 + 5).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/stores/predict-store.ts frontend/src/stores/__tests__/predict-store.test.ts
git commit -m "S2b1/Task 1 (TDD): predict-store workspace state + 5 tests

5 new fields + setters:
- selectedAnnotationId (three-column linkage)
- currentStep (state for S2b2 StepIndicator UI)
- apiFormat (state for S2b2 format toggle)
- processorOverride / promptOverride (LS-3 — used by AdvancedPanel)

Frontend baseline 129 → 134."
```

---

### Task 2: Delete PredictModal + ProjectDocumentsPage button rewire + tests update

**Files:**
- Delete: `frontend/src/components/predict/PredictModal.tsx`
- Delete: `frontend/src/components/predict/__tests__/PredictModal.test.tsx`
- Modify: `frontend/src/pages/ProjectDocumentsPage.tsx` (Predict button → 工作台 navigation; Next Unreviewed → workspace navigation)
- Modify: `frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx` (rewrite 3 affected tests)

S2a's PredictModal is removed; workspace replaces it. ProjectDocumentsPage row buttons now navigate to `/workspaces/:slug/projects/:pid/workspace?doc=:did` instead of opening modal.

- [ ] **Step 1: Update ProjectDocumentsPage tests (RED)**

Open `frontend/src/pages/__tests__/ProjectDocumentsPage.test.tsx`. Find the existing tests:
- `it("clicking Predict on a row opens PredictModal", ...)` — REPLACE with the version below
- `it("Next Unreviewed: 404 shows toast/alert and no modal opens", ...)` — REPLACE with the version below

```typescript
  it("clicking 工作台 on a row navigates to workspace URL", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1", "x.pdf"),
    ]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("x.pdf");
    await user.click(screen.getByRole("button", { name: /^工作台$/ }));
    expect(navigateMock).toHaveBeenCalledWith(
      "/workspaces/demo/projects/p-1/workspace?doc=d-1"
    );
  });

  it("Next Unreviewed navigates to workspace when found", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    mock.onGet("/api/v1/projects/p-1/documents/next-unreviewed").reply(200, {
      id: "d-99", filename: "next.pdf",
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("d-1.pdf");
    await user.click(screen.getByRole("button", { name: /Next Unreviewed/i }));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        "/workspaces/demo/projects/p-1/workspace?doc=d-99"
      )
    );
  });

  it("Next Unreviewed 404 alerts and does not navigate to workspace", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/next-unreviewed").reply(404, {
      error: { code: "no_unreviewed_documents", message: "all done" },
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("d-1.pdf");
    await user.click(screen.getByRole("button", { name: /Next Unreviewed/i }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    // Did NOT navigate to a /workspace URL
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/workspace?doc=")
    );
    alertSpy.mockRestore();
  });
```

The existing test that must stay (verifying Batch Predict button disabled when no rows selected) — keep it as-is.

The previously-existing test using `useNavigate` mock (`navigateMock`): make sure it's set up. If the existing test file's `vi.mock("react-router-dom", ...)` block already exposes `useNavigate: () => navigateMock`, no change is needed. If not, add it now.

Verify the test setup includes (at top of file):

```typescript
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => navigateMock };
});
```

If missing, add it. Also reset in beforeEach: `navigateMock.mockReset();`.

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run ProjectDocumentsPage 2>&1 | tail -10
```
Expected: 3 new failures (button name `工作台` not found; Next Unreviewed not navigating; etc).

- [ ] **Step 3: Modify ProjectDocumentsPage.tsx**

Open `frontend/src/pages/ProjectDocumentsPage.tsx`. Find the existing logic that handles Predict button, batch, and Next Unreviewed.

(a) Remove all references to `PredictModal` and `BatchPredictDrawer` modal state — wait, BatchPredictDrawer stays. Only remove `predictTarget` state + the rendered `<PredictModal />`. The drawer for batch predict stays.

Specifically:
- Remove import of `PredictModal`
- Remove the `useState<{ id; filename } | null>(null)` for predictTarget
- Remove the bottom-of-page `{predictTarget && <PredictModal ... />}` block

(b) Find the `<button>` with text `Predict` in the document row and replace it with:

```tsx
                  <button
                    type="button"
                    onClick={() => current && navigate(
                      `/workspaces/${current.slug}/projects/${pid}/workspace?doc=${d.id}`
                    )}
                    className="text-xs text-[#6366f1] hover:underline mr-3"
                  >
                    工作台
                  </button>
```

The variable name for current workspace in the existing code might differ — search for the existing Predict button to identify the surrounding `current` / `currentSlug` reference. Use whatever variable already references the slug.

(c) Find the existing `onNextUnreviewed` function. Replace its `setPredictTarget(doc)` line with:

```typescript
  async function onNextUnreviewed() {
    if (!pid) return;
    const doc = await loadNextUnreviewed(pid);
    if (doc) {
      // Resolve current workspace slug — same source as the Predict (now 工作台) button
      const slug = current?.slug;  // adjust to existing variable name
      if (slug) {
        navigate(`/workspaces/${slug}/projects/${pid}/workspace?doc=${doc.id}`);
      }
    } else {
      alert("已全部 predict 过");
    }
  }
```

(d) Make sure the file imports `useNavigate` from react-router-dom and calls it once at the top of the component. If the existing code already does this, reuse the same `navigate` variable.

(e) The `predictBatch` import + `BatchPredictDrawer` integration stay unchanged. Multi-select checkbox column stays.

- [ ] **Step 4: Delete PredictModal files**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
rm src/components/predict/PredictModal.tsx
rm src/components/predict/__tests__/PredictModal.test.tsx
```

- [ ] **Step 5: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test 2>&1 | tail -5
```
Expected: 134 - 6 (PredictModal) + 0 (3 ProjectDocumentsPage tests changed but still 3 tests) = **128 passed**. AnnotationEditor's 5 tests stay. Verify no lingering references to PredictModal break compilation.

If a residual import error appears, search and remove:
```bash
grep -rn "PredictModal" frontend/src 2>&1 | grep -v __pycache__
```
should return empty.

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add -A
git commit -m "S2b1/Task 2: delete PredictModal + ProjectDocumentsPage rewires to workspace

- Delete PredictModal.tsx + tests (6 tests)
- Per-row 'Predict' button renamed to '工作台', navigates to
  /workspaces/:slug/projects/:pid/workspace?doc=:did
- 'Next Unreviewed' button: 200 → navigate to workspace; 404 → alert
- BatchPredictDrawer integration preserved (multi-select + batch SSE)
- AnnotationEditor + tests preserved (will be reused in workspace B column)

Frontend tests: 134 → 128 (deleted 6 PredictModal tests)."
```

---

## Phase B — WorkspacePage shell + route

### Task 3: WorkspacePage stub + route + 4 tests

**Files:**
- Create: `frontend/src/pages/WorkspacePage.tsx` (stub renders "loading…" + handles ?doc= fallback)
- Create: `frontend/src/pages/__tests__/WorkspacePage.test.tsx`
- Modify: `frontend/src/App.tsx` (add route + import)
- Modify: `frontend/src/__tests__/App.test.tsx` (1 new test for the new route)

Stub-only: this task wires up routing and `?doc=` fallback. Real columns + canvas etc come in Tasks 4-9.

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/pages/__tests__/WorkspacePage.test.tsx`:

```typescript
import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api-client";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      workspaces: [{ id: "ws-1", name: "Demo", slug: "demo", role: "owner" }],
      currentWorkspaceId: "ws-1",
    }),
}));

import WorkspacePage from "../WorkspacePage";

let mock: MockAdapter;

const docFixture = (id: string, name = `${id}.pdf`) => ({
  id, project_id: "p-1", filename: name, file_path: `${id}.pdf`,
  file_size: 1234, mime_type: "application/pdf", status: "ready",
  is_ground_truth: false, uploaded_by: "u-1",
  created_at: "", updated_at: "", deleted_at: null,
});

beforeEach(() => {
  mock = new MockAdapter(api);
  navigateMock.mockReset();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

function renderPage(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/workspaces/:slug/projects/:pid/workspace"
          element={<WorkspacePage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("WorkspacePage", () => {
  it("renders loading placeholder while bootstrapping", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 1,
    });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    expect(screen.getByText(/Loading workspace|加载中/i)).toBeInTheDocument();
  });

  it("redirects to first document when ?doc= is missing", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-first")], total: 1, page: 1, page_size: 1,
    });
    renderPage("/workspaces/demo/projects/p-1/workspace");
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        "/workspaces/demo/projects/p-1/workspace?doc=d-first",
        { replace: true }
      )
    );
  });

  it("shows empty placeholder when project has no documents", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [], total: 0, page: 1, page_size: 1,
    });
    renderPage("/workspaces/demo/projects/p-1/workspace");
    expect(await screen.findByText(/请先上传文档/)).toBeInTheDocument();
  });

  it("does NOT redirect when ?doc= present even if first doc differs", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-other")], total: 1, page: 1, page_size: 1,
    });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-pinned");
    // No redirect: navigateMock should not have been called
    await new Promise((r) => setTimeout(r, 50));
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.stringContaining("doc=d-other"),
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run WorkspacePage 2>&1 | tail -10
```
Expected: `Cannot find module '../WorkspacePage'`. Capture.

- [ ] **Step 3: Write WorkspacePage stub**

Create `frontend/src/pages/WorkspacePage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";

export default function WorkspacePage() {
  const { slug, pid } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const docId = searchParams.get("doc");
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If ?doc= missing, fetch first document and redirect
  useEffect(() => {
    if (docId || !pid || !slug) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<{ items: { id: string }[] }>(
          `/api/v1/projects/${pid}/documents?page=1&page_size=1`
        );
        if (cancelled) return;
        if (r.data.items.length === 0) {
          setEmpty(true);
          return;
        }
        const firstId = r.data.items[0].id;
        navigate(`/workspaces/${slug}/projects/${pid}/workspace?doc=${firstId}`, {
          replace: true,
        });
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, pid, slug, navigate]);

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
  if (!docId) {
    return <div className="text-center text-[#94a3b8] py-12 text-sm">Loading workspace...</div>;
  }

  // Real three-column layout in Tasks 4-9. For now, placeholder so tests proving
  // routing + ?doc= redirect work pass.
  return (
    <div className="text-center text-[#94a3b8] py-12 text-sm">
      Loading workspace... (doc={docId})
    </div>
  );
}
```

- [ ] **Step 4: Add route to App.tsx**

Open `frontend/src/App.tsx`. Add new import near other page imports:

```typescript
import WorkspacePage from "./pages/WorkspacePage";
```

Inside the protected `<Route element={<ProtectedRoute><AppShell/></ProtectedRoute>}>` block, alongside the existing nested routes, add:

```typescript
<Route
  path="/workspaces/:slug/projects/:pid/workspace"
  element={<WorkspacePage />}
/>
```

Keep all other routes intact (`/dashboard`, `/workspaces/:slug`, `/projects/new`, `/projects/:pid`, `/projects/:pid/settings`).

- [ ] **Step 5: Add 1 test to App.test.tsx**

Open `frontend/src/__tests__/App.test.tsx`. Add a stub mock at the top (near other page mocks):

```typescript
vi.mock("../pages/WorkspacePage", () => ({
  default: () => <div data-testid="page-workspace">workspace</div>,
}));
```

Add a new test in the App routing describe block:

```typescript
  it("/workspaces/:slug/projects/:pid/workspace renders WorkspacePage when authed", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/workspaces/demo/projects/p-1/workspace?doc=d-1");
    render(<App />);
    expect(screen.getByTestId("page-workspace")).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test 2>&1 | tail -3
```
Expected: 133 passed (128 + 4 WorkspacePage + 1 App route = 133).

- [ ] **Step 7: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/pages/WorkspacePage.tsx frontend/src/pages/__tests__/WorkspacePage.test.tsx frontend/src/App.tsx frontend/src/__tests__/App.test.tsx
git commit -m "S2b1/Task 3 (TDD): WorkspacePage stub + route + 5 tests

- New route /workspaces/:slug/projects/:pid/workspace under AppShell
- ?doc= missing → fetch first doc + redirect (replace history)
- Empty project → '请先上传文档' placeholder
- ?doc= present → loading placeholder (real layout in Tasks 4-9)
- 4 WorkspacePage tests + 1 App routing test"
```

---

## Phase C — Document canvas

### Task 4: DocumentCanvas + 4 tests

**Files:**
- Create: `frontend/src/components/workspace/DocumentCanvas.tsx`
- Create: `frontend/src/components/workspace/__tests__/DocumentCanvas.test.tsx`
- Modify: `frontend/src/main.tsx` (set pdfjs worker URL globally — required by react-pdf)

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/components/workspace/__tests__/DocumentCanvas.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock react-pdf to avoid pdfjs worker in jsdom
vi.mock("react-pdf", () => ({
  Document: ({ children, file }: { children: React.ReactNode; file: string }) => (
    <div data-testid="pdf-document" data-file={file}>{children}</div>
  ),
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid="pdf-page" data-page={pageNumber}>Page {pageNumber}</div>
  ),
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
}));

import DocumentCanvas from "../DocumentCanvas";

afterEach(() => vi.clearAllMocks());

describe("DocumentCanvas", () => {
  it("renders <img> for image mime types", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview"
        mimeType="image/png"
        filename="x.png"
      >
        <span data-testid="bbox-overlay">bboxes</span>
      </DocumentCanvas>
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "http://x/preview");
    expect(screen.getByTestId("bbox-overlay")).toBeInTheDocument();
  });

  it("renders react-pdf Document for application/pdf", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview.pdf"
        mimeType="application/pdf"
        filename="x.pdf"
      >
        <span data-testid="bbox-overlay">bboxes</span>
      </DocumentCanvas>
    );
    expect(screen.getByTestId("pdf-document")).toHaveAttribute(
      "data-file",
      "http://x/preview.pdf"
    );
  });

  it("renders unsupported placeholder for xlsx", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview.xlsx"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename="x.xlsx"
      >
        <span data-testid="bbox-overlay">bboxes</span>
      </DocumentCanvas>
    );
    expect(screen.getByText(/暂不支持预览/)).toBeInTheDocument();
    expect(screen.queryByTestId("bbox-overlay")).not.toBeInTheDocument();
  });

  it("renders children (BboxOverlay) inside container for images and PDFs", () => {
    const { rerender } = render(
      <DocumentCanvas
        previewUrl="http://x/p.png"
        mimeType="image/png"
        filename="p.png"
      >
        <span data-testid="overlay">o</span>
      </DocumentCanvas>
    );
    expect(screen.getByTestId("overlay")).toBeInTheDocument();
    rerender(
      <DocumentCanvas
        previewUrl="http://x/p.pdf"
        mimeType="application/pdf"
        filename="p.pdf"
      >
        <span data-testid="overlay">o</span>
      </DocumentCanvas>
    );
    expect(screen.getByTestId("overlay")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run DocumentCanvas 2>&1 | tail -10
```
Expected: `Cannot find module '../DocumentCanvas'`.

- [ ] **Step 3: Implement DocumentCanvas**

Create `frontend/src/components/workspace/DocumentCanvas.tsx`:

```typescript
import { useState, type ReactNode } from "react";
import { Document, Page } from "react-pdf";

interface Props {
  previewUrl: string;
  mimeType: string;
  filename: string;
  children?: ReactNode;  // BboxOverlay (or any overlay) rendered above the document
}

export default function DocumentCanvas({
  previewUrl, mimeType, filename, children,
}: Props) {
  const [numPages, setNumPages] = useState<number>(0);

  if (mimeType.startsWith("image/")) {
    return (
      <div className="relative inline-block">
        <img
          src={previewUrl}
          alt={filename}
          className="max-w-full block"
        />
        {children}
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
            <div key={i} className="relative mb-2 border border-[#2a2e3d]">
              <Page pageNumber={i + 1} renderTextLayer={false} renderAnnotationLayer={false} />
              {/* children renders inside each page container so BboxOverlay can position relative to its page */}
              {/* Note: children is rendered outside per-page in this stub; consumers can pass a Page-aware overlay. */}
            </div>
          ))}
          {children}
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
```

> **Note on multi-page PDFs and BboxOverlay**: The current implementation renders all pages stacked, with BboxOverlay rendered after the last page (single overlay). For S2b1, Annotation.bounding_box defaults to `page=0`, so single-page docs work correctly. Multi-page bbox positioning is deferred to S2b2 (which adds drag/resize and needs per-page overlays anyway). The stub above is sufficient for S2b1.

- [ ] **Step 4: Configure pdfjs worker in main.tsx**

Open `frontend/src/main.tsx`. Add this near the top, after react imports:

```typescript
import { pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();
```

This must run before any react-pdf component mounts. If `main.tsx` already has imports for ReactDOM etc, add these alongside them.

- [ ] **Step 5: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run DocumentCanvas 2>&1 | tail -10
```
Expected: 4 passed.

Run build to catch any pdfjs URL issues:
```bash
npm run build 2>&1 | tail -8
```
Expected: build succeeds.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 137 passed (133 + 4).

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/DocumentCanvas.tsx frontend/src/components/workspace/__tests__/DocumentCanvas.test.tsx frontend/src/main.tsx
git commit -m "S2b1/Task 4 (TDD): DocumentCanvas + pdfjs worker + 4 tests

- image/* → <img>; application/pdf → react-pdf <Document>;
  others → unsupported placeholder
- main.tsx configures pdfjs.GlobalWorkerOptions.workerSrc via Vite URL
- children prop passes through (BboxOverlay rendered by parent)
- jsdom-safe: react-pdf mocked in tests"
```

---

### Task 5: BboxOverlay + 5 tests

**Files:**
- Create: `frontend/src/components/workspace/BboxOverlay.tsx`
- Create: `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx`

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BboxOverlay from "../BboxOverlay";
import type { Annotation } from "../../../stores/predict-store";

const ann = (id: string, partial?: Partial<Annotation>): Annotation => ({
  id, document_id: "d-1", field_name: `field-${id}`,
  field_value: "v", field_type: "string",
  bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 },
  source: "ai_detected", confidence: 0.95, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "", updated_at: "",
  ...partial,
});

describe("BboxOverlay", () => {
  it("renders one absolutely-positioned div per annotation with bbox", () => {
    const annotations = [ann("a-1"), ann("a-2")];
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
      />
    );
    const boxes = screen.getAllByRole("button", { name: /field-/ });
    expect(boxes).toHaveLength(2);
  });

  it("skips annotations without bounding_box", () => {
    const annotations = [
      ann("a-1"),
      ann("a-2", { bounding_box: null }),
    ];
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getAllByRole("button", { name: /field-/ })).toHaveLength(1);
  });

  it("colors bbox border by confidence (high green, low red)", () => {
    const annotations = [
      ann("hi", { confidence: 0.99 }),
      ann("mid", { confidence: 0.92 }),
      ann("lo", { confidence: 0.5 }),
    ];
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
      />
    );
    const hi = screen.getByRole("button", { name: /field-hi/ });
    const mid = screen.getByRole("button", { name: /field-mid/ });
    const lo = screen.getByRole("button", { name: /field-lo/ });
    expect(hi.style.borderColor).toMatch(/22c55e|rgb\(34, 197, 94\)/);
    expect(mid.style.borderColor).toMatch(/f59e0b|rgb\(245, 158, 11\)/);
    expect(lo.style.borderColor).toMatch(/ef4444|rgb\(239, 68, 68\)/);
  });

  it("applies selected style when selectedAnnotationId matches", () => {
    const annotations = [ann("a-1")];
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
      />
    );
    const sel = screen.getByRole("button", { name: /field-a-1/ });
    expect(sel.style.borderColor).toMatch(/6366f1|rgb\(99, 102, 241\)/);
  });

  it("clicking a bbox calls onSelect with annotation id", async () => {
    const onSelect = vi.fn();
    const annotations = [ann("a-1"), ann("a-2")];
    const user = userEvent.setup();
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId={null}
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByRole("button", { name: /field-a-1/ }));
    expect(onSelect).toHaveBeenCalledWith("a-1");
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -10
```
Expected: `Cannot find module '../BboxOverlay'`.

- [ ] **Step 3: Implement BboxOverlay**

Create `frontend/src/components/workspace/BboxOverlay.tsx`:

```typescript
import type { Annotation } from "../../stores/predict-store";

interface Props {
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelect: (id: string | null) => void;
}

const COLOR_SELECTED = "#6366f1";    // indigo
const COLOR_HI = "#22c55e";          // green
const COLOR_MID = "#f59e0b";         // amber
const COLOR_LO = "#ef4444";          // red

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
                backgroundColor: `${color}1f`,  // 12% alpha
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

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run BboxOverlay 2>&1 | tail -10
```
Expected: 5 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 142 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/BboxOverlay.tsx frontend/src/components/workspace/__tests__/BboxOverlay.test.tsx
git commit -m "S2b1/Task 5 (TDD): BboxOverlay + 5 tests

- Absolute-positioned <button> per annotation with bounding_box
- Border color by confidence (≥0.95 green, ≥0.90 amber, else red)
- Selected state: indigo border (4px)
- Click bbox → onSelect(id); click empty area → onSelect(null)
- Field name + confidence label top-left of each box"
```

---

## Phase D — Toolbar + side panels

### Task 6: WorkspaceToolbar + 5 tests

**Files:**
- Create: `frontend/src/components/workspace/WorkspaceToolbar.tsx`
- Create: `frontend/src/components/workspace/__tests__/WorkspaceToolbar.test.tsx`

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/components/workspace/__tests__/WorkspaceToolbar.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import WorkspaceToolbar from "../WorkspaceToolbar";

const onSwitchMock = vi.fn();
const loadNextUnreviewedMock = vi.fn();

const docs = [
  { id: "d-1", filename: "alpha.pdf" },
  { id: "d-2", filename: "beta.pdf" },
  { id: "d-3", filename: "gamma.pdf" },
];

beforeEach(() => {
  onSwitchMock.mockReset();
  loadNextUnreviewedMock.mockReset();
  // Override loadNextUnreviewed in store for tests
  usePredictStore.setState({ loading: {}, results: {}, batchProgress: null });
  vi.spyOn(usePredictStore.getState(), "loadNextUnreviewed").mockImplementation(
    loadNextUnreviewedMock
  );
});

afterEach(() => vi.clearAllMocks());

describe("WorkspaceToolbar", () => {
  it("displays current document filename", () => {
    render(
      <WorkspaceToolbar
        projectId="p-1"
        projectName="Receipts"
        documents={docs}
        currentDocId="d-2"
        onSwitch={onSwitchMock}
      />
    );
    expect(screen.getByText(/beta.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/Receipts/)).toBeInTheDocument();
  });

  it("clicking dropdown shows all documents and selecting calls onSwitch", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceToolbar
        projectId="p-1" projectName="P"
        documents={docs} currentDocId="d-2" onSwitch={onSwitchMock}
      />
    );
    await user.click(screen.getByRole("button", { name: /beta.pdf/ }));
    await user.click(screen.getByRole("button", { name: /gamma.pdf/ }));
    expect(onSwitchMock).toHaveBeenCalledWith("d-3");
  });

  it("Prev button disabled at first doc; Next disabled at last", () => {
    const { rerender } = render(
      <WorkspaceToolbar
        projectId="p-1" projectName="P"
        documents={docs} currentDocId="d-1" onSwitch={onSwitchMock}
      />
    );
    expect(screen.getByRole("button", { name: /上一份/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /下一份/ })).not.toBeDisabled();
    rerender(
      <WorkspaceToolbar
        projectId="p-1" projectName="P"
        documents={docs} currentDocId="d-3" onSwitch={onSwitchMock}
      />
    );
    expect(screen.getByRole("button", { name: /上一份/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /下一份/ })).toBeDisabled();
  });

  it("Prev/Next call onSwitch with neighbor id", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceToolbar
        projectId="p-1" projectName="P"
        documents={docs} currentDocId="d-2" onSwitch={onSwitchMock}
      />
    );
    await user.click(screen.getByRole("button", { name: /下一份/ }));
    expect(onSwitchMock).toHaveBeenCalledWith("d-3");
    await user.click(screen.getByRole("button", { name: /上一份/ }));
    expect(onSwitchMock).toHaveBeenCalledWith("d-1");
  });

  it("Next Unreviewed: 200 calls onSwitch; 404 alerts", async () => {
    const user = userEvent.setup();
    loadNextUnreviewedMock.mockResolvedValueOnce({
      id: "d-99", filename: "next.pdf",
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(
      <WorkspaceToolbar
        projectId="p-1" projectName="P"
        documents={docs} currentDocId="d-2" onSwitch={onSwitchMock}
      />
    );
    await user.click(screen.getByRole("button", { name: /Next Unreviewed/i }));
    expect(onSwitchMock).toHaveBeenCalledWith("d-99");

    loadNextUnreviewedMock.mockResolvedValueOnce(null);
    await user.click(screen.getByRole("button", { name: /Next Unreviewed/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run WorkspaceToolbar 2>&1 | tail -10
```
Expected: `Cannot find module '../WorkspaceToolbar'`.

- [ ] **Step 3: Implement WorkspaceToolbar**

Create `frontend/src/components/workspace/WorkspaceToolbar.tsx`:

```typescript
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  projectId: string;
  projectName: string;
  documents: { id: string; filename: string }[];
  currentDocId: string;
  onSwitch: (docId: string) => void;
}

export default function WorkspaceToolbar({
  projectId, projectName, documents, currentDocId, onSwitch,
}: Props) {
  const navigate = useNavigate();
  const loadNextUnreviewed = usePredictStore((s) => s.loadNextUnreviewed);
  const [open, setOpen] = useState(false);

  const idx = documents.findIndex((d) => d.id === currentDocId);
  const current = idx >= 0 ? documents[idx] : null;
  const prev = idx > 0 ? documents[idx - 1] : null;
  const next = idx >= 0 && idx < documents.length - 1 ? documents[idx + 1] : null;

  async function onNext() {
    const doc = await loadNextUnreviewed(projectId);
    if (doc) {
      onSwitch(doc.id);
    } else {
      alert("已全部 predict 过");
    }
  }

  return (
    <div className="bg-[#1a1d27] border-b border-[#2a2e3d] px-4 py-2 flex items-center gap-3 text-sm">
      <button
        type="button"
        onClick={() => navigate(`/workspaces/demo/projects/${projectId}`)}
        className="text-[#94a3b8] hover:text-[#e2e8f0] flex items-center gap-1"
        title="回到项目列表"
      >
        ◀ <span>{projectName}</span>
      </button>

      <span className="text-[#2a2e3d]">|</span>

      <span className="text-xs">📄</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-1 hover:border-[#6366f1] flex items-center gap-2"
        >
          <span className="font-medium">{current ? current.filename : "(选择文档)"}</span>
          <span className="text-[#64748b]">▾</span>
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-[#1a1d27] border border-[#2a2e3d] rounded shadow-lg z-50 max-h-80 overflow-auto">
            {documents.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onSwitch(d.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#232736] ${
                  d.id === currentDocId ? "text-[#818cf8]" : "text-[#e2e8f0]"
                }`}
              >
                {d.id === currentDocId && "● "}{d.filename}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && onSwitch(prev.id)}
        className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] disabled:opacity-30"
      >
        ← 上一份
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && onSwitch(next.id)}
        className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] disabled:opacity-30"
      >
        下一份 →
      </button>

      <button
        type="button"
        onClick={() => void onNext()}
        className="text-xs text-[#6366f1] hover:underline ml-auto"
      >
        ▶ Next Unreviewed
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run WorkspaceToolbar 2>&1 | tail -10
```
Expected: 5 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 147 passed (142 + 5).

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/WorkspaceToolbar.tsx frontend/src/components/workspace/__tests__/WorkspaceToolbar.test.tsx
git commit -m "S2b1/Task 6 (TDD): WorkspaceToolbar + 5 tests

- Project name + back button to project list
- Document dropdown (current doc highlighted)
- Prev/Next neighbor switch (disabled at boundaries)
- Next Unreviewed: 200 → onSwitch; 404 → alert"
```

---

### Task 7: AdvancedPanel + 4 tests

**Files:**
- Create: `frontend/src/components/workspace/AdvancedPanel.tsx`
- Create: `frontend/src/components/workspace/__tests__/AdvancedPanel.test.tsx`

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/components/workspace/__tests__/AdvancedPanel.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import AdvancedPanel from "../AdvancedPanel";

const predictSingleMock = vi.fn();

beforeEach(() => {
  predictSingleMock.mockReset().mockResolvedValue({});
  usePredictStore.setState({
    loading: {}, results: {}, batchProgress: null,
    selectedAnnotationId: null, currentStep: 0, apiFormat: "flat",
    processorOverride: "", promptOverride: "",
  });
  vi.spyOn(usePredictStore.getState(), "predictSingle").mockImplementation(
    predictSingleMock
  );
});

afterEach(() => vi.clearAllMocks());

describe("AdvancedPanel", () => {
  it("is collapsed by default and expands on click", async () => {
    const user = userEvent.setup();
    render(<AdvancedPanel projectId="p-1" documentId="d-1" />);
    expect(screen.queryByLabelText(/processor/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /高级/ }));
    expect(screen.getByLabelText(/processor/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
  });

  it("Re-predict calls predictSingle without overrides when fields blank", async () => {
    const user = userEvent.setup();
    render(<AdvancedPanel projectId="p-1" documentId="d-1" />);
    await user.click(screen.getByRole("button", { name: /Re-predict/ }));
    expect(predictSingleMock).toHaveBeenCalledWith("p-1", "d-1", {});
  });

  it("Re-predict passes overrides when fields filled", async () => {
    const user = userEvent.setup();
    render(<AdvancedPanel projectId="p-1" documentId="d-1" />);
    await user.click(screen.getByRole("button", { name: /高级/ }));
    await user.type(screen.getByLabelText(/processor/i), "openai|gpt-4o");
    await user.type(screen.getByLabelText(/prompt/i), "custom");
    await user.click(screen.getByRole("button", { name: /Re-predict/ }));
    expect(predictSingleMock).toHaveBeenCalledWith("p-1", "d-1", {
      processorKeyOverride: "openai|gpt-4o",
      promptOverride: "custom",
    });
  });

  it("override values persist in store across remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AdvancedPanel projectId="p-1" documentId="d-1" />);
    await user.click(screen.getByRole("button", { name: /高级/ }));
    await user.type(screen.getByLabelText(/processor/i), "mock");
    unmount();

    expect(usePredictStore.getState().processorOverride).toBe("mock");

    render(<AdvancedPanel projectId="p-1" documentId="d-2" />);
    await user.click(screen.getByRole("button", { name: /高级/ }));
    expect(screen.getByLabelText(/processor/i)).toHaveValue("mock");
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run AdvancedPanel 2>&1 | tail -10
```
Expected: `Cannot find module '../AdvancedPanel'`.

- [ ] **Step 3: Implement AdvancedPanel**

Create `frontend/src/components/workspace/AdvancedPanel.tsx`:

```typescript
import { useState } from "react";
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  projectId: string;
  documentId: string;
}

export default function AdvancedPanel({ projectId, documentId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const processorOverride = usePredictStore((s) => s.processorOverride);
  const promptOverride = usePredictStore((s) => s.promptOverride);
  const setProcessorOverride = usePredictStore((s) => s.setProcessorOverride);
  const setPromptOverride = usePredictStore((s) => s.setPromptOverride);
  const predictSingle = usePredictStore((s) => s.predictSingle);
  const loading = usePredictStore((s) => s.loading[documentId] ?? false);

  async function handleRepredict() {
    const opts: { processorKeyOverride?: string; promptOverride?: string } = {};
    if (processorOverride.trim()) opts.processorKeyOverride = processorOverride.trim();
    if (promptOverride.trim()) opts.promptOverride = promptOverride.trim();
    try {
      await predictSingle(projectId, documentId, opts);
    } catch {
      // error surfaces via store; AdvancedPanel doesn't show inline error
    }
  }

  return (
    <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded mb-3">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] flex items-center gap-1"
        >
          ⚙️ 高级 {expanded ? "▴" : "▾"}
        </button>
        <button
          type="button"
          onClick={() => void handleRepredict()}
          disabled={loading}
          className="text-xs bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold px-3 py-1 rounded disabled:opacity-50"
        >
          {loading ? "Predicting..." : "Re-predict"}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <label className="block text-xs">
            <span className="text-[#94a3b8]">processor key 覆盖</span>
            <input
              type="text"
              aria-label="processor"
              value={processorOverride}
              onChange={(e) => setProcessorOverride(e.target.value)}
              placeholder="如 gemini|gemini-2.5-flash（空 = 用 Project 默认）"
              className="mt-1 w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm font-mono"
            />
          </label>
          <label className="block text-xs">
            <span className="text-[#94a3b8]">prompt 覆盖</span>
            <textarea
              aria-label="prompt"
              value={promptOverride}
              onChange={(e) => setPromptOverride(e.target.value)}
              placeholder="（空 = 用模板默认 prompt）"
              rows={5}
              className="mt-1 w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run AdvancedPanel 2>&1 | tail -10
```
Expected: 4 passed.

Full suite:
```bash
npm test 2>&1 | tail -3
```
Expected: 151 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/AdvancedPanel.tsx frontend/src/components/workspace/__tests__/AdvancedPanel.test.tsx
git commit -m "S2b1/Task 7 (TDD): AdvancedPanel + 4 tests

- Collapsible panel (default collapsed)
- processor_key + prompt override inputs (LS-3)
- Re-predict button passes non-blank overrides to predictSingle
- Override values bound to predict-store, persist across documents"
```

---

### Task 8: JsonPreview + 2 tests

**Files:**
- Create: `frontend/src/components/workspace/JsonPreview.tsx`
- Create: `frontend/src/components/workspace/__tests__/JsonPreview.test.tsx`

- [ ] **Step 1: Write failing tests (RED)**

Create `frontend/src/components/workspace/__tests__/JsonPreview.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import JsonPreview from "../JsonPreview";

describe("JsonPreview", () => {
  it("renders structured_data as formatted JSON", () => {
    render(<JsonPreview structuredData={{ a: 1, b: "x" }} version={2} />);
    const pre = screen.getByText(/"a": 1/);
    expect(pre).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it("shows placeholder when data is null", () => {
    render(<JsonPreview structuredData={null} version={null} />);
    expect(screen.getByText(/尚无 predict 结果/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run JsonPreview 2>&1 | tail -10
```
Expected: `Cannot find module '../JsonPreview'`.

- [ ] **Step 3: Implement JsonPreview**

Create `frontend/src/components/workspace/JsonPreview.tsx`:

```typescript
interface Props {
  structuredData: Record<string, unknown> | null;
  version: number | null;
}

export default function JsonPreview({ structuredData, version }: Props) {
  return (
    <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-3 overflow-auto h-full">
      <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-2">
        Structured Data{version != null && ` · v${version}`}
      </div>
      {structuredData ? (
        <pre
          className="text-xs leading-relaxed whitespace-pre-wrap text-[#a5f3fc]"
          style={{ fontFamily: "Fira Code, Courier New, monospace" }}
        >
          {JSON.stringify(structuredData, null, 2)}
        </pre>
      ) : (
        <div className="text-xs text-[#64748b]">尚无 predict 结果</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run JsonPreview 2>&1 | tail -10
```
Expected: 2 passed. Full suite: 153 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/components/workspace/JsonPreview.tsx frontend/src/components/workspace/__tests__/JsonPreview.test.tsx
git commit -m "S2b1/Task 8 (TDD): JsonPreview raw + 2 tests

- Renders structuredData as JSON.stringify(...) inside <pre>
- Shows version label (e.g. v2) when present
- Placeholder when data null
- Format toggle (flat/detailed/grouped) deferred to S2b2"
```

---

## Phase E — Wire WorkspacePage

### Task 9: WorkspacePage full implementation + 5 wiring tests

**Files:**
- Modify: `frontend/src/pages/WorkspacePage.tsx` (replace stub with real three-column layout)
- Modify: `frontend/src/pages/__tests__/WorkspacePage.test.tsx` (add 5 wiring tests)
- Modify: `frontend/src/components/layout/AppShell.tsx` (`S0` → `S2b` cosmetic)
- Modify: `frontend/src/components/layout/__tests__/AppShell.test.tsx` (update 1 assertion)

- [ ] **Step 1: Add 5 failing wiring tests + replace stub assertion (RED)**

Open `frontend/src/pages/__tests__/WorkspacePage.test.tsx`. Update the existing test "renders loading placeholder while bootstrapping" to a more specific assertion:

```typescript
  it("renders three-column layout once doc is fetched", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet("/api/v1/projects/p-1/documents/d-1/preview").reply(200, "");
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1,
      structured_data: { hello: "world" }, inferred_schema: { hello: "string" },
      prompt_used: "p", processor_key: "mock|m", source: "predict",
      created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    expect(await screen.findByText(/hello/)).toBeInTheDocument();  // C 栏 JSON
  });
```

Add 4 more new tests at the bottom of the existing describe block:

```typescript
  it("loads annotations into B column", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet("/api/v1/projects/p-1/documents/d-1/preview").reply(200, "");
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [{
      id: "a-1", document_id: "d-1", field_name: "invoice_no",
      field_value: "INV-001", field_type: "string", bounding_box: null,
      source: "ai_detected", confidence: null, is_ground_truth: false,
      created_by: "u-1", updated_by_user_id: null,
      created_at: "", updated_at: "",
    }]);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1, structured_data: {},
      inferred_schema: null, prompt_used: "", processor_key: "mock|m",
      source: "predict", created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    expect(await screen.findByDisplayValue("INV-001")).toBeInTheDocument();
  });

  it("auto-triggers predict when no cached result", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet("/api/v1/projects/p-1/documents/d-1/preview").reply(200, "");
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1, structured_data: { ok: true },
      inferred_schema: null, prompt_used: "", processor_key: "mock|m",
      source: "predict", created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await waitFor(() =>
      expect(mock.history.post.length).toBeGreaterThanOrEqual(1)
    );
  });

  it("does NOT trigger predict when result already cached", async () => {
    const { usePredictStore } = await import("../../stores/predict-store");
    usePredictStore.setState({
      results: {
        "d-1": {
          id: "pr-cached", document_id: "d-1", version: 5,
          structured_data: { cached: true }, inferred_schema: null,
          prompt_used: "", processor_key: "mock|m", source: "predict",
          created_by: "u-1", created_at: "",
        },
      },
    } as never);

    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet("/api/v1/projects/p-1/documents/d-1/preview").reply(200, "");
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [docFixture("d-1")], total: 1, page: 1, page_size: 20,
    });

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await screen.findByText(/cached/);
    expect(mock.history.post.length).toBe(0);
  });

  it("toolbar dropdown switches doc via URL navigation", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet("/api/v1/projects/p-1/documents/d-1/preview").reply(200, "");
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      id: "pr-1", document_id: "d-1", version: 1, structured_data: {},
      inferred_schema: null, prompt_used: "", processor_key: "mock|m",
      source: "predict", created_by: "u-1", created_at: "",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, {
      items: [
        docFixture("d-1", "alpha.pdf"),
        docFixture("d-2", "beta.pdf"),
      ], total: 2, page: 1, page_size: 20,
    });
    const user = userEvent.setup();

    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await screen.findByText(/alpha.pdf/);
    await user.click(screen.getByRole("button", { name: /alpha.pdf/ }));
    await user.click(screen.getByRole("button", { name: /beta.pdf/ }));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        "/workspaces/demo/projects/p-1/workspace?doc=d-2"
      )
    );
  });
```

Make sure the test file's top-level imports include:

```typescript
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
```

(merge with existing `@testing-library/react` import).

- [ ] **Step 2: Run (RED)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test -- --run WorkspacePage 2>&1 | tail -15
```
Expected: 5 of the new tests fail (stub returns generic loading text). Capture.

- [ ] **Step 3: Replace WorkspacePage with real implementation**

REPLACE `frontend/src/pages/WorkspacePage.tsx`:

```typescript
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";
import AdvancedPanel from "../components/workspace/AdvancedPanel";
import BboxOverlay from "../components/workspace/BboxOverlay";
import DocumentCanvas from "../components/workspace/DocumentCanvas";
import JsonPreview from "../components/workspace/JsonPreview";
import WorkspaceToolbar from "../components/workspace/WorkspaceToolbar";
import AnnotationEditor from "../components/predict/AnnotationEditor";
import {
  usePredictStore,
  type Annotation,
  type AnnotationPatch,
  type NewAnnotation,
} from "../stores/predict-store";

interface DocBrief {
  id: string;
  filename: string;
  mime_type?: string;
}

interface DocDetail extends DocBrief {
  mime_type: string;
}

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:9000";

export default function WorkspacePage() {
  const { slug, pid } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const docId = searchParams.get("doc");

  const [docs, setDocs] = useState<DocBrief[]>([]);
  const [currentDoc, setCurrentDoc] = useState<DocDetail | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = usePredictStore((s) => (docId ? s.results[docId] : null));
  const loading = usePredictStore((s) => (docId ? s.loading[docId] ?? false : false));
  const selectedAnnotationId = usePredictStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = usePredictStore((s) => s.setSelectedAnnotationId);
  const predictSingle = usePredictStore((s) => s.predictSingle);
  const loadAnnotations = usePredictStore((s) => s.loadAnnotations);
  const patchAnnotation = usePredictStore((s) => s.patchAnnotation);
  const deleteAnnotation = usePredictStore((s) => s.deleteAnnotation);
  const addAnnotation = usePredictStore((s) => s.addAnnotation);

  // 1) Bootstrap: load documents list; if ?doc= missing, redirect to first
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
          if (r.data.items.length === 0) {
            setEmpty(true);
          } else {
            navigate(
              `/workspaces/${slug}/projects/${pid}/workspace?doc=${r.data.items[0].id}`,
              { replace: true }
            );
          }
        }
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pid, slug, docId, navigate]);

  // 2) Load current doc detail (for mime_type)
  useEffect(() => {
    if (!pid || !docId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<DocDetail>(
          `/api/v1/projects/${pid}/documents/${docId}`
        );
        if (!cancelled) setCurrentDoc(r.data);
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pid, docId]);

  // 3) Auto-trigger predict if no cached result; load annotations either way
  useEffect(() => {
    if (!pid || !docId) return;
    let cancelled = false;
    async function reloadAnns() {
      if (!docId) return;
      try {
        const arr = await loadAnnotations(docId);
        if (!cancelled) setAnnotations(arr);
      } catch {
        // non-fatal
      }
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, docId]);

  function onSwitchDoc(newDocId: string) {
    if (!pid || !slug) return;
    setSelectedAnnotationId(null);
    navigate(`/workspaces/${slug}/projects/${pid}/workspace?doc=${newDocId}`);
  }

  async function handlePatch(id: string, patch: AnnotationPatch): Promise<Annotation> {
    if (!docId) throw new Error("no doc");
    const out = await patchAnnotation(docId, id, patch);
    setAnnotations((arr) => arr.map((a) => (a.id === id ? out : a)));
    return out;
  }

  async function handleDelete(id: string): Promise<void> {
    if (!docId) return;
    await deleteAnnotation(docId, id);
    setAnnotations((arr) => arr.filter((a) => a.id !== id));
  }

  async function handleAdd(input: NewAnnotation): Promise<Annotation> {
    if (!docId) throw new Error("no doc");
    const out = await addAnnotation(docId, input);
    setAnnotations((arr) => [...arr, out]);
    return out;
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

  const previewUrl = `${API_BASE}/api/v1/projects/${pid}/documents/${docId}/preview`;

  return (
    <div className="flex flex-col h-full -m-6">
      <WorkspaceToolbar
        projectId={pid ?? ""}
        projectName="Project"
        documents={docs}
        currentDocId={docId}
        onSwitch={onSwitchDoc}
      />
      <div className="flex-1 flex overflow-hidden">
        {/* A column */}
        <div className="flex-1 overflow-auto p-3">
          <AdvancedPanel projectId={pid ?? ""} documentId={docId} />
          {loading && !result ? (
            <div className="text-sm text-[#94a3b8] p-4">⏳ Predicting (10-30s)...</div>
          ) : (
            <DocumentCanvas
              previewUrl={previewUrl}
              mimeType={currentDoc.mime_type}
              filename={currentDoc.filename}
            >
              <BboxOverlay
                annotations={annotations}
                selectedAnnotationId={selectedAnnotationId}
                onSelect={setSelectedAnnotationId}
              />
            </DocumentCanvas>
          )}
        </div>
        {/* B column */}
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
        {/* C column */}
        <div className="w-[380px] border-l border-[#2a2e3d] overflow-auto p-3">
          <JsonPreview
            structuredData={result?.structured_data ?? null}
            version={result?.version ?? null}
          />
        </div>
      </div>
    </div>
  );
}
```

> **Note**: The component uses `-m-6` to negate AppShell's `p-6` main padding so the workspace fills the full viewport. If AppShell padding differs, adjust accordingly.

- [ ] **Step 4: Update AppShell `S0` cosmetic to `S2b`**

Open `frontend/src/components/layout/AppShell.tsx`. Find the badge text `S0` and replace with `S2b`. There should be exactly one occurrence in the banner section.

Open `frontend/src/components/layout/__tests__/AppShell.test.tsx`. Find any test that asserts the `S0` text. If a test asserts the literal `S0`, change to `S2b`. If the test simply asserts the badge exists without checking text, no change needed.

- [ ] **Step 5: Run tests (GREEN)**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/frontend
npm test 2>&1 | tail -3
```
Expected: 158 passed (153 + 5 wiring).

If any test fails: most likely the `WorkspacePage` test expects a specific call shape that the implementation doesn't match. Read the failure carefully and adjust either the test fixture or implementation.

Run `npm run build` to ensure production build succeeds:
```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git add frontend/src/pages/WorkspacePage.tsx frontend/src/pages/__tests__/WorkspacePage.test.tsx frontend/src/components/layout/AppShell.tsx frontend/src/components/layout/__tests__/AppShell.test.tsx
git commit -m "S2b1/Task 9 (TDD): WorkspacePage three-column wire + 5 tests + AppShell badge

Bootstrap flow:
1. Load documents list; if ?doc= missing redirect to first
2. Load current doc detail (mime_type)
3. Load annotations + auto-trigger predict if no cached result

Three columns:
- A: AdvancedPanel + DocumentCanvas + BboxOverlay
- B: AnnotationEditor (reused from S2a, wired to predict-store)
- C: JsonPreview (raw structured_data)

Selected annotation id syncs across columns via predict-store.
AppShell badge S0 → S2b."
```

---

## Phase F — Smoke + tag

### Task 10: end-to-end smoke + s2b1-complete tag

**Files:** none modified — orchestrator runs Playwright + curl + sqlite3 verification.

This is **the orchestrator's job** (not a subagent task). The plan documents the steps so the orchestrator can drive consistently.

- [ ] **Step 1: Reset DB + start servers**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
rm -f data/doc_intel.db data/doc_intel.db-shm data/doc_intel.db-wal
uv run alembic upgrade head
API_KEY="<from /Users/qinqiang02/colab/codespace/ai/label-studio-ml-backend/invoice_extractor/.env>" \
  uv run uvicorn app.main:app --host 127.0.0.1 --port 9000 &

cd ../frontend
npm run dev &
```

- [ ] **Step 2: Walk spec §13 acceptance flow**

1. Register alice + login (via curl + UI)
2. Create workspace + project + upload alpha.pdf + beta.pdf (via curl)
3. Browser → login → click into project → click "工作台" on alpha row
4. Verify URL = `/workspaces/demo/projects/<pid>/workspace?doc=<alpha-did>`
5. Verify three-column layout: A renders PDF (or unsupported placeholder if PDF.js fails on fake content), B renders annotation editor, C renders JSON preview
6. Toolbar shows `📄 alpha.pdf ▾`, ◀ Project name, prev/next buttons, ▶ Next Unreviewed
7. Click toolbar dropdown → see alpha + beta. Click beta → URL changes to `?doc=<beta-did>`, three columns reload
8. Click ◀ Project name → returns to `/workspaces/demo/projects/<pid>` (project documents list)
9. On documents list, verify per-row button text says "工作台" (not "Predict"), batch + next-unreviewed buttons still present, no PredictModal
10. Click "工作台" on beta → workspace
11. Click ⚙️ 高级 → expand → input `processor_key=mock` → click Re-predict → spinner → JSON updates
12. Click an annotation in B column field list → verify B column row gets blue border (selectedAnnotationId state working). If alpha has bbox data, also verify A column bbox highlights.
13. Click "▶ Next Unreviewed" with all docs predicted → alert "已全部 predict 过"

- [ ] **Step 3: Run tests + build**

```bash
cd /Users/qinqiang02/colab/codespace/ai/doc-intel/backend
uv run pytest --tb=no -q 2>&1 | tail -2
# Expected: 126 passed (unchanged)

cd ../frontend
npm test 2>&1 | tail -3
# Expected: ≥148 passed
npm run build 2>&1 | tail -5
# Expected: built in <1s
```

- [ ] **Step 4: Stop servers + tag**

```bash
lsof -ti :9000 | xargs kill 2>/dev/null
pkill -f vite 2>/dev/null

cd /Users/qinqiang02/colab/codespace/ai/doc-intel
git tag -a s2b1-complete -m "S2b1 Workspace Three-Column Static Rendering complete

UX: PredictModal replaced with /workspaces/:slug/projects/:pid/workspace?doc=:did.
Three-column layout: DocumentCanvas (react-pdf + image + bbox readonly overlay)
+ AnnotationEditor (reused) + JsonPreview (raw). WorkspaceToolbar with
document switcher dropdown + prev/next + Next Unreviewed. AdvancedPanel
exposes per-predict processor + prompt override (LS-3 UI). Three-way
selection sync via predict-store.selectedAnnotationId.

Out of scope (→ S2b2): 6-step StepIndicator UI, bbox drag/resize, JSON
format toggle (flat/detailed/grouped).

255 → ~280 tests (126 backend unchanged + 6 PredictModal tests deleted +
~25 new frontend tests = ≈148 frontend)."

git tag --list | grep complete
```

- [ ] **Step 5: Update memory pointer (off-tree)**

Orchestrator updates `/Users/qinqiang02/.claude/projects/-Users-qinqiang02-colab-codespace-ai-label-studio/memory/project_doc_intel_redesign.md` to mark **S2b1 status: completed**.

---

## Self-Review (post-write checklist)

1. **Spec coverage:**
   - §3 PredictModal delete + ProjectDocumentsPage rewires → T2 ✓
   - §4 Routing + ?doc= fallback → T3 ✓
   - §5 Three-column layout → T9 ✓
   - §6 predict-store增量 → T1 + T9 (selectedAnnotationId wired) ✓
   - §7 DocumentCanvas → T4 ✓
   - §8 BboxOverlay → T5 ✓
   - §9 AdvancedPanel → T7 ✓
   - §10 WorkspaceToolbar → T6 ✓
   - §11 JsonPreview → T8 ✓
   - §13 Acceptance smoke → T10 ✓

2. **Placeholders:** None.

3. **Type consistency:** `Annotation` and `Annotation.bounding_box` shapes used identically across BboxOverlay tests, BboxOverlay impl, WorkspacePage wire-up. `predictSingle` signature matches predict-store-test mocks.

**Total: 10 tasks, ≈16h.** Acceptance from spec §13 in T10.

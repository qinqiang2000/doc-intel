import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api-client";
import { usePredictStore, type ProcessingResult, type Annotation } from "../../stores/predict-store";

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

function makeResult(overrides: Partial<ProcessingResult> = {}): ProcessingResult {
  return {
    id: "pr-1", document_id: "d-1", version: 1,
    structured_data: { hello: "world" }, inferred_schema: null,
    prompt_used: "p", processor_key: "mock|m", source: "predict",
    created_by: "u-1", created_at: "",
    ...overrides,
  };
}

function setupBasicMocks(opts: {
  docId?: string;
  results?: ProcessingResult[];
  annotations?: Annotation[];
  docs?: ReturnType<typeof docFixture>[];
} = {}) {
  const docId = opts.docId ?? "d-1";
  const docs = opts.docs ?? [docFixture(docId)];
  mock.onGet(`/api/v1/projects/p-1/documents/${docId}`).reply(200, docFixture(docId));
  mock.onGet(new RegExp(`${docId}\\/preview$`)).reply(
    200, new Blob(["pdf"], { type: "application/pdf" })
  );
  mock.onGet(`/api/v1/documents/${docId}/annotations`).reply(200, opts.annotations ?? []);
  mock.onGet(`/api/v1/projects/p-1/documents/${docId}/predict/results`)
    .reply(200, opts.results ?? []);
  mock.onGet(/\/api\/v1\/projects\/p-1\/documents(\?.*)?$/).reply(200, {
    items: docs, total: docs.length, page: 1, page_size: 20,
  });
}

beforeEach(() => {
  mock = new MockAdapter(api);
  navigateMock.mockReset();
  usePredictStore.setState({
    results: {}, resultsByDoc: {}, selectedResultByDoc: {},
    loading: {}, batchProgress: null,
    selectedAnnotationId: null,
    currentStep: 0,
    apiFormat: "flat",
    processorOverride: "",
    promptOverride: "",
    promptHistoryOpen: false,
    correctionConsoleOpen: false,
  } as never);
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
  it("renders three-column layout once doc + stored result load", async () => {
    setupBasicMocks({ results: [makeResult({ structured_data: { hello: "world" } })] });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    expect(await screen.findByText(/hello/)).toBeInTheDocument();
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
    await new Promise((r) => setTimeout(r, 50));
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.stringContaining("doc=d-other"),
      expect.anything()
    );
  });

  it("loads annotations into B column", async () => {
    setupBasicMocks({
      annotations: [{
        id: "a-1", document_id: "d-1", field_name: "invoice_no",
        field_value: "INV-001", field_type: "string", bounding_box: null,
        source: "ai_detected", confidence: null, is_ground_truth: false,
        created_by: "u-1", updated_by_user_id: null,
        created_at: "", updated_at: "",
      }],
    });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    expect(await screen.findByDisplayValue("INV-001")).toBeInTheDocument();
  });

  it("does NOT auto-predict on doc click when no stored results", async () => {
    setupBasicMocks({ results: [] });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    expect(await screen.findByText(/No predictions yet/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.history.post.filter((c) => /\/predict$/.test(c.url ?? "")).length).toBe(0);
  });

  it("loads stored results from backend without re-predicting", async () => {
    setupBasicMocks({
      results: [makeResult({
        id: "pr-stored", version: 3,
        structured_data: { stored_field: "from_backend" },
      })],
    });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await screen.findByText(/from_backend/);
    expect(mock.history.post.filter((c) => /\/predict$/.test(c.url ?? "")).length).toBe(0);
  });

  it("renders one tab per stored result and switches between them", async () => {
    setupBasicMocks({
      results: [
        makeResult({
          id: "pr-2", version: 2, processor_key: "gpt-4|gpt-4o",
          structured_data: { variant: "second" },
        }),
        makeResult({
          id: "pr-1", version: 1, processor_key: "gemini|gemini-2.5-flash",
          structured_data: { variant: "first" },
        }),
      ],
    });
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await screen.findByText(/second/);
    expect(screen.getByRole("button", { name: /gpt-4\|gpt-4o/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /gemini\|gemini-2.5-flash/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /gemini\|gemini-2.5-flash/ }));
    await screen.findByText(/first/);
  });

  it("clicking Run prediction in tabs triggers predictSingle", async () => {
    setupBasicMocks({ results: [] });
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, makeResult({
      id: "pr-new", version: 1, structured_data: { just_run: true },
    }));
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    const runBtn = await screen.findByRole("button", { name: /Run prediction/i });
    await user.click(runBtn);
    await waitFor(() =>
      expect(mock.history.post.some((c) => /\/predict$/.test(c.url ?? ""))).toBe(true)
    );
    await screen.findByText(/just_run/);
  });

  it("toolbar dropdown switches doc via URL navigation", async () => {
    setupBasicMocks({
      docs: [docFixture("d-1", "alpha.pdf"), docFixture("d-2", "beta.pdf")],
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

  it("auto-advances currentStep to 1 once a stored result loads", async () => {
    setupBasicMocks({ results: [makeResult({ structured_data: { hello: "world" } })] });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await waitFor(() => {
      expect(usePredictStore.getState().currentStep).toBe(1);
    });
  });

  it("auto-advances currentStep to 3 when apiFormat changes from flat", async () => {
    setupBasicMocks({ results: [makeResult({ structured_data: { a: 1 } })] });
    usePredictStore.setState({ currentStep: 1 });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    await screen.findByText(/"a": 1/);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Detailed/ }));
    await waitFor(() => {
      expect(usePredictStore.getState().currentStep).toBe(3);
    });
  });

  it("renders StepIndicator showing 6 steps in the workspace", async () => {
    setupBasicMocks();
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    for (const label of ["Upload", "Preview", "Correct", "ApiFormat", "Tune", "GenerateAPI"]) {
      expect(await screen.findByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it("clicking Tune step opens NLCorrectionConsole below", async () => {
    setupBasicMocks({ results: [makeResult({ structured_data: { x: 1 } })] });
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    const tuneBtn = await screen.findByRole("button", { name: /Tune/ });
    await user.click(tuneBtn);
    expect(usePredictStore.getState().correctionConsoleOpen).toBe(true);
    expect(screen.getByPlaceholderText(/自然语言/)).toBeInTheDocument();
  });

  it("clicking 📜 toolbar button opens PromptHistoryPanel", async () => {
    setupBasicMocks();
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, []);
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    const histBtn = await screen.findByRole("button", { name: /📜/ });
    await user.click(histBtn);
    expect(await screen.findByText(/Prompt 历史/)).toBeInTheDocument();
  });

  it("PromptHistoryPanel + NLCorrectionConsole can be open simultaneously", async () => {
    setupBasicMocks();
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, []);
    usePredictStore.setState({
      promptHistoryOpen: true,
      correctionConsoleOpen: true,
    });
    renderPage("/workspaces/demo/projects/p-1/workspace?doc=d-1");
    expect(await screen.findByText(/Prompt 历史/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/自然语言/)).toBeInTheDocument();
  });
});

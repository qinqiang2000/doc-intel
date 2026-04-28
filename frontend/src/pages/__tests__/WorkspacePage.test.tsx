import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api-client";
import { usePredictStore } from "../../stores/predict-store";

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
  usePredictStore.setState({ results: {}, loading: {}, batchProgress: null, selectedAnnotationId: null });
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
  it("renders three-column layout once doc is fetched", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
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
    mock.onGet("/api/v1/projects/p-1/documents/d-1").reply(200, docFixture("d-1"));
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
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
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
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
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
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
    mock.onGet(/d-1\/preview$/).reply(200, new Blob(["pdf"], { type: "application/pdf" }));
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
});

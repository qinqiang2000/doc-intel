import MockAdapter from "axios-mock-adapter";
import { render, screen } from "@testing-library/react";
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

import EvaluatePage from "../EvaluatePage";

let mock: MockAdapter;

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
          path="/workspaces/:slug/projects/:pid/evaluate"
          element={<EvaluatePage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("EvaluatePage", () => {
  it("renders empty state when no evaluations exist", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, []);
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    expect(await screen.findByText(/Run your first evaluation/i)).toBeInTheDocument();
  });

  it("renders Run Evaluation button + back link", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, []);
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    expect(await screen.findByRole("button", { name: /Run Evaluation/i })).toBeInTheDocument();
    expect(screen.getByText(/Back to Project|◀/i)).toBeInTheDocument();
  });

  it("renders run history list with accuracy + counts", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
      {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "first", num_docs: 2, num_fields_evaluated: 10, num_matches: 8,
        accuracy_avg: 0.8, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
    ]);
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByText(/80\.0%/);
    expect(screen.getByText(/2 docs/i)).toBeInTheDocument();
    expect(screen.getByText(/10 fields/i)).toBeInTheDocument();
  });

  it("clicking Run Evaluation POSTs and refreshes list", async () => {
    let listCall = 0;
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(() => {
      listCall++;
      if (listCall === 1) return [200, []];
      return [200, [{
        id: "r-new", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 3, num_matches: 3,
        accuracy_avg: 1.0, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      }]];
    });
    mock.onPost("/api/v1/projects/p-1/evaluations").reply(201, {
      id: "r-new", project_id: "p-1", prompt_version_id: null,
      name: "", num_docs: 1, num_fields_evaluated: 3, num_matches: 3,
      accuracy_avg: 1.0, status: "completed", error_message: null,
      created_by: "u-1", created_at: "",
    });
    mock.onGet("/api/v1/evaluations/r-new").reply(200, {
      run: {
        id: "r-new", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 3, num_matches: 3,
        accuracy_avg: 1.0, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
      fields: [],
    });

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByRole("button", { name: /Run Evaluation/i });
    await user.click(screen.getByRole("button", { name: /Run Evaluation/i }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(screen.getByText(/100\.0%/)).toBeInTheDocument());
  });

  it("clicking 🗑 deletes the run and refreshes list", async () => {
    let listCall = 0;
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(() => {
      listCall++;
      if (listCall === 1) return [200, [{
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
        accuracy_avg: 1, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      }]];
      return [200, []];
    });
    let deleted = false;
    mock.onDelete("/api/v1/evaluations/r-1").reply(() => {
      deleted = true;
      return [204, ""];
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByText(/100\.0%/);
    await user.click(screen.getByTitle(/Delete run/i));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText(/100\.0%/)).not.toBeInTheDocument());
  });

  it("clicking a run row loads detail and shows per-field summary", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
      {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 2, num_matches: 1,
        accuracy_avg: 0.5, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
    ]);
    mock.onGet("/api/v1/evaluations/r-1").reply(200, {
      run: {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 2, num_matches: 1,
        accuracy_avg: 0.5, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
      fields: [
        {
          id: "f-1", run_id: "r-1", document_id: "d-1",
          document_filename: "a.pdf", field_name: "invoice_number",
          predicted_value: "INV-1", expected_value: "INV-1",
          match_status: "exact", created_at: "",
        },
        {
          id: "f-2", run_id: "r-1", document_id: "d-1",
          document_filename: "a.pdf", field_name: "total",
          predicted_value: "100", expected_value: "200",
          match_status: "mismatch", created_at: "",
        },
      ],
    });

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByText(/50\.0%/);
    await user.click(screen.getByText(/50\.0%/));
    await screen.findByText(/Per-field summary/i);
    expect(screen.getByText("invoice_number")).toBeInTheDocument();
    expect(screen.getByText("total")).toBeInTheDocument();
  });

  it("expands per-doc rows when 'Show per-doc rows' clicked", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
      {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
        accuracy_avg: 1, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
    ]);
    mock.onGet("/api/v1/evaluations/r-1").reply(200, {
      run: {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
        accuracy_avg: 1, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
      fields: [{
        id: "f-1", run_id: "r-1", document_id: "d-1",
        document_filename: "alpha.pdf", field_name: "invoice_number",
        predicted_value: "INV-1", expected_value: "INV-1",
        match_status: "exact", created_at: "",
      }],
    });

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByText(/100\.0%/);
    await user.click(screen.getByText(/100\.0%/));
    await user.click(screen.getByText(/Show per-doc rows/i));
    expect(screen.getByText("alpha.pdf")).toBeInTheDocument();
  });

  it("clicking 📥 invokes downloadEvaluationExcel", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
      {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
        accuracy_avg: 1, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      },
    ]);
    let excelCalled = false;
    mock.onGet("/api/v1/evaluations/r-1/excel").reply(() => {
      excelCalled = true;
      return [200, new Blob(["xlsx"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })];
    });
    // Stub createObjectURL/revokeObjectURL — jsdom doesn't implement them
    URL.createObjectURL = vi.fn(() => "blob:http://x") as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    await screen.findByTitle(/Download Excel/i);
    await user.click(screen.getByTitle(/Download Excel/i));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(excelCalled).toBe(true));
  });
});

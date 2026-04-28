import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import ProjectDocumentsPage from "../ProjectDocumentsPage";

let mock: MockAdapter;
const PROJECT = {
  id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
  description: null, template_key: "japan_receipt", created_by: "u-1",
  created_at: "", updated_at: "", deleted_at: null,
  template: {
    key: "japan_receipt", display_name: "🇯🇵 日本領収書",
    description: "", expected_fields: [], recommended_processor: "gemini",
  },
  document_count: 0,
};

const docList = (items: unknown[], total = items.length) => ({
  items, total, page: 1, page_size: 20,
});

const docFixture = (id: string, name = `${id}.pdf`, gt = false) => ({
  id, project_id: "p-1", filename: name, file_path: `${id}.pdf`,
  file_size: 1234, mime_type: "application/pdf", status: "ready",
  is_ground_truth: gt, uploaded_by: "u-1",
  created_at: "", updated_at: "", deleted_at: null,
});

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, PROJECT);
  navigateMock.mockReset();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/workspaces/demo/projects/p-1"]}>
      <Routes>
        <Route
          path="/workspaces/:slug/projects/:pid"
          element={<ProjectDocumentsPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProjectDocumentsPage", () => {
  it("loads project header and document list on mount", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1", "a.pdf"),
    ]));
    renderPage();
    expect(await screen.findByText("Receipts")).toBeInTheDocument();
    expect(await screen.findByText("a.pdf")).toBeInTheDocument();
  });

  it("shows empty state when no documents", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([]));
    renderPage();
    expect(await screen.findByText(/还没有文档/)).toBeInTheDocument();
  });

  it("filename search re-fetches with q param", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("d-1.pdf");

    const search = screen.getByPlaceholderText(/搜索文件名/);
    await user.type(search, "alpha");

    await waitFor(() => {
      const last = mock.history.get[mock.history.get.length - 1];
      expect(last.url).toContain("q=alpha");
    });
  });

  it("GT filter sets is_ground_truth=true on the request", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/还没有文档/);

    const gtSelect = screen.getByLabelText(/Ground Truth/);
    await user.selectOptions(gtSelect, "true");

    await waitFor(() => {
      const last = mock.history.get[mock.history.get.length - 1];
      expect(last.url).toContain("is_ground_truth=true");
    });
  });

  it("toggling GT chip calls PATCH and updates row", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1", "x.pdf", false),
    ]));
    mock.onPatch("/api/v1/projects/p-1/documents/d-1").reply(200, {
      ...docFixture("d-1", "x.pdf", true),
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText("x.pdf");

    const toggleBtn = screen.getByRole("button", { name: /标记为 GT/ });
    await user.click(toggleBtn);

    await waitFor(() => {
      expect(mock.history.patch.length).toBe(1);
    });
  });

  it("delete button calls DELETE after confirm", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    mock.onDelete("/api/v1/projects/p-1/documents/d-1").reply(204);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("d-1.pdf");

    await user.click(screen.getByRole("button", { name: /删除/ }));

    await waitFor(() => expect(mock.history.delete.length).toBe(1));
    confirmSpy.mockRestore();
  });

  it("pagination next button increments page and re-fetches", async () => {
    let callCount = 0;
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(() => {
      callCount += 1;
      return [200, docList(
        Array.from({ length: 20 }, (_, i) => docFixture(`d-${callCount}-${i}`)),
        50
      )];
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/d-1-0/);

    const nextBtn = screen.getByRole("button", { name: /下一页/ });
    await user.click(nextBtn);

    await waitFor(() => {
      const last = mock.history.get[mock.history.get.length - 1];
      expect(last.url).toContain("page=2");
    });
  });

  it("upload triggers list refetch", async () => {
    let getCalls = 0;
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(() => {
      getCalls += 1;
      return [200, docList([])];
    });
    mock.onPost("/api/v1/projects/p-1/documents").reply(201, docFixture("d-new"));
    renderPage();
    await waitFor(() => expect(getCalls).toBeGreaterThanOrEqual(1));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const blob = new Blob([new Uint8Array(10)], { type: "application/pdf" });
    const file = new File([blob], "new.pdf", { type: "application/pdf" });
    await userEvent.upload(fileInput, file);

    await waitFor(() => expect(getCalls).toBeGreaterThanOrEqual(2));
  });

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
    mock.onGet("/api/v1/projects/p-1/documents/next-unreviewed").reply(200, {
      id: "d-99", filename: "next.pdf",
    });
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
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

  it("Batch Predict button is disabled when no rows selected", async () => {
    mock.onGet(/\/api\/v1\/projects\/p-1\/documents.*/).reply(200, docList([
      docFixture("d-1"),
    ]));
    renderPage();
    await screen.findByText("d-1.pdf");
    const btn = screen.getByRole("button", { name: /Batch Predict/i });
    expect(btn).toBeDisabled();
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
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/workspace?doc=")
    );
    alertSpy.mockRestore();
  });
});

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
    await new Promise((r) => setTimeout(r, 50));
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.stringContaining("doc=d-other"),
      expect.anything()
    );
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      workspaces: [
        { id: "ws-1", name: "Demo", slug: "demo", role: "owner" as const },
      ],
      currentWorkspaceId: "ws-1",
    }),
}));

const loadProjectsMock = vi.fn();
const deleteProjectMock = vi.fn();
let storeState: unknown = {
  projects: [],
  loading: false,
  loadProjects: loadProjectsMock,
  deleteProject: deleteProjectMock,
};
vi.mock("../../stores/project-store", () => ({
  useProjectStore: (selector: (s: unknown) => unknown) => selector(storeState),
}));

import ProjectListPage from "../ProjectListPage";

beforeEach(() => {
  navigateMock.mockReset();
  loadProjectsMock.mockReset().mockResolvedValue(undefined);
  deleteProjectMock.mockReset().mockResolvedValue(undefined);
  storeState = {
    projects: [],
    loading: false,
    loadProjects: loadProjectsMock,
    deleteProject: deleteProjectMock,
  };
});

afterEach(() => vi.clearAllMocks());

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectListPage />
    </MemoryRouter>
  );
}

describe("ProjectListPage", () => {
  it("calls loadProjects(workspaceId) on mount", () => {
    renderPage();
    expect(loadProjectsMock).toHaveBeenCalledWith("ws-1");
  });

  it("shows empty-state with '+ 新建 Project' button when list empty", () => {
    renderPage();
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New project/i })).toBeInTheDocument();
  });

  it("renders project cards when loaded", () => {
    storeState = {
      projects: [
        {
          id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
          template_key: "japan_receipt", created_by: "u-1",
          created_at: "2026-04-28T00:00:00Z", updated_at: "2026-04-28T00:00:00Z",
          deleted_at: null, description: null,
        },
      ],
      loading: false,
      loadProjects: loadProjectsMock,
      deleteProject: deleteProjectMock,
    };
    renderPage();
    expect(screen.getByText("Receipts")).toBeInTheDocument();
  });

  it("clicking '+ 新建' navigates to /workspaces/demo/projects/new", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /New project/i }));
    expect(navigateMock).toHaveBeenCalledWith("/workspaces/demo/projects/new");
  });
});

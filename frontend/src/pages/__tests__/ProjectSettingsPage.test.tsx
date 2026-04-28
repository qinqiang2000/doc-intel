import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api-client";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ slug: "demo", pid: "p-1" }),
  };
});

vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      workspaces: [{ id: "ws-1", name: "Demo", slug: "demo", role: "owner" }],
      currentWorkspaceId: "ws-1",
    }),
}));

import ProjectSettingsPage from "../ProjectSettingsPage";

let mock: MockAdapter;
const PROJECT_DETAIL = {
  id: "p-1", workspace_id: "ws-1", name: "P", slug: "p",
  description: "first", template_key: "japan_receipt", created_by: "u-1",
  created_at: "", updated_at: "", deleted_at: null,
  template: {
    key: "japan_receipt", display_name: "🇯🇵 日本領収書",
    description: "", expected_fields: ["doc_type"], recommended_processor: "gemini",
  },
  document_count: 3,
};

beforeEach(() => {
  mock = new MockAdapter(api);
  navigateMock.mockReset();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectSettingsPage />
    </MemoryRouter>
  );
}

describe("ProjectSettingsPage", () => {
  it("loads project detail on mount and shows template (read-only)", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, PROJECT_DETAIL);
    renderPage();
    expect(await screen.findByText(/日本領収書/)).toBeInTheDocument();
  });

  it("PATCH updates name", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, PROJECT_DETAIL);
    mock.onPatch("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      ...PROJECT_DETAIL, name: "NewName",
    });
    const user = userEvent.setup();
    renderPage();

    const nameInput = await screen.findByLabelText(/名称/);
    await user.clear(nameInput);
    await user.type(nameInput, "NewName");
    await user.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => expect(mock.history.patch.length).toBe(1));
  });

  it("delete project navigates back to /workspaces/:slug", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, PROJECT_DETAIL);
    mock.onDelete("/api/v1/workspaces/ws-1/projects/p-1").reply(204);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/日本領収書/);
    await user.click(screen.getByRole("button", { name: /删除 Project/ }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/workspaces/demo");
    });
    confirmSpy.mockRestore();
  });

  it("shows error when load fails", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(404, {
      error: { code: "project_not_found", message: "Project not found." },
    });
    renderPage();
    expect(await screen.findByText(/Project not found/)).toBeInTheDocument();
  });
});

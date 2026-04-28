import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
      workspaces: [{ id: "ws-1", name: "Demo", slug: "demo", role: "owner" }],
      currentWorkspaceId: "ws-1",
    }),
}));

const loadTemplatesMock = vi.fn().mockResolvedValue(undefined);
const createProjectMock = vi.fn();
let projStoreState: unknown = {
  templates: [
    {
      key: "custom",
      display_name: "✨ 自定义",
      description: "空模板",
      expected_fields: [],
      recommended_processor: "gemini",
    },
    {
      key: "japan_receipt",
      display_name: "🇯🇵 日本領収書",
      description: "日本式领収書",
      expected_fields: ["doc_type", "merchant_name"],
      recommended_processor: "gemini",
    },
  ],
  loadTemplates: loadTemplatesMock,
  createProject: createProjectMock,
};
vi.mock("../../stores/project-store", () => ({
  useProjectStore: (selector: (s: unknown) => unknown) => selector(projStoreState),
}));

import ProjectCreatePage from "../ProjectCreatePage";

beforeEach(() => {
  navigateMock.mockReset();
  loadTemplatesMock.mockClear();
  createProjectMock.mockReset();
});

afterEach(() => vi.clearAllMocks());

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/workspaces/demo/projects/new"]}>
      <Routes>
        <Route path="/workspaces/:slug/projects/new" element={<ProjectCreatePage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ProjectCreatePage", () => {
  it("calls loadTemplates on mount and renders all templates", async () => {
    renderPage();
    await waitFor(() => expect(loadTemplatesMock).toHaveBeenCalled());
    expect(screen.getByText(/自定义/)).toBeInTheDocument();
    expect(screen.getByText(/日本領収書/)).toBeInTheDocument();
  });

  it("auto-fills slug from name when slug untouched", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText(/自定义/));
    const nameInput = screen.getByLabelText(/名称/);
    await user.type(nameInput, "Japan Receipts");
    const slug = screen.getByLabelText(/Slug/) as HTMLInputElement;
    expect(slug.value).toBe("japan-receipts");
  });

  it("submits with template_key and navigates to project page", async () => {
    createProjectMock.mockResolvedValueOnce({
      id: "p-1", workspace_id: "ws-1", name: "X", slug: "japan",
      template_key: "japan_receipt", created_by: "u-1",
      created_at: "", updated_at: "", deleted_at: null, description: null,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText(/日本領収書/));
    await user.type(screen.getByLabelText(/名称/), "Japan");
    await user.click(screen.getByRole("button", { name: /创建/ }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith("ws-1", expect.objectContaining({
        name: "Japan",
        slug: "japan",
        template_key: "japan_receipt",
      }));
    });
    expect(navigateMock).toHaveBeenCalledWith("/workspaces/demo/projects/p-1");
  });

  it("shows error when create fails", async () => {
    createProjectMock.mockRejectedValueOnce({
      code: "project_slug_taken", message: "Slug taken",
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText(/自定义/));
    await user.type(screen.getByLabelText(/名称/), "X-name");
    await user.click(screen.getByRole("button", { name: /创建/ }));
    expect(await screen.findByText(/Slug taken/)).toBeInTheDocument();
  });

  it("submit button disabled until template chosen", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /创建/ })).toBeDisabled();
  });
});

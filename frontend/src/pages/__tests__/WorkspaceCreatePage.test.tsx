import { render, screen, waitFor } from "@testing-library/react";
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

const createWorkspaceMock = vi.fn();
vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: any) => unknown) =>
    selector({ createWorkspace: createWorkspaceMock }),
}));

import WorkspaceCreatePage from "../WorkspaceCreatePage";

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkspaceCreatePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  createWorkspaceMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceCreatePage", () => {
  it("auto-fills slug from name (lowercase, hyphenated)", async () => {
    const user = userEvent.setup();
    renderPage();
    const nameInput = screen.getByLabelText(/名称/);
    const slugInput = screen.getByLabelText(/Slug/i) as HTMLInputElement;

    await user.type(nameInput, "Japan Receipts");

    expect(slugInput.value).toBe("japan-receipts");
  });

  it("submits and navigates to /workspaces/:slug on success", async () => {
    createWorkspaceMock.mockResolvedValueOnce({
      id: "ws-x",
      name: "Demo",
      slug: "demo-ws",
      role: "owner",
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/名称/), "Demo");
    // Slug auto-fills as 'demo'; clear and set explicitly
    const slugInput = screen.getByLabelText(/Slug/i);
    await user.clear(slugInput);
    await user.type(slugInput, "demo-ws");
    await user.click(screen.getByRole("button", { name: /创建/ }));

    await waitFor(() => {
      expect(createWorkspaceMock).toHaveBeenCalledWith({
        name: "Demo",
        slug: "demo-ws",
        description: undefined,
      });
    });
    expect(navigateMock).toHaveBeenCalledWith("/workspaces/demo-ws");
  });

  it("shows error on failure", async () => {
    createWorkspaceMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        data: { error: { code: "workspace_slug_taken", message: "Taken" } },
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/名称/), "X");
    await user.clear(screen.getByLabelText(/Slug/i));
    await user.type(screen.getByLabelText(/Slug/i), "taken-slug");
    await user.click(screen.getByRole("button", { name: /创建/ }));

    expect(await screen.findByText(/Taken/)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

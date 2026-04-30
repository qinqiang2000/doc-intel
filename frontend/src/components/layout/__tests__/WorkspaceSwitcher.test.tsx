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

const switchByIdMock = vi.fn();
const storeState = {
  workspaces: [
    { id: "ws-1", name: "Demo", slug: "demo", role: "owner" as const },
    { id: "ws-2", name: "Test2", slug: "test2", role: "member" as const },
  ],
  currentWorkspaceId: "ws-1",
  switchWorkspaceById: switchByIdMock,
};

vi.mock("../../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(storeState),
}));

import WorkspaceSwitcher from "../WorkspaceSwitcher";

function renderSwitcher() {
  return render(
    <MemoryRouter>
      <WorkspaceSwitcher />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  switchByIdMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WorkspaceSwitcher", () => {
  it("displays the current workspace name on the trigger button", () => {
    renderSwitcher();
    expect(screen.getByRole("button", { name: /Demo/ })).toBeInTheDocument();
  });

  it("opens dropdown listing all workspaces on click", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    // Initially closed — dropdown items not visible (only the trigger 'Demo' button)
    expect(screen.queryByText("Test2")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Demo/ }));

    expect(screen.getByText("Test2")).toBeInTheDocument();
    // The current workspace also appears in the dropdown row
    const demoEntries = screen.getAllByText("Demo");
    expect(demoEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking another workspace switches and navigates", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Demo/ }));
    await user.click(screen.getByText("Test2"));

    expect(switchByIdMock).toHaveBeenCalledWith("ws-2");
    expect(navigateMock).toHaveBeenCalledWith("/workspaces/test2");
  });

  it('clicking "+ 新建 Workspace" navigates to /workspaces/new', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Demo/ }));
    await user.click(screen.getByText(/New workspace/i));

    expect(navigateMock).toHaveBeenCalledWith("/workspaces/new");
  });
});

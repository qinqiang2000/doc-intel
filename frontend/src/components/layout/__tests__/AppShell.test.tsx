import { render, screen } from "@testing-library/react";
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

const switchBySlugMock = vi.fn();
const logoutMock = vi.fn();

let mockState: any;

vi.mock("../../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector(mockState),
}));

import AppShell from "../AppShell";

function renderShell(initialPath: string = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<div>dashboard content</div>} />
          <Route
            path="/workspaces/:slug"
            element={<div>workspace content</div>}
          />
          <Route
            path="/workspaces/:slug/settings"
            element={<div>settings content</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  switchBySlugMock.mockReset();
  logoutMock.mockReset();
  mockState = {
    user: { id: "u-1", email: "alice@x.com", display_name: "Alice", is_active: true },
    workspaces: [
      { id: "ws-1", name: "Demo", slug: "demo", role: "owner" },
    ],
    currentWorkspaceId: "ws-1",
    meLoaded: true,
    switchWorkspaceBySlug: switchBySlugMock,
    logout: logoutMock,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AppShell", () => {
  it("renders the doc-intel logo + user display name", () => {
    renderShell();
    expect(screen.getByText(/doc-intel/i)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders the outlet content (dashboard route)", () => {
    renderShell("/dashboard");
    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });

  it("logout button triggers logout + navigate to /login", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /退出/ }));

    expect(logoutMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to /workspaces/new when user has no workspaces", () => {
    mockState.workspaces = [];
    mockState.currentWorkspaceId = null;
    renderShell();

    expect(navigateMock).toHaveBeenCalledWith("/workspaces/new", {
      replace: true,
    });
  });

  it("settings link visible only for workspace owner", () => {
    renderShell("/workspaces/demo");
    expect(screen.getByRole("button", { name: /设置/ })).toBeInTheDocument();
  });

  it("settings link NOT visible when current role is member", () => {
    mockState.workspaces = [
      { id: "ws-1", name: "Demo", slug: "demo", role: "member" },
    ];
    renderShell("/workspaces/demo");
    expect(screen.queryByRole("button", { name: /设置/ })).not.toBeInTheDocument();
  });

  it("calls switchWorkspaceBySlug when URL slug changes", () => {
    renderShell("/workspaces/demo");
    expect(switchBySlugMock).toHaveBeenCalledWith("demo");
  });

  it("does NOT redirect to /workspaces/new while meLoaded is false", () => {
    mockState.workspaces = [];
    mockState.currentWorkspaceId = null;
    mockState.meLoaded = false;
    renderShell();

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("redirects to /workspaces/new ONLY after meLoaded becomes true with empty workspaces", () => {
    mockState.workspaces = [];
    mockState.currentWorkspaceId = null;
    mockState.meLoaded = true;
    renderShell();

    expect(navigateMock).toHaveBeenCalledWith("/workspaces/new", {
      replace: true,
    });
  });
});

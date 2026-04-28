import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockState: any;
const refreshMeMock = vi.fn();
vi.mock("../stores/auth-store", () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector(mockState),
}));

vi.mock("../pages/ProjectCreatePage", () => ({
  default: () => <div data-testid="page-project-create">project-create</div>,
}));
vi.mock("../pages/ProjectDocumentsPage", () => ({
  default: () => <div data-testid="page-project-documents">project-documents</div>,
}));
vi.mock("../pages/ProjectSettingsPage", () => ({
  default: () => <div data-testid="page-project-settings">project-settings</div>,
}));

// Stub each route's page so we don't bring in their full deps
vi.mock("../pages/auth/LoginPage", () => ({
  default: () => <div data-testid="page-login">login</div>,
}));
vi.mock("../pages/auth/RegisterPage", () => ({
  default: () => <div data-testid="page-register">register</div>,
}));
vi.mock("../pages/ProjectListPage", () => ({
  default: () => <div data-testid="page-projects">project-list</div>,
}));
vi.mock("../pages/WorkspaceCreatePage", () => ({
  default: () => <div data-testid="page-ws-create">ws-create</div>,
}));
vi.mock("../pages/WorkspaceSettingsPage", () => ({
  default: () => <div data-testid="page-ws-settings">ws-settings</div>,
}));
vi.mock("../components/layout/AppShell", () => ({
  default: () => {
    const { Outlet } = require("react-router-dom");
    return (
      <div data-testid="app-shell">
        <Outlet />
      </div>
    );
  },
}));

import App from "../App";

beforeEach(() => {
  refreshMeMock.mockReset();
  mockState = {
    token: null,
    refreshMe: refreshMeMock,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("App routing", () => {
  it("redirects '/' to /login when no token", () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByTestId("page-login")).toBeInTheDocument();
  });

  it("redirects '/' to /dashboard when token exists", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByTestId("page-projects")).toBeInTheDocument();
  });

  it("/login renders LoginPage without auth", () => {
    window.history.pushState({}, "", "/login");
    render(<App />);
    expect(screen.getByTestId("page-login")).toBeInTheDocument();
  });

  it("/dashboard requires token — redirects to /login when no token", () => {
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    expect(screen.getByTestId("page-login")).toBeInTheDocument();
  });

  it("/dashboard with token renders dashboard inside AppShell", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("page-projects")).toBeInTheDocument();
  });

  it("calls refreshMe on mount when token exists", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    expect(refreshMeMock).toHaveBeenCalled();
  });

  it("/workspaces/:slug/projects/new renders ProjectCreatePage when authed", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/workspaces/demo/projects/new");
    render(<App />);
    expect(screen.getByTestId("page-project-create")).toBeInTheDocument();
  });

  it("/workspaces/:slug/projects/:pid renders ProjectDocumentsPage when authed", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/workspaces/demo/projects/p-1");
    render(<App />);
    expect(screen.getByTestId("page-project-documents")).toBeInTheDocument();
  });

  it("/workspaces/:slug/projects/:pid/settings renders ProjectSettingsPage when authed", () => {
    mockState.token = "tok";
    window.history.pushState({}, "", "/workspaces/demo/projects/p-1/settings");
    render(<App />);
    expect(screen.getByTestId("page-project-settings")).toBeInTheDocument();
  });
});

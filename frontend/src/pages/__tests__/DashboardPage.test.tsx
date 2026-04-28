import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api-client";

let mockAdapter: MockAdapter;

const ENGINE_INFO_OK = {
  processors: [
    { type: "mock", models: ["mock-v1.0"] },
    { type: "gemini", models: ["gemini-2.5-flash"] },
  ],
};

let mockState: any;
vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector(mockState),
}));

import DashboardPage from "../DashboardPage";

beforeEach(() => {
  mockAdapter = new MockAdapter(api);
  mockState = {
    user: { id: "u-1", email: "alice@x.com", display_name: "Alice", is_active: true },
    workspaces: [
      { id: "ws-1", name: "Demo", slug: "demo", role: "owner" as const },
    ],
    currentWorkspaceId: "ws-1",
  };
});

afterEach(() => {
  mockAdapter.restore();
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe("DashboardPage", () => {
  it("renders the current workspace name + slug + role", async () => {
    mockAdapter.onGet("/api/v1/engine/info").reply(200, ENGINE_INFO_OK);
    renderPage();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText(/owner/)).toBeInTheDocument();
  });

  it("fetches /engine/info on mount and displays processor count", async () => {
    mockAdapter.onGet("/api/v1/engine/info").reply(200, ENGINE_INFO_OK);
    renderPage();
    // Eventually the engine info section shows processors
    await waitFor(() => {
      expect(screen.getByText(/mock/)).toBeInTheDocument();
    });
    expect(screen.getByText(/gemini/)).toBeInTheDocument();
  });

  it("shows an error message when /engine/info fails", async () => {
    mockAdapter.onGet("/api/v1/engine/info").reply(503, {
      error: { code: "engine_unavailable", message: "Engine is down" },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Engine is down/)).toBeInTheDocument();
    });
  });

  it("shows loading state while no workspace is selected", () => {
    mockState.currentWorkspaceId = null;
    mockAdapter.onGet("/api/v1/engine/info").reply(200, ENGINE_INFO_OK);
    renderPage();
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });
});

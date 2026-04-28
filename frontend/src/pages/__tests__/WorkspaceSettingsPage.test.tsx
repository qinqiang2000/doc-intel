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

const refreshMeMock = vi.fn();
let mockState: any;
vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector(mockState),
}));

import WorkspaceSettingsPage from "../WorkspaceSettingsPage";

let mockAdapter: MockAdapter;

beforeEach(() => {
  navigateMock.mockReset();
  refreshMeMock.mockReset();
  mockAdapter = new MockAdapter(api);
  mockState = {
    workspaces: [
      { id: "ws-1", name: "Demo", slug: "demo", role: "owner" as const },
    ],
    refreshMe: refreshMeMock,
  };
});

afterEach(() => {
  mockAdapter.restore();
  vi.clearAllMocks();
});

const WS_DETAIL_OK = {
  id: "ws-1",
  name: "Demo",
  slug: "demo",
  description: null,
  owner_id: "u-owner",
  members: [
    { user_id: "u-owner", email: "owner@x.com", display_name: "Owner", role: "owner" },
    { user_id: "u-bob", email: "bob@x.com", display_name: "Bob", role: "member" },
  ],
};

function renderPage(slug = "demo") {
  return render(
    <MemoryRouter initialEntries={[`/workspaces/${slug}/settings`]}>
      <Routes>
        <Route
          path="/workspaces/:slug/settings"
          element={<WorkspaceSettingsPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("WorkspaceSettingsPage", () => {
  it("denies access when current role is not owner", () => {
    mockState.workspaces = [
      { id: "ws-1", name: "Demo", slug: "demo", role: "member" as const },
    ];
    renderPage();
    expect(screen.getByText(/只有 owner 可以访问/)).toBeInTheDocument();
  });

  it("loads and displays members for the owner", async () => {
    mockAdapter.onGet("/api/v1/workspaces/ws-1").reply(200, WS_DETAIL_OK);
    renderPage();
    expect(await screen.findByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("invite flow posts and re-fetches member list", async () => {
    mockAdapter.onGet("/api/v1/workspaces/ws-1").reply(200, WS_DETAIL_OK);
    mockAdapter.onPost("/api/v1/workspaces/ws-1/members").reply(201, {
      user_id: "u-new",
      email: "new@x.com",
      display_name: "New",
      role: "member",
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Bob");

    await user.type(screen.getByPlaceholderText(/email@/i), "new@x.com");
    await user.click(screen.getByRole("button", { name: /邀请/ }));

    await waitFor(() => {
      expect(mockAdapter.history.post.length).toBe(1);
    });
    expect(mockAdapter.history.post[0].url).toContain("/members");
  });

  it("delete workspace navigates to /dashboard after success", async () => {
    mockAdapter.onGet("/api/v1/workspaces/ws-1").reply(200, WS_DETAIL_OK);
    mockAdapter.onDelete("/api/v1/workspaces/ws-1").reply(204);
    refreshMeMock.mockResolvedValueOnce(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Bob");

    await user.click(screen.getByRole("button", { name: /删除 Workspace/ }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });
    confirmSpy.mockRestore();
  });
});

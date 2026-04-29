import MockAdapter from "axios-mock-adapter";
import { render, screen } from "@testing-library/react";
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

import PublishPage from "../PublishPage";

let mock: MockAdapter;

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
          path="/workspaces/:slug/projects/:pid/api"
          element={<PublishPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("PublishPage", () => {
  it("draft state shows DRAFT badge + Publish button + api_code input", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
      description: null, template_key: "custom",
      created_by: "u-1", created_at: "", updated_at: "", deleted_at: null,
      api_code: null, api_published_at: null, api_disabled_at: null,
    });
    mock.onGet("/api/v1/projects/p-1/api-keys").reply(200, []);

    renderPage("/workspaces/demo/projects/p-1/api");
    expect(await screen.findByText(/DRAFT/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/api_code|receipts/i)).toBeInTheDocument();
  });

  it("published state shows PUBLISHED badge + api_code (immutable) + Unpublish", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
      description: null, template_key: "custom",
      created_by: "u-1", created_at: "", updated_at: "", deleted_at: null,
      api_code: "receipts",
      api_published_at: "2026-04-29T12:00:00",
      api_disabled_at: null,
    });
    mock.onGet("/api/v1/projects/p-1/api-keys").reply(200, []);

    renderPage("/workspaces/demo/projects/p-1/api");
    expect(await screen.findByText(/PUBLISHED/i)).toBeInTheDocument();
    expect(screen.getAllByText(/receipts/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Unpublish/i })).toBeInTheDocument();
  });
});

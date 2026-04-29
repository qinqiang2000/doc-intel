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

  it("opens new-key modal, creates key, reveals full key, then closes", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
      description: null, template_key: "custom",
      created_by: "u-1", created_at: "", updated_at: "", deleted_at: null,
      api_code: "receipts",
      api_published_at: "2026-04-29T12:00:00",
      api_disabled_at: null,
    });
    let listCall = 0;
    mock.onGet("/api/v1/projects/p-1/api-keys").reply(() => {
      listCall++;
      if (listCall === 1) return [200, []];
      return [200, [{
        id: "k-1", project_id: "p-1", name: "production",
        key_prefix: "dik_AbCdEfGh", is_active: true,
        last_used_at: null, created_by: "u-1", created_at: "",
      }]];
    });
    mock.onPost("/api/v1/projects/p-1/api-keys").reply(201, {
      id: "k-1", project_id: "p-1", name: "production",
      key_prefix: "dik_AbCdEfGh", is_active: true,
      last_used_at: null, created_by: "u-1", created_at: "",
      key: "dik_AbCdEfGh_FullSecretKeyXYZ123",
    });

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/api");
    await screen.findByText(/PUBLISHED/i);
    await user.click(screen.getByText(/\+ New Key/i));
    const nameInput = await screen.findByPlaceholderText(/Key name/i);
    await user.type(nameInput, "production");
    await user.click(screen.getByRole("button", { name: /^Create$/i }));
    // Modal switches to revealed view
    expect(await screen.findByText(/dik_AbCdEfGh_FullSecretKeyXYZ123/)).toBeInTheDocument();
    expect(screen.getByText(/only time you'll see this key/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Done$/i }));
    // List refreshed with prefix (dik_AbCdEfGh appears in the list row + cURL hint)
    expect((await screen.findAllByText(/dik_AbCdEfGh/)).length).toBeGreaterThan(0);
  });

  it("clicking 🗑 confirms then DELETEs the key", async () => {
    mock.onGet("/api/v1/workspaces/ws-1/projects/p-1").reply(200, {
      id: "p-1", workspace_id: "ws-1", name: "Receipts", slug: "receipts",
      description: null, template_key: "custom",
      created_by: "u-1", created_at: "", updated_at: "", deleted_at: null,
      api_code: "receipts",
      api_published_at: "2026-04-29T12:00:00",
      api_disabled_at: null,
    });
    let deleted = false;
    mock.onGet("/api/v1/projects/p-1/api-keys").reply(() => {
      if (deleted) return [200, []];
      return [200, [{
        id: "k-1", project_id: "p-1", name: "production",
        key_prefix: "dik_AbCdEfGh", is_active: true,
        last_used_at: null, created_by: "u-1", created_at: "",
      }]];
    });
    mock.onDelete("/api/v1/projects/p-1/api-keys/k-1").reply(() => {
      deleted = true;
      return [204, ""];
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    renderPage("/workspaces/demo/projects/p-1/api");
    await screen.findByText(/dik_AbCdEfGh···/);
    await user.click(await screen.findByTitle(/Delete key/i));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText(/dik_AbCdEfGh···/)).not.toBeInTheDocument());
  });
});

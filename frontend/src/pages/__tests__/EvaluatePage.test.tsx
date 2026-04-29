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

import EvaluatePage from "../EvaluatePage";

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
          path="/workspaces/:slug/projects/:pid/evaluate"
          element={<EvaluatePage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("EvaluatePage", () => {
  it("renders empty state when no evaluations exist", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, []);
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    expect(await screen.findByText(/Run your first evaluation/i)).toBeInTheDocument();
  });

  it("renders Run Evaluation button + back link", async () => {
    mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, []);
    renderPage("/workspaces/demo/projects/p-1/evaluate");
    expect(await screen.findByRole("button", { name: /Run Evaluation/i })).toBeInTheDocument();
    expect(screen.getByText(/Back to Project|◀/i)).toBeInTheDocument();
  });
});

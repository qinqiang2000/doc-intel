import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      workspaces: [
        { id: "ws-1", name: "Demo", slug: "demo", role: "owner" as const },
      ],
      currentWorkspaceId: "ws-1",
    }),
}));

import ProjectListPage from "../ProjectListPage";

describe("ProjectListPage (S1/T1 stub)", () => {
  it("renders the workspace name and a placeholder for projects", () => {
    render(
      <MemoryRouter>
        <ProjectListPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/Demo/)).toBeInTheDocument();
    expect(screen.getByText(/Project list/i)).toBeInTheDocument();
  });
});

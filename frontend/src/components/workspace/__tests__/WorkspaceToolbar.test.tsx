import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { usePredictStore } from "../../../stores/predict-store";
import WorkspaceToolbar from "../WorkspaceToolbar";

const onSwitchMock = vi.fn();
const loadNextUnreviewedMock = vi.fn();

const docs = [
  { id: "d-1", filename: "alpha.pdf" },
  { id: "d-2", filename: "beta.pdf" },
  { id: "d-3", filename: "gamma.pdf" },
];

beforeEach(() => {
  onSwitchMock.mockReset();
  loadNextUnreviewedMock.mockReset();
  usePredictStore.setState({
    loadNextUnreviewed: loadNextUnreviewedMock,
  });
});

afterEach(() => vi.clearAllMocks());

function renderToolbar(props: Partial<React.ComponentProps<typeof WorkspaceToolbar>> = {}) {
  return render(
    <MemoryRouter>
      <WorkspaceToolbar
        workspaceSlug="demo"
        projectId="p-1"
        projectName="Receipts"
        documents={docs}
        currentDocId="d-2"
        onSwitch={onSwitchMock}
        {...props}
      />
    </MemoryRouter>
  );
}

describe("WorkspaceToolbar", () => {
  it("displays current document filename", () => {
    renderToolbar();
    expect(screen.getByText(/beta.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/Receipts/)).toBeInTheDocument();
  });

  it("clicking dropdown shows all documents and selecting calls onSwitch", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByRole("button", { name: /beta.pdf/ }));
    await user.click(screen.getByRole("button", { name: /gamma.pdf/ }));
    expect(onSwitchMock).toHaveBeenCalledWith("d-3");
  });

  it("Prev button disabled at first doc; Next disabled at last", () => {
    const { rerender } = renderToolbar({ currentDocId: "d-1" });
    expect(screen.getByRole("button", { name: /上一份/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /下一份/ })).not.toBeDisabled();
    rerender(
      <MemoryRouter>
        <WorkspaceToolbar
          workspaceSlug="demo"
          projectId="p-1" projectName="Receipts"
          documents={docs} currentDocId="d-3" onSwitch={onSwitchMock}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /上一份/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /下一份/ })).toBeDisabled();
  });

  it("Prev/Next call onSwitch with neighbor id", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByRole("button", { name: /下一份/ }));
    expect(onSwitchMock).toHaveBeenCalledWith("d-3");
    await user.click(screen.getByRole("button", { name: /上一份/ }));
    expect(onSwitchMock).toHaveBeenCalledWith("d-1");
  });

  it("Next Unreviewed: 200 calls onSwitch; 404 alerts", async () => {
    const user = userEvent.setup();
    loadNextUnreviewedMock.mockResolvedValueOnce({
      id: "d-99", filename: "next.pdf",
    });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    renderToolbar();
    await user.click(screen.getByRole("button", { name: /Next Unreviewed/i }));
    expect(onSwitchMock).toHaveBeenCalledWith("d-99");

    loadNextUnreviewedMock.mockResolvedValueOnce(null);
    await user.click(screen.getByRole("button", { name: /Next Unreviewed/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("renders 📜 history button toggling promptHistoryOpen", async () => {
    const user = userEvent.setup();
    renderToolbar();
    expect(usePredictStore.getState().promptHistoryOpen).toBe(false);
    await user.click(screen.getByRole("button", { name: /📜/ }));
    expect(usePredictStore.getState().promptHistoryOpen).toBe(true);
  });

  it("📜 button has title attribute for accessibility", () => {
    renderToolbar();
    const btn = screen.getByRole("button", { name: /📜/ });
    expect(btn.getAttribute("title")).toMatch(/Prompt|历史/i);
  });
});

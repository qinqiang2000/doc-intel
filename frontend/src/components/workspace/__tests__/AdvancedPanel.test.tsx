import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import AdvancedPanel from "../AdvancedPanel";

const predictSingleMock = vi.fn();

beforeEach(() => {
  predictSingleMock.mockReset().mockResolvedValue({});
  usePredictStore.setState({
    loading: {}, results: {}, batchProgress: null,
    selectedAnnotationId: null, currentStep: 0, apiFormat: "flat",
    processorOverride: "", promptOverride: "",
    predictSingle: predictSingleMock,
  });
});

afterEach(() => vi.clearAllMocks());

describe("AdvancedPanel", () => {
  it("is collapsed by default and expands on click", async () => {
    const user = userEvent.setup();
    render(<AdvancedPanel projectId="p-1" documentId="d-1" />);
    expect(screen.queryByLabelText(/processor/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Advanced/i }));
    expect(screen.getByLabelText(/processor/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
  });

  it("Re-predict calls predictSingle without overrides when fields blank", async () => {
    const user = userEvent.setup();
    render(<AdvancedPanel projectId="p-1" documentId="d-1" />);
    await user.click(screen.getByRole("button", { name: /Re-predict/ }));
    expect(predictSingleMock).toHaveBeenCalledWith("p-1", "d-1", {});
  });

  it("Re-predict passes overrides when fields filled", async () => {
    const user = userEvent.setup();
    render(<AdvancedPanel projectId="p-1" documentId="d-1" />);
    await user.click(screen.getByRole("button", { name: /Advanced/i }));
    await user.type(screen.getByLabelText(/processor/i), "openai|gpt-4o");
    await user.type(screen.getByLabelText(/prompt/i), "custom");
    await user.click(screen.getByRole("button", { name: /Re-predict/ }));
    expect(predictSingleMock).toHaveBeenCalledWith("p-1", "d-1", {
      processorKeyOverride: "openai|gpt-4o",
      promptOverride: "custom",
    });
  });

  it("override values persist in store across remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AdvancedPanel projectId="p-1" documentId="d-1" />);
    await user.click(screen.getByRole("button", { name: /Advanced/i }));
    await user.type(screen.getByLabelText(/processor/i), "mock");
    unmount();

    expect(usePredictStore.getState().processorOverride).toBe("mock");

    render(<AdvancedPanel projectId="p-1" documentId="d-2" />);
    await user.click(screen.getByRole("button", { name: /Advanced/i }));
    expect(screen.getByLabelText(/processor/i)).toHaveValue("mock");
  });
});

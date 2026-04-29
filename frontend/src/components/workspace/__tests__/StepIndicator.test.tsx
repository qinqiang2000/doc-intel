import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import StepIndicator from "../StepIndicator";

beforeEach(() => {
  usePredictStore.setState({
    selectedAnnotationId: null,
    currentStep: 0,
    apiFormat: "flat",
    processorOverride: "",
    promptOverride: "",
  });
});
afterEach(() => vi.clearAllMocks());

describe("StepIndicator", () => {
  it("renders all 6 steps", () => {
    render(<StepIndicator />);
    for (const label of ["Upload", "Preview", "Correct", "ApiFormat", "Tune", "GenerateAPI"]) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it("renders 🔒 on GenerateAPI only (Tune is now reachable)", () => {
    render(<StepIndicator />);
    const gen = screen.getByRole("button", { name: /GenerateAPI/ });
    expect(gen.textContent).toMatch(/🔒/);
    expect(gen).toBeDisabled();

    const tune = screen.getByRole("button", { name: /Tune/ });
    expect(tune.textContent).not.toMatch(/🔒/);
    expect(tune).not.toBeDisabled();
  });

  it("clicking a reachable step calls setStep with that id", async () => {
    usePredictStore.setState({ currentStep: 3 });
    const user = userEvent.setup();
    render(<StepIndicator />);
    await user.click(screen.getByRole("button", { name: /Preview/ }));
    expect(usePredictStore.getState().currentStep).toBe(1);
  });

  it("highlights the current step with aria-current=step", () => {
    usePredictStore.setState({ currentStep: 2 });
    render(<StepIndicator />);
    expect(screen.getByRole("button", { name: /Correct/ })).toHaveAttribute(
      "aria-current",
      "step"
    );
    expect(screen.getByRole("button", { name: /Upload/ })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("clicking Tune sets currentStep to 4 and opens correctionConsole", async () => {
    const user = userEvent.setup();
    render(<StepIndicator />);
    await user.click(screen.getByRole("button", { name: /Tune/ }));
    expect(usePredictStore.getState().currentStep).toBe(4);
    expect(usePredictStore.getState().correctionConsoleOpen).toBe(true);
  });

  it("Tune button shows aria-current when currentStep is 4", () => {
    usePredictStore.setState({ currentStep: 4 });
    render(<StepIndicator />);
    expect(screen.getByRole("button", { name: /Tune/ })).toHaveAttribute("aria-current", "step");
  });
});

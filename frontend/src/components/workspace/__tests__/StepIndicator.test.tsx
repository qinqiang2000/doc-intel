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

  it("renders 🔒 on Tune and GenerateAPI", () => {
    render(<StepIndicator />);
    const tune = screen.getByRole("button", { name: /Tune/ });
    const gen = screen.getByRole("button", { name: /GenerateAPI/ });
    expect(tune.textContent).toMatch(/🔒/);
    expect(gen.textContent).toMatch(/🔒/);
    expect(tune).toBeDisabled();
    expect(gen).toBeDisabled();
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
});

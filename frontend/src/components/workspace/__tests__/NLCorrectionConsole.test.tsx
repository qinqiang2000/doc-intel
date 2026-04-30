import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import NLCorrectionConsole from "../NLCorrectionConsole";

beforeEach(() => {
  usePredictStore.setState({
    correctionConsoleOpen: true,
    correctionStream: {
      active: false, promptTokens: [], revisedPrompt: null,
      previewResult: null, error: null,
    },
  });
});
afterEach(() => vi.clearAllMocks());

describe("NLCorrectionConsole", () => {
  it("does not render when correctionConsoleOpen is false", () => {
    usePredictStore.setState({ correctionConsoleOpen: false });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.queryByPlaceholderText(/natural language/i)).not.toBeInTheDocument();
  });

  it("Send button disabled while stream is active", () => {
    usePredictStore.setState({
      correctionStream: { ...usePredictStore.getState().correctionStream, active: true },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled();
  });

  it("renders accumulated prompt tokens during stream", () => {
    usePredictStore.setState({
      correctionStream: {
        active: true, promptTokens: ["A ", "B ", "C"],
        revisedPrompt: null, previewResult: null, error: null,
      },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.getByText(/A B C/)).toBeInTheDocument();
  });

  it("renders prompt diff once revisedPrompt arrives", () => {
    usePredictStore.setState({
      correctionStream: {
        active: false,
        promptTokens: ["full revised text"],
        revisedPrompt: "full revised text",
        previewResult: null,
        error: null,
      },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="original text" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.getByText(/Revised prompt/i)).toBeInTheDocument();
  });

  it("renders field diff once predict_result arrives", () => {
    usePredictStore.setState({
      correctionStream: {
        active: false, promptTokens: [], revisedPrompt: "x",
        previewResult: { structured_data: { a: 2 }, annotations: [] },
        error: null,
      },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={{ structured_data: { a: 1 } }}
      />
    );
    expect(screen.getByText(/Predict result/i)).toBeInTheDocument();
    expect(screen.getByText(/changed/i)).toBeInTheDocument();
  });

  it("error state shows red banner", () => {
    usePredictStore.setState({
      correctionStream: {
        active: false, promptTokens: [], revisedPrompt: null,
        previewResult: null, error: "boom",
      },
    });
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("Discard button calls discardCorrection", async () => {
    usePredictStore.setState({
      correctionStream: {
        active: false, promptTokens: ["x"], revisedPrompt: "x",
        previewResult: { structured_data: { a: 1 }, annotations: [] }, error: null,
      },
    });
    const user = userEvent.setup();
    render(
      <NLCorrectionConsole
        projectId="p-1" documentId="d-1" currentPrompt="orig" annotations={[]}
        currentResult={null}
      />
    );
    await user.click(screen.getByRole("button", { name: /Discard/i }));
    const s = usePredictStore.getState().correctionStream;
    expect(s.promptTokens).toEqual([]);
    expect(s.revisedPrompt).toBeNull();
    expect(s.previewResult).toBeNull();
  });
});

import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/api-client";
import { usePredictStore } from "../../../stores/predict-store";
import PredictModal from "../PredictModal";

const PR = {
  id: "pr-1", document_id: "d-1", version: 2,
  structured_data: { invoice_number: "INV-001" },
  inferred_schema: { invoice_number: "string" },
  prompt_used: "p", processor_key: "mock|m", source: "predict",
  created_by: "u-1", created_at: "2026-04-28T00:00:00Z",
};

const ANN = {
  id: "a-1", document_id: "d-1", field_name: "invoice_number",
  field_value: "INV-001", field_type: "string", bounding_box: null,
  source: "ai_detected", confidence: null, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "", updated_at: "",
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  usePredictStore.setState({ loading: {}, results: {}, batchProgress: null });
});

afterEach(() => mock.restore());

describe("PredictModal", () => {
  it("triggers predict on open when no result cached", async () => {
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, PR);
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);

    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByDisplayValue(/INV-001/)).toBeInTheDocument();
    expect(mock.history.post.length).toBe(1);
  });

  it("renders cached result without re-predicting", async () => {
    usePredictStore.setState({
      results: { "d-1": PR as never },
    });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);

    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByDisplayValue(/INV-001/)).toBeInTheDocument();
    expect(mock.history.post.length).toBe(0);
  });

  it("Re-predict button creates new version", async () => {
    usePredictStore.setState({ results: { "d-1": PR as never } });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, {
      ...PR, id: "pr-2", version: 3,
    });
    const user = userEvent.setup();
    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    await screen.findByDisplayValue(/INV-001/);
    await user.click(screen.getByRole("button", { name: /Re-predict/i }));
    await waitFor(() => expect(mock.history.post.length).toBe(1));
  });

  it("shows version + processor info", async () => {
    usePredictStore.setState({ results: { "d-1": PR as never } });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);

    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/v2/)).toBeInTheDocument();
    expect(await screen.findByText(/mock\|m/)).toBeInTheDocument();
  });

  it("close button calls onClose", async () => {
    usePredictStore.setState({ results: { "d-1": PR as never } });
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, []);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={onClose}
      />
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /关闭/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /关闭/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error when predict fails", async () => {
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(500, {
      error: { code: "predict_failed", message: "Engine boom" },
    });
    render(
      <PredictModal
        projectId="p-1"
        documentId="d-1"
        filename="invoice.pdf"
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/Engine boom/)).toBeInTheDocument();
  });
});

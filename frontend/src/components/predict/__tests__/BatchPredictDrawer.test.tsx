import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore } from "../../../stores/predict-store";
import BatchPredictDrawer from "../BatchPredictDrawer";

beforeEach(() => {
  usePredictStore.setState({
    loading: {}, results: {},
    batchProgress: null,
  });
});

afterEach(() => vi.clearAllMocks());

describe("BatchPredictDrawer", () => {
  it("renders nothing when batchProgress is null", () => {
    render(<BatchPredictDrawer onClose={vi.fn()} />);
    expect(screen.queryByText(/Batch/i)).not.toBeInTheDocument();
  });

  it("renders started/completed/failed events", () => {
    usePredictStore.setState({
      batchProgress: {
        total: 3,
        events: [
          { document_id: "d-1", status: "started" },
          { document_id: "d-2", status: "completed", processing_result_id: "pr-1" },
          { document_id: "d-3", status: "failed", error: "engine boom" },
        ],
        done: false, succeeded: 1, failed: 1,
      },
    });
    render(<BatchPredictDrawer onClose={vi.fn()} />);
    expect(screen.getByText(/d-1/)).toBeInTheDocument();
    expect(screen.getByText(/d-2/)).toBeInTheDocument();
    expect(screen.getByText(/engine boom/)).toBeInTheDocument();
  });

  it("close button calls onClose", async () => {
    usePredictStore.setState({
      batchProgress: {
        total: 1, events: [], done: true, succeeded: 0, failed: 0,
      },
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<BatchPredictDrawer onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /Done|Close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("done summary shows succeeded/failed counts", () => {
    usePredictStore.setState({
      batchProgress: {
        total: 2,
        events: [
          { document_id: "d-1", status: "completed" },
          { document_id: "d-2", status: "failed", error: "x" },
        ],
        done: true, succeeded: 1, failed: 1,
      },
    });
    render(<BatchPredictDrawer onClose={vi.fn()} />);
    expect(screen.getByText(/1.*succeeded/i)).toBeInTheDocument();
    expect(screen.getByText(/1.*failed/i)).toBeInTheDocument();
  });
});

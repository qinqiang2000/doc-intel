import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePredictStore, type Annotation } from "../../../stores/predict-store";
import JsonPreview from "../JsonPreview";

const ann = (
  field_name: string, partial: Partial<Annotation> = {}
): Annotation => ({
  id: `${field_name}-id`, document_id: "d-1",
  field_name, field_value: "v", field_type: "string",
  bounding_box: { x: 0, y: 0, w: 0.1, h: 0.05, page: 0 },
  source: "ai_detected", confidence: 0.9, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "", updated_at: "",
  ...partial,
});

beforeEach(() => {
  usePredictStore.setState({ apiFormat: "flat", currentStep: 0 });
});
afterEach(() => vi.clearAllMocks());

describe("JsonPreview", () => {
  it("renders structured_data as flat formatted JSON by default", () => {
    render(<JsonPreview structuredData={{ a: 1, b: "x" }} version={2} annotations={[]} />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it("shows placeholder when data is null", () => {
    render(<JsonPreview structuredData={null} version={null} annotations={[]} />);
    expect(screen.getByText(/尚无 predict 结果/)).toBeInTheDocument();
  });

  it("toggle to Detailed shows {value, confidence, bbox} per field", async () => {
    const user = userEvent.setup();
    render(
      <JsonPreview
        structuredData={{ invoice_number: "INV-1" }}
        version={1}
        annotations={[ann("invoice_number", { confidence: 0.88 })]}
      />
    );
    await user.click(screen.getByRole("button", { name: /Detailed/ }));
    expect(screen.getByText(/"value": "INV-1"/)).toBeInTheDocument();
    expect(screen.getByText(/"confidence": 0.88/)).toBeInTheDocument();
  });

  it("toggle to Grouped partitions buyer/seller/items/meta", async () => {
    const user = userEvent.setup();
    render(
      <JsonPreview
        structuredData={{
          buyer_name: "Acme",
          seller_name: "F9",
          items: [{ q: 1 }],
          invoice_number: "INV-1",
        }}
        version={1}
        annotations={[]}
      />
    );
    await user.click(screen.getByRole("button", { name: /Grouped/ }));
    expect(screen.getByText(/"buyer":/)).toBeInTheDocument();
    expect(screen.getByText(/"seller":/)).toBeInTheDocument();
    expect(screen.getByText(/"line_items":/)).toBeInTheDocument();
    expect(screen.getByText(/"meta":/)).toBeInTheDocument();
  });

  it("clicking a toggle button updates predict-store.apiFormat", async () => {
    const user = userEvent.setup();
    render(<JsonPreview structuredData={{ a: 1 }} version={1} annotations={[]} />);
    await user.click(screen.getByRole("button", { name: /Detailed/ }));
    expect(usePredictStore.getState().apiFormat).toBe("detailed");
    await user.click(screen.getByRole("button", { name: /Grouped/ }));
    expect(usePredictStore.getState().apiFormat).toBe("grouped");
    await user.click(screen.getByRole("button", { name: /Flat/ }));
    expect(usePredictStore.getState().apiFormat).toBe("flat");
  });

  it("highlights the active format button", () => {
    usePredictStore.setState({ apiFormat: "detailed" });
    render(<JsonPreview structuredData={{ a: 1 }} version={1} annotations={[]} />);
    const detailed = screen.getByRole("button", { name: /Detailed/ });
    expect(detailed).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Flat/ })).toHaveAttribute(
      "aria-pressed", "false"
    );
  });
});

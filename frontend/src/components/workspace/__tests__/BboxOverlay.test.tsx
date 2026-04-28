import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BboxOverlay from "../BboxOverlay";
import type { Annotation } from "../../../stores/predict-store";

const STUB_RECT: DOMRect = {
  x: 0, y: 0, width: 1000, height: 1400,
  top: 0, left: 0, right: 1000, bottom: 1400,
  toJSON() { return this; },
};

const ann = (id: string, partial?: Partial<Annotation>): Annotation => ({
  id, document_id: "d-1", field_name: `field-${id}`,
  field_value: "v", field_type: "string",
  bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 },
  source: "ai_detected", confidence: 0.95, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "", updated_at: "",
  ...partial,
});

describe("BboxOverlay", () => {
  it("renders one absolutely-positioned div per annotation with bbox", () => {
    const annotations = [ann("a-1"), ann("a-2")];
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
        pageNumber={1}
        pageRect={STUB_RECT}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    const boxes = screen.getAllByRole("button", { name: /field-/ });
    expect(boxes).toHaveLength(2);
  });

  it("skips annotations without bounding_box", () => {
    const annotations = [
      ann("a-1"),
      ann("a-2", { bounding_box: null }),
    ];
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
        pageNumber={1}
        pageRect={STUB_RECT}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    expect(screen.getAllByRole("button", { name: /field-/ })).toHaveLength(1);
  });

  it("colors bbox border by confidence (high green, low red)", () => {
    const annotations = [
      ann("hi", { confidence: 0.99 }),
      ann("mid", { confidence: 0.92 }),
      ann("lo", { confidence: 0.5 }),
    ];
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
        pageNumber={1}
        pageRect={STUB_RECT}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    const hi = screen.getByRole("button", { name: /field-hi/ });
    const mid = screen.getByRole("button", { name: /field-mid/ });
    const lo = screen.getByRole("button", { name: /field-lo/ });
    expect(hi.style.borderColor).toMatch(/22c55e|rgb\(34, 197, 94\)/);
    expect(mid.style.borderColor).toMatch(/f59e0b|rgb\(245, 158, 11\)/);
    expect(lo.style.borderColor).toMatch(/ef4444|rgb\(239, 68, 68\)/);
  });

  it("applies selected style when selectedAnnotationId matches", () => {
    const annotations = [ann("a-1")];
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        pageNumber={1}
        pageRect={STUB_RECT}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    const sel = screen.getByRole("button", { name: /field-a-1/ });
    expect(sel.style.borderColor).toMatch(/6366f1|rgb\(99, 102, 241\)/);
  });

  it("clicking a bbox calls onSelect with annotation id", async () => {
    const onSelect = vi.fn();
    const annotations = [ann("a-1"), ann("a-2")];
    const user = userEvent.setup();
    render(
      <BboxOverlay
        annotations={annotations}
        selectedAnnotationId={null}
        onSelect={onSelect}
        pageNumber={1}
        pageRect={STUB_RECT}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /field-a-1/ }));
    expect(onSelect).toHaveBeenCalledWith("a-1");
  });
});

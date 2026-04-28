import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BboxOverlay from "../BboxOverlay";
import type { Annotation } from "../../../stores/predict-store";

type BoundingBox_ = { x: number; y: number; w: number; h: number; page: number };

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

  it("renders 8 resize handles on selected bbox only", () => {
    const annotations = [ann("a-1"), ann("a-2")];
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={annotations}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    const handles = screen.getAllByTestId(/^bbox-handle-a-1-/);
    expect(handles).toHaveLength(8);
    expect(screen.queryAllByTestId(/^bbox-handle-a-2-/)).toHaveLength(0);
  });

  it("does not render handles when nothing is selected", () => {
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1")]}
        selectedAnnotationId={null}
        onSelect={vi.fn()}
        onPatchBbox={vi.fn()}
        onCreateBbox={vi.fn()}
      />
    );
    expect(screen.queryAllByTestId(/^bbox-handle-/)).toHaveLength(0);
  });

  it("dragging the bbox body calls onPatchBbox with shifted x/y on pointer-up", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 0 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const box = screen.getByRole("button", { name: /field-a-1/ });

    fireEvent.pointerDown(box, { clientX: 200, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(box, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(box,   { clientX: 300, clientY: 200, pointerId: 1 });

    // 100 px / 1000 px = 0.1 fraction; new x = 0.1 + 0.1 = 0.2
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch.mock.calls[0][0]).toBe("a-1");
    const sent = onPatch.mock.calls[0][1] as BoundingBox_;
    expect(sent.x).toBeCloseTo(0.2, 3);
    expect(sent.y).toBeCloseTo(0.1, 3);
    expect(sent.w).toBeCloseTo(0.2, 3);
    expect(sent.h).toBeCloseTo(0.05, 3);
    expect(sent.page).toBe(0);
  });

  it("does NOT call onPatchBbox when pointer-up fires without movement (click-only)", async () => {
    const onPatch = vi.fn();
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1")]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const box = screen.getByRole("button", { name: /field-a-1/ });
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(box,   { clientX: 100, clientY: 100, pointerId: 1 });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("clamps x to [0, 1-w] when drag would push beyond page edge", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={1}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.7, y: 0.1, w: 0.2, h: 0.05, page: 0 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const box = screen.getByRole("button", { name: /field-a-1/ });
    fireEvent.pointerDown(box, { clientX: 800, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(box, { clientX: 1300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(box,   { clientX: 1300, clientY: 200, pointerId: 1 });

    const sent = onPatch.mock.calls[0][1] as BoundingBox_;
    // Clamped: max x = 1 - 0.2 = 0.8
    expect(sent.x).toBeCloseTo(0.8, 3);
  });

  it("preserves bbox.page from the existing annotation when patching", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <BboxOverlay
        pageNumber={2}
        pageRect={STUB_RECT}
        annotations={[ann("a-1", { bounding_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05, page: 1 } })]}
        selectedAnnotationId="a-1"
        onSelect={vi.fn()}
        onPatchBbox={onPatch}
        onCreateBbox={vi.fn()}
      />
    );
    const box = screen.getByRole("button", { name: /field-a-1/ });
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(box, { clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(box,   { clientX: 150, clientY: 100, pointerId: 1 });

    const sent = onPatch.mock.calls[0][1] as BoundingBox_;
    expect(sent.page).toBe(1);
  });
});

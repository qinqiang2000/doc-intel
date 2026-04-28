import { useRef, useState } from "react";
import type { Annotation } from "../../stores/predict-store";

type BoundingBox = { x: number; y: number; w: number; h: number; page: number };

interface Props {
  pageNumber: number;
  pageRect: DOMRect;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelect: (id: string | null) => void;
  onPatchBbox: (id: string, bbox: BoundingBox) => Promise<void>;
  onCreateBbox: (bbox: BoundingBox, fieldName: string) => Promise<void>;
}

const COLOR_SELECTED = "#6366f1";
const COLOR_HI = "#22c55e";
const COLOR_MID = "#f59e0b";
const COLOR_LO = "#ef4444";

const HANDLE_KEYS = ["nw","n","ne","e","se","s","sw","w"] as const;
type HandleKey = typeof HANDLE_KEYS[number];

const HANDLE_CLASS: Record<HandleKey, string> = {
  nw: "left-0 top-0 cursor-nwse-resize",
  n:  "left-1/2 top-0 cursor-ns-resize",
  ne: "left-full top-0 cursor-nesw-resize",
  e:  "left-full top-1/2 cursor-ew-resize",
  se: "left-full top-full cursor-nwse-resize",
  s:  "left-1/2 top-full cursor-ns-resize",
  sw: "left-0 top-full cursor-nesw-resize",
  w:  "left-0 top-1/2 cursor-ew-resize",
};

function colorFor(a: Annotation, isSelected: boolean): string {
  if (isSelected) return COLOR_SELECTED;
  const c = a.confidence;
  if (c == null) return COLOR_LO;
  if (c >= 0.95) return COLOR_HI;
  if (c >= 0.90) return COLOR_MID;
  return COLOR_LO;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface DragState {
  id: string;
  origin: { x: number; y: number };
  origBbox: BoundingBox;
  moved: boolean;
  delta: { dx: number; dy: number };
}

export default function BboxOverlay({
  pageNumber, pageRect, annotations, selectedAnnotationId, onSelect,
  onPatchBbox,
  onCreateBbox: _onCreateBbox,
}: Props) {
  void pageNumber;
  void _onCreateBbox;
  const [drag, setDrag] = useState<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function handleBodyPointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    a: Annotation
  ) {
    if (a.bounding_box == null) return;
    e.stopPropagation();
    onSelect(a.id);
    setDrag({
      id: a.id,
      origin: { x: e.clientX, y: e.clientY },
      origBbox: a.bounding_box as BoundingBox,
      moved: false,
      delta: { dx: 0, dy: 0 },
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleBodyPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const dx = e.clientX - drag.origin.x;
    const dy = e.clientY - drag.origin.y;
    setDrag({ ...drag, delta: { dx, dy }, moved: drag.moved || dx !== 0 || dy !== 0 });
  }

  async function handleBodyPointerUp(
    e: React.PointerEvent<HTMLButtonElement>,
    a: Annotation
  ) {
    if (!drag || drag.id !== a.id) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const { dx, dy } = drag.delta;
    const moved = drag.moved;
    setDrag(null);
    if (!moved) return;
    const fx = dx / pageRect.width;
    const fy = dy / pageRect.height;
    const ob = drag.origBbox;
    const newBbox: BoundingBox = {
      x: clamp(ob.x + fx, 0, 1 - ob.w),
      y: clamp(ob.y + fy, 0, 1 - ob.h),
      w: ob.w,
      h: ob.h,
      page: ob.page,
    };
    try {
      await onPatchBbox(a.id, newBbox);
    } catch (err) {
      console.error("[BboxOverlay] patch failed", err);
    }
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      {annotations
        .filter((a) => a.bounding_box != null)
        .map((a) => {
          const bbox = a.bounding_box! as BoundingBox;
          const isSelected = selectedAnnotationId === a.id;
          const color = colorFor(a, isSelected);
          const isDragging = drag?.id === a.id && drag.moved;
          const xPct = isDragging
            ? (bbox.x + drag.delta.dx / pageRect.width) * 100
            : bbox.x * 100;
          const yPct = isDragging
            ? (bbox.y + drag.delta.dy / pageRect.height) * 100
            : bbox.y * 100;
          return (
            <button
              key={a.id}
              type="button"
              aria-label={a.field_name}
              onPointerDown={(e) => handleBodyPointerDown(e, a)}
              onPointerMove={handleBodyPointerMove}
              onPointerUp={(e) => void handleBodyPointerUp(e, a)}
              onClick={(e) => {
                e.stopPropagation();
                if (!drag || !drag.moved) onSelect(a.id);
              }}
              className="absolute pointer-events-auto cursor-move"
              style={{
                left: `${xPct}%`,
                top: `${yPct}%`,
                width: `${bbox.w * 100}%`,
                height: `${bbox.h * 100}%`,
                border: `${isSelected ? 4 : 2}px solid ${color}`,
                backgroundColor: `${color}1f`,
                padding: 0,
                boxSizing: "border-box",
              }}
            >
              <span
                className="absolute -top-5 left-0 text-[9px] font-semibold text-white px-1 rounded-t pointer-events-none"
                style={{ backgroundColor: color }}
              >
                {a.field_name}
                {a.confidence != null && ` ${Math.round(a.confidence * 100)}%`}
              </span>
              {isSelected && HANDLE_KEYS.map((h) => (
                <span
                  key={h}
                  data-testid={`bbox-handle-${a.id}-${h}`}
                  className={`absolute pointer-events-auto bg-[#6366f1] ${HANDLE_CLASS[h]}`}
                  style={{ width: 8, height: 8, marginLeft: -4, marginTop: -4 }}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ))}
            </button>
          );
        })}
    </div>
  );
}

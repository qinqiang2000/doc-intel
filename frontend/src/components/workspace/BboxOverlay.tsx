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

export default function BboxOverlay({
  annotations, selectedAnnotationId, onSelect,
  // T5+ uses these; reference them so unused-var lint stays quiet
  pageNumber: _pageNumber, pageRect: _pageRect,
  onPatchBbox: _onPatchBbox, onCreateBbox: _onCreateBbox,
}: Props) {
  void _pageNumber;
  void _pageRect;
  void _onPatchBbox;
  void _onCreateBbox;
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      {annotations
        .filter((a) => a.bounding_box != null)
        .map((a) => {
          const bbox = a.bounding_box!;
          const isSelected = selectedAnnotationId === a.id;
          const color = colorFor(a, isSelected);
          return (
            <button
              key={a.id}
              type="button"
              aria-label={a.field_name}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(a.id);
              }}
              className="absolute pointer-events-auto cursor-pointer"
              style={{
                left: `${bbox.x * 100}%`,
                top: `${bbox.y * 100}%`,
                width: `${bbox.w * 100}%`,
                height: `${bbox.h * 100}%`,
                border: `${isSelected ? 4 : 2}px solid ${color}`,
                backgroundColor: `${color}1f`,
                padding: 0,
                boxSizing: "border-box",
              }}
            >
              <span
                className="absolute -top-5 left-0 text-[9px] font-semibold text-white px-1 rounded-t"
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

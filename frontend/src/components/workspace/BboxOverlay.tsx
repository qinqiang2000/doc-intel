import type { Annotation } from "../../stores/predict-store";

interface Props {
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelect: (id: string | null) => void;
}

const COLOR_SELECTED = "#6366f1";    // indigo
const COLOR_HI = "#22c55e";          // green
const COLOR_MID = "#f59e0b";         // amber
const COLOR_LO = "#ef4444";          // red

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
}: Props) {
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
            </button>
          );
        })}
    </div>
  );
}

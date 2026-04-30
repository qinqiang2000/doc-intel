import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePredictStore,
  type Annotation, type AnnotationPatch, type NewAnnotation,
} from "../../stores/predict-store";
import { toast } from "../../lib/toast";

interface Props {
  annotations: Annotation[];
  onPatch: (id: string, patch: AnnotationPatch) => Promise<Annotation>;
  /** Calls the backend DELETE — not invoked until the undo window expires. */
  onDelete: (id: string) => Promise<void>;
  onAdd: (input: NewAnnotation) => Promise<Annotation>;
  /** Optimistically removes the row from the parent's list. */
  onRemoveLocal: (id: string) => void;
  /** Restores a row to the parent's list when the user clicks Undo. */
  onRestoreLocal: (a: Annotation) => void;
}

const UNDO_DURATION_MS = 5000;

export default function AnnotationEditor({
  annotations, onPatch, onDelete, onAdd, onRemoveLocal, onRestoreLocal,
}: Props) {
  const { t } = useTranslation();
  const selectedAnnotationId = usePredictStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = usePredictStore((s) => s.setSelectedAnnotationId);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newType, setNewType] = useState("string");
  const [error, setError] = useState<string | null>(null);

  const selectedRowRef = useRef<HTMLDivElement | null>(null);

  // Track pending deletes so they can be flushed if the component unmounts
  // before the undo window elapses (otherwise the timeout would never fire
  // its server-side delete).
  const pendingRef = useRef<Map<string, { annotation: Annotation; cancel: () => void; flush: () => void }>>(new Map());

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedAnnotationId]);

  useEffect(() => {
    // Capture the ref so the cleanup closure isn't reading a possibly-changed
    // value at the moment the component unmounts.
    const map = pendingRef.current;
    return () => {
      // On unmount: synchronously commit any deletes still in their undo window
      // so they don't get silently lost. The server call itself is fire-and-forget.
      map.forEach((entry) => entry.flush());
      map.clear();
    };
  }, []);

  async function handleBlur(a: Annotation, value: string) {
    if (value === a.field_value) return;
    try {
      await onPatch(a.id, { field_value: value });
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? t("common.saveFailed"));
    }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    try {
      await onAdd({ field_name: newName, field_value: newValue, field_type: newType });
      setNewName(""); setNewValue(""); setNewType("string"); setAdding(false);
    } catch (e) {
      setError((e as { message?: string })?.message ?? t("common.addFailed"));
    }
  }

  function requestDelete(a: Annotation) {
    onRemoveLocal(a.id);
    if (selectedAnnotationId === a.id) setSelectedAnnotationId(null);

    let timer: ReturnType<typeof setTimeout> | null = null;
    let committed = false;

    const commit = () => {
      if (committed) return;
      committed = true;
      pendingRef.current.delete(a.id);
      void onDelete(a.id).catch((e) => {
        // Server delete failed — restore the row and notify the user.
        onRestoreLocal(a);
        toast.error(
          (e as { message?: string })?.message ?? t("common.saveFailed"),
        );
      });
    };

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pendingRef.current.delete(a.id);
    };

    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      commit();
    };

    pendingRef.current.set(a.id, { annotation: a, cancel, flush });

    timer = setTimeout(commit, UNDO_DURATION_MS);

    toast.withAction(
      t("workspacePage.deleteFieldUndo", { name: a.field_name }),
      "info",
      {
        label: t("workspacePage.undo"),
        onClick: () => {
          cancel();
          onRestoreLocal(a);
          toast.info(t("workspacePage.restored"), 1500);
        },
      },
      { duration: UNDO_DURATION_MS },
    );
  }

  return (
    <div className="space-y-2">
      {annotations.map((a) => {
        const isSelected = selectedAnnotationId === a.id;
        return (
          <div
            key={a.id}
            data-row-id={a.id}
            ref={isSelected ? selectedRowRef : null}
            onClick={() => setSelectedAnnotationId(a.id)}
            className={`flex items-center gap-2 text-sm rounded px-1 py-0.5 cursor-pointer ${
              isSelected ? "border-2 border-accent bg-surface" : "border-2 border-transparent"
            }`}
          >
            <span className="text-xs text-muted w-32 truncate" title={a.field_name}>
              {a.field_name}
            </span>
            <input
              type="text"
              defaultValue={a.field_value ?? ""}
              onBlur={(e) => void handleBlur(a, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-surface-input border border-default rounded px-2 py-1 text-sm focus:border-accent outline-none"
            />
            <span className="text-xs">
              {a.source === "ai_detected" ? "🤖" : "✏️"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                requestDelete(a);
              }}
              aria-label={t("workspacePage.deleteAriaLabel")}
              title={t("common.delete")}
              className="text-muted hover:text-danger transition-colors p-1"
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="bg-surface-input border border-default rounded p-2 space-y-2">
          <label className="block text-xs">
            {t("workspacePage.fieldName")}
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              className="ml-2 bg-surface border border-default rounded px-2 py-0.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            {t("workspacePage.value")}
            <input
              value={newValue} onChange={(e) => setNewValue(e.target.value)}
              className="ml-2 bg-surface border border-default rounded px-2 py-0.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            {t("workspacePage.fieldType")}
            <select
              value={newType} onChange={(e) => setNewType(e.target.value)}
              className="ml-2 bg-surface border border-default rounded px-2 py-0.5 text-sm"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="array">array</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button" onClick={() => void handleAdd()}
              className="bg-accent text-white text-xs px-3 py-1 rounded"
            >
              {t("common.save")}
            </button>
            <button
              type="button" onClick={() => setAdding(false)}
              className="text-xs text-muted"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button" onClick={() => setAdding(true)}
          className="text-xs text-accent hover:underline"
        >
          {t("workspacePage.addField")}
        </button>
      )}

      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  usePredictStore, type Annotation,
} from "../../stores/predict-store";
import AnnotationEditor from "./AnnotationEditor";

interface Props {
  projectId: string;
  documentId: string;
  filename: string;
  onClose: () => void;
}

export default function PredictModal({
  projectId, documentId, filename, onClose,
}: Props) {
  const result = usePredictStore((s) => s.results[documentId]);
  const loading = usePredictStore((s) => s.loading[documentId] ?? false);
  const predictSingle = usePredictStore((s) => s.predictSingle);
  const loadAnnotations = usePredictStore((s) => s.loadAnnotations);
  const patchAnnotation = usePredictStore((s) => s.patchAnnotation);
  const deleteAnnotation = usePredictStore((s) => s.deleteAnnotation);
  const addAnnotation = usePredictStore((s) => s.addAnnotation);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reloadAnnotations() {
    try {
      const arr = await loadAnnotations(documentId);
      setAnnotations(arr);
    } catch (e) {
      // non-fatal — keep empty
    }
  }

  async function runPredict() {
    setError(null);
    try {
      await predictSingle(projectId, documentId);
      await reloadAnnotations();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Predict failed");
    }
  }

  useEffect(() => {
    if (!result) {
      void runPredict();
    } else {
      void reloadAnnotations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function handlePatch(id: string, patch: { field_value?: string | null }) {
    const out = await patchAnnotation(documentId, id, patch);
    setAnnotations((arr) => arr.map((a) => (a.id === id ? out : a)));
    return out;
  }

  async function handleDelete(id: string) {
    await deleteAnnotation(documentId, id);
    setAnnotations((arr) => arr.filter((a) => a.id !== id));
  }

  async function handleAdd(input: Parameters<typeof addAnnotation>[1]) {
    const out = await addAnnotation(documentId, input);
    setAnnotations((arr) => [...arr, out]);
    return out;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="px-5 py-3 border-b border-[#2a2e3d] flex items-center justify-between">
          <h2 className="font-semibold">Predict — {filename}</h2>
          <button
            type="button" onClick={onClose}
            className="text-[#94a3b8] hover:text-[#e2e8f0]"
          >
            关闭
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="text-center">
            <img
              src={`${(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000"}/api/v1/projects/${projectId}/documents/${documentId}/preview`}
              alt={filename}
              className="max-w-full mx-auto border border-[#2a2e3d]"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="text-xs text-[#94a3b8] mt-2">{filename}</div>
          </div>

          <div>
            {loading && !result && (
              <div className="text-sm text-[#94a3b8]">⏳ Running predict (10-30s)...</div>
            )}
            {error && <div className="text-sm text-[#ef4444] mb-3">{error}</div>}
            {result && (
              <>
                <div className="text-xs text-[#94a3b8] mb-3">
                  v{result.version} · {result.processor_key}
                </div>
                <AnnotationEditor
                  annotations={annotations}
                  onPatch={handlePatch}
                  onDelete={handleDelete}
                  onAdd={handleAdd}
                />
              </>
            )}
          </div>
        </div>

        <footer className="px-5 py-3 border-t border-[#2a2e3d] flex items-center justify-end gap-3">
          <button
            type="button" onClick={() => void runPredict()}
            disabled={loading}
            className="text-sm text-[#6366f1] hover:underline disabled:opacity-50"
          >
            Re-predict
          </button>
        </footer>
      </div>
    </div>
  );
}

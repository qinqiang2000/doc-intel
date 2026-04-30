import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  workspaceSlug: string;
  projectId: string;
  projectName: string;
  documents: { id: string; filename: string }[];
  currentDocId: string;
  onSwitch: (docId: string) => void;
}

export default function WorkspaceToolbar({
  workspaceSlug, projectId, projectName, documents, currentDocId, onSwitch,
}: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const loadNextUnreviewed = usePredictStore((s) => s.loadNextUnreviewed);
  const setPromptHistoryOpen = usePredictStore((s) => s.setPromptHistoryOpen);
  const promptHistoryOpen = usePredictStore((s) => s.promptHistoryOpen);
  const [open, setOpen] = useState(false);

  const idx = documents.findIndex((d) => d.id === currentDocId);
  const current = idx >= 0 ? documents[idx] : null;
  const prev = idx > 0 ? documents[idx - 1] : null;
  const next = idx >= 0 && idx < documents.length - 1 ? documents[idx + 1] : null;

  async function onNext() {
    const doc = await loadNextUnreviewed(projectId);
    if (doc) {
      onSwitch(doc.id);
    } else {
      alert(t("documents.allPredicted"));
    }
  }

  return (
    <div className="bg-surface border-b border-default px-4 py-2 flex items-center gap-3 text-sm">
      <button
        type="button"
        onClick={() => navigate(`/workspaces/${workspaceSlug}/projects/${projectId}`)}
        className="text-muted hover:text-primary flex items-center gap-1"
        title={t("toolbar.backToProject")}
      >
        ◀ <span>{projectName}</span>
      </button>

      <span className="text-default">|</span>

      <span className="text-xs">📄</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="bg-surface-input border border-default rounded px-3 py-1 hover:border-accent flex items-center gap-2"
        >
          <span className="font-medium">{current ? current.filename : t("toolbar.selectDocument")}</span>
          <span className="text-subtle">▾</span>
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-surface border border-default rounded shadow-lg z-50 max-h-80 overflow-auto">
            {documents.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onSwitch(d.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover ${
                  d.id === currentDocId ? "text-accent-hover" : "text-primary"
                }`}
              >
                {d.id === currentDocId && "● "}{d.filename}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && onSwitch(prev.id)}
        className="text-xs text-muted hover:text-primary disabled:opacity-30"
      >
        {t("toolbar.previousDoc")}
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && onSwitch(next.id)}
        className="text-xs text-muted hover:text-primary disabled:opacity-30"
      >
        {t("toolbar.nextDoc")}
      </button>

      <button
        type="button"
        onClick={() => void onNext()}
        className="text-xs text-accent hover:underline ml-auto"
      >
        {t("toolbar.nextUnreviewed")}
      </button>
      <button
        type="button"
        onClick={() => setPromptHistoryOpen(!promptHistoryOpen)}
        title={t("workspacePage.promptHistoryTooltip")}
        className="text-xs text-muted hover:text-primary"
      >
        📜
      </button>
    </div>
  );
}

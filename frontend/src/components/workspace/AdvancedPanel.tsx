import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  projectId: string;
  documentId: string;
}

export default function AdvancedPanel({ projectId, documentId }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const processorOverride = usePredictStore((s) => s.processorOverride);
  const promptOverride = usePredictStore((s) => s.promptOverride);
  const setProcessorOverride = usePredictStore((s) => s.setProcessorOverride);
  const setPromptOverride = usePredictStore((s) => s.setPromptOverride);
  const predictSingle = usePredictStore((s) => s.predictSingle);
  const loading = usePredictStore((s) => s.loading[documentId] ?? false);

  async function handleRepredict() {
    const opts: { processorKeyOverride?: string; promptOverride?: string } = {};
    if (processorOverride.trim()) opts.processorKeyOverride = processorOverride.trim();
    if (promptOverride.trim()) opts.promptOverride = promptOverride.trim();
    try {
      await predictSingle(projectId, documentId, opts);
    } catch {
      /* surfaces via store */
    }
  }

  return (
    <div className="bg-surface border border-default rounded mb-3">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-muted hover:text-primary flex items-center gap-1"
        >
          ⚙️ {t("workspacePage.advanced")} {expanded ? "▴" : "▾"}
        </button>
        <button
          type="button"
          onClick={() => void handleRepredict()}
          disabled={loading}
          className="text-xs bg-accent hover:bg-accent-hover text-white font-semibold px-3 py-1 rounded disabled:opacity-50"
        >
          {loading ? t("workspacePage.predicting") : t("workspacePage.rePredict")}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <label className="block text-xs">
            <span className="text-muted">{t("workspacePage.processorOverride")}</span>
            <input
              type="text"
              aria-label="processor"
              value={processorOverride}
              onChange={(e) => setProcessorOverride(e.target.value)}
              placeholder={t("workspacePage.processorPlaceholder")}
              className="mt-1 w-full bg-surface-input border border-default rounded px-2 py-1 text-sm font-mono"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted">{t("workspacePage.promptOverride")}</span>
            <textarea
              aria-label="prompt"
              value={promptOverride}
              onChange={(e) => setPromptOverride(e.target.value)}
              placeholder={t("workspacePage.promptPlaceholder")}
              rows={5}
              className="mt-1 w-full bg-surface-input border border-default rounded px-2 py-1 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}

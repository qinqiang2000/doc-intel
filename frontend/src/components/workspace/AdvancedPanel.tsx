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
    <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded mb-3">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] flex items-center gap-1"
        >
          ⚙️ {t("workspacePage.advanced")} {expanded ? "▴" : "▾"}
        </button>
        <button
          type="button"
          onClick={() => void handleRepredict()}
          disabled={loading}
          className="text-xs bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold px-3 py-1 rounded disabled:opacity-50"
        >
          {loading ? t("workspacePage.predicting") : t("workspacePage.rePredict")}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <label className="block text-xs">
            <span className="text-[#94a3b8]">{t("workspacePage.processorOverride")}</span>
            <input
              type="text"
              aria-label="processor"
              value={processorOverride}
              onChange={(e) => setProcessorOverride(e.target.value)}
              placeholder={t("workspacePage.processorPlaceholder")}
              className="mt-1 w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm font-mono"
            />
          </label>
          <label className="block text-xs">
            <span className="text-[#94a3b8]">{t("workspacePage.promptOverride")}</span>
            <textarea
              aria-label="prompt"
              value={promptOverride}
              onChange={(e) => setPromptOverride(e.target.value)}
              placeholder={t("workspacePage.promptPlaceholder")}
              rows={5}
              className="mt-1 w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}

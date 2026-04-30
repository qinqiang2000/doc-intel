import { useTranslation } from "react-i18next";
import { usePredictStore } from "../../stores/predict-store";

interface ResultTabsProps {
  documentId: string;
  onRunPredict?: () => void;
  predicting?: boolean;
}

function shortKey(processorKey: string): string {
  const parts = processorKey.split("|", 2);
  if (parts.length === 2) return `${parts[0]}|${parts[1]}`;
  return processorKey;
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function ResultTabs({
  documentId, onRunPredict, predicting,
}: ResultTabsProps) {
  const { t } = useTranslation();
  const list = usePredictStore((s) => s.resultsByDoc[documentId] ?? []);
  const selectedId = usePredictStore((s) => s.selectedResultByDoc[documentId]);
  const setSelected = usePredictStore((s) => s.setSelectedResult);

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-default overflow-x-auto bg-canvas">
      {list.length === 0 ? (
        <div className="text-xs text-muted">
          {t("workspacePage.noPredictionsYet")}
        </div>
      ) : (
        list.map((r) => {
          const isActive = r.id === selectedId;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(documentId, r.id)}
              title={`v${r.version} · ${formatTime(r.created_at)}`}
              className={
                "flex items-center gap-2 px-3 py-1 rounded-t-md text-xs whitespace-nowrap " +
                (isActive
                  ? "bg-surface text-primary border-b-2 border-info"
                  : "text-muted hover:text-primary hover:bg-surface")
              }
            >
              <span className="font-mono">{shortKey(r.processor_key)}</span>
              <span className="text-[10px] opacity-70">v{r.version}</span>
            </button>
          );
        })
      )}
      <div className="ml-auto">
        {onRunPredict && (
          <button
            type="button"
            onClick={onRunPredict}
            disabled={predicting}
            className="px-2 py-1 text-xs rounded bg-info hover:bg-accent-hover disabled:opacity-50 text-white"
          >
            {predicting ? t("workspacePage.predicting") : t("workspacePage.runPrediction")}
          </button>
        )}
      </div>
    </div>
  );
}

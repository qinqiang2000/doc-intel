import { useTranslation } from "react-i18next";
import { usePredictStore, type ProcessingResult } from "../../stores/predict-store";

interface ResultTabsProps {
  documentId: string;
  onRunPredict?: () => void;
  predicting?: boolean;
}

const EMPTY_RESULTS: ProcessingResult[] = [];

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
  const list = usePredictStore((s) => s.resultsByDoc[documentId] ?? EMPTY_RESULTS);
  const selectedId = usePredictStore((s) => s.selectedResultByDoc[documentId]);
  const setSelected = usePredictStore((s) => s.setSelectedResult);

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2a2e3d] overflow-x-auto bg-[#0f1117]">
      {list.length === 0 ? (
        <div className="text-xs text-[#94a3b8]">
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
              title={formatTime(r.updated_at || r.created_at)}
              className={
                "flex items-center gap-2 px-3 py-1 rounded-t-md text-xs whitespace-nowrap " +
                (isActive
                  ? "bg-[#1a1d27] text-[#e2e8f0] border-b-2 border-info"
                  : "text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1a1d27]")
              }
            >
              <span className="font-mono">{shortKey(r.processor_key)}</span>
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
            className="px-2 py-1 text-xs rounded bg-[#3b82f6] hover:bg-[#818cf8] disabled:opacity-50 text-white"
          >
            {predicting ? t("workspacePage.predicting") : t("workspacePage.runPrediction")}
          </button>
        )}
      </div>
    </div>
  );
}

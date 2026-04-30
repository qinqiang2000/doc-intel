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
  const list = usePredictStore((s) => s.resultsByDoc[documentId] ?? []);
  const selectedId = usePredictStore((s) => s.selectedResultByDoc[documentId]);
  const setSelected = usePredictStore((s) => s.setSelectedResult);

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2a2e3d] overflow-x-auto bg-[#0f1117]">
      {list.length === 0 ? (
        <div className="text-xs text-[#94a3b8]">
          No predictions yet — click Re-predict in Advanced settings to run extraction.
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
                  ? "bg-[#1e2230] text-white border-b-2 border-[#3b82f6]"
                  : "text-[#94a3b8] hover:text-white hover:bg-[#1a1d27]")
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
            className="px-2 py-1 text-xs rounded bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 text-white"
          >
            {predicting ? "Predicting..." : "+ Run prediction"}
          </button>
        )}
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  onClose: () => void;
}

export default function BatchPredictDrawer({ onClose }: Props) {
  const { t } = useTranslation();
  const progress = usePredictStore((s) => s.batchProgress);
  if (!progress) return null;

  return (
    <aside className="fixed top-0 right-0 h-full w-96 bg-[#1a1d27] border-l border-[#2a2e3d] shadow-xl z-40 flex flex-col">
      <header className="px-4 py-3 border-b border-[#2a2e3d]">
        <h2 className="font-semibold text-sm">
          {t("documents.batchPredictTitle", {
            done: progress.events.length,
            total: progress.total,
          })}
        </h2>
      </header>

      <ul className="flex-1 overflow-auto p-3 space-y-1 text-xs">
        {progress.events.map((e, idx) => (
          <li
            key={`${e.document_id}-${idx}`}
            className={
              e.status === "completed"
                ? "text-[#22c55e]"
                : e.status === "failed"
                ? "text-[#ef4444]"
                : "text-[#94a3b8]"
            }
          >
            {e.status === "completed" ? "✓" : e.status === "failed" ? "✗" : "⋯"}{" "}
            {e.document_id}
            {e.error && ` — ${e.error}`}
          </li>
        ))}
      </ul>

      {progress.done && (
        <div className="px-4 py-2 border-t border-[#2a2e3d] text-xs">
          <span className="text-[#22c55e]">
            {t("documents.batchSucceeded", { count: progress.succeeded })}
          </span>
          {" · "}
          <span className="text-[#ef4444]">
            {t("documents.batchFailed", { count: progress.failed })}
          </span>
        </div>
      )}

      <footer className="px-4 py-3 border-t border-[#2a2e3d] flex justify-end">
        <button
          type="button" onClick={onClose}
          className="text-sm text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          {progress.done ? t("common.done") : t("common.close")}
        </button>
      </footer>
    </aside>
  );
}

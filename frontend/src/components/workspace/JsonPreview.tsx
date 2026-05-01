import { useTranslation } from "react-i18next";
import { transform, type JsonFormat } from "../../lib/json-formats";
import { usePredictStore, type Annotation } from "../../stores/predict-store";

interface Props {
  structuredData: Record<string, unknown> | null;
  annotations: Annotation[];
}

const FORMATS: JsonFormat[] = ["flat", "detailed", "grouped"];
const LABELS: Record<JsonFormat, string> = {
  flat: "Flat",
  detailed: "Detailed",
  grouped: "Grouped",
};

export default function JsonPreview({ structuredData, annotations }: Props) {
  const { t } = useTranslation();
  const apiFormat = usePredictStore((s) => s.apiFormat);
  const setApiFormat = usePredictStore((s) => s.setApiFormat);

  const transformed = transform(apiFormat, { structuredData, annotations });
  const body =
    transformed === null
      ? null
      : JSON.stringify(transformed, null, 2);

  return (
    <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8]">
          {t("workspacePage.structuredData")}
        </div>
        <div className="flex gap-1">
          {FORMATS.map((f) => {
            const active = f === apiFormat;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => setApiFormat(f)}
                className={`text-xs px-2 py-0.5 rounded ${
                  active
                    ? "bg-[#6366f1] text-white"
                    : "bg-[#0f1117] text-[#94a3b8] hover:text-[#e2e8f0]"
                }`}
              >
                {LABELS[f]}
              </button>
            );
          })}
        </div>
      </div>
      {body !== null ? (
        <pre
          className="text-xs leading-relaxed whitespace-pre-wrap text-[#a5f3fc]"
          style={{ fontFamily: "Fira Code, Courier New, monospace" }}
        >
          {body}
        </pre>
      ) : (
        <div className="text-xs text-[#64748b]">{t("workspacePage.noPrediction")}</div>
      )}
    </div>
  );
}

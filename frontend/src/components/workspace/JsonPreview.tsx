import { useTranslation } from "react-i18next";
import { transform, type JsonFormat } from "../../lib/json-formats";
import { usePredictStore, type Annotation } from "../../stores/predict-store";

interface Props {
  structuredData: Record<string, unknown> | null;
  version: number | null;
  annotations: Annotation[];
}

const FORMATS: JsonFormat[] = ["flat", "detailed", "grouped"];
const LABELS: Record<JsonFormat, string> = {
  flat: "Flat",
  detailed: "Detailed",
  grouped: "Grouped",
};

export default function JsonPreview({ structuredData, version, annotations }: Props) {
  const { t } = useTranslation();
  const apiFormat = usePredictStore((s) => s.apiFormat);
  const setApiFormat = usePredictStore((s) => s.setApiFormat);

  const transformed = transform(apiFormat, { structuredData, annotations });
  const body =
    transformed === null
      ? null
      : JSON.stringify(transformed, null, 2);

  return (
    <div className="bg-surface border border-default rounded p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase font-semibold tracking-wider text-muted">
          {t("workspacePage.structuredData")}{version != null && ` · v${version}`}
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
                    ? "bg-accent text-white"
                    : "bg-surface-input text-muted hover:text-primary"
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
          className="text-xs leading-relaxed whitespace-pre-wrap text-code"
          style={{ fontFamily: "Fira Code, Courier New, monospace" }}
        >
          {body}
        </pre>
      ) : (
        <div className="text-xs text-subtle">{t("workspacePage.noPrediction")}</div>
      )}
    </div>
  );
}

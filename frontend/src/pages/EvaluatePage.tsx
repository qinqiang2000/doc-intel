import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  usePredictStore,
  type EvaluationRun,
  type EvaluationFieldResult,
} from "../stores/predict-store";

export default function EvaluatePage() {
  const { slug, pid } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const listEvaluations = usePredictStore((s) => s.listEvaluations);
  const runEvaluation = usePredictStore((s) => s.runEvaluation);
  const getEvaluationDetail = usePredictStore((s) => s.getEvaluationDetail);
  const deleteEvaluation = usePredictStore((s) => s.deleteEvaluation);
  const downloadEvaluationExcel = usePredictStore((s) => s.downloadEvaluationExcel);

  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    run: EvaluationRun;
    fields: EvaluationFieldResult[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    void (async () => {
      try {
        const out = await listEvaluations(pid);
        if (!cancelled) {
          setRuns(out);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as { message?: string }).message ?? t("evaluate.loadFailed"));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pid, listEvaluations, t]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await getEvaluationDetail(selectedRunId);
        if (!cancelled) setDetail(d);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, getEvaluationDetail]);

  async function handleRun() {
    if (!pid || running) return;
    setRunning(true);
    try {
      const newRun = await runEvaluation(pid, "");
      const refreshed = await listEvaluations(pid);
      setRuns(refreshed);
      setSelectedRunId(newRun.id);
    } catch (e) {
      setError((e as { message?: string }).message ?? t("evaluate.runFailed"));
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete(rid: string) {
    if (!pid) return;
    if (!confirm(t("evaluate.deleteRunConfirm"))) return;
    await deleteEvaluation(rid);
    if (selectedRunId === rid) setSelectedRunId(null);
    const refreshed = await listEvaluations(pid);
    setRuns(refreshed);
  }

  async function handleDownload(rid: string) {
    await downloadEvaluationExcel(rid);
  }

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => slug && pid && navigate(`/workspaces/${slug}/projects/${pid}`)}
          className="text-xs text-muted hover:text-primary"
        >
          {t("evaluate.back")}
        </button>
        <h1 className="text-lg font-semibold">{t("evaluate.title")}</h1>
        <div />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          disabled={running}
          onClick={() => void handleRun()}
          className="bg-accent text-white px-3 py-1 rounded text-sm disabled:opacity-50"
        >
          {running ? t("evaluate.running") : t("evaluate.runEvaluation")}
        </button>
        <span className="text-xs text-subtle">{t("evaluate.annotateFirst")}</span>
      </div>

      {error && (
        <div className="text-xs text-danger bg-danger-soft border border-danger rounded p-2 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-muted">{t("evaluate.loading")}</div>
      ) : runs.length === 0 ? (
        <div className="text-xs text-subtle text-center py-8">
          {t("evaluate.noRunsHint")}
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div
              key={r.id}
              className={`bg-surface-input border rounded p-2 cursor-pointer ${
                selectedRunId === r.id ? "border-accent" : "border-default"
              }`}
              onClick={() => setSelectedRunId(r.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-accent-hover">
                    {(r.accuracy_avg * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs text-muted ml-2">
                    · {r.num_docs} docs · {r.num_fields_evaluated} fields
                  </span>
                  {r.status === "failed" && (
                    <span className="ml-2 text-danger">{t("evaluate.failed")}</span>
                  )}
                  {r.name && (
                    <span className="ml-2 italic text-muted">{r.name}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDownload(r.id); }}
                    className="text-xs text-accent hover:underline"
                    title={t("evaluate.downloadExcel")}
                  >
                    📥
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDelete(r.id); }}
                    className="text-xs text-danger hover:underline"
                    title={t("evaluate.deleteRun")}
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && <EvaluationDetail detail={detail} />}
    </div>
  );
}

function EvaluationDetail({
  detail,
}: { detail: { run: EvaluationRun; fields: EvaluationFieldResult[] } }) {
  const { t } = useTranslation();
  const [showRows, setShowRows] = useState(false);

  type Bucket = { exact: number; fuzzy: number; mismatch: number; missing_pred: number; missing_expected: number };
  const buckets = new Map<string, Bucket>();
  for (const f of detail.fields) {
    const b = buckets.get(f.field_name) ?? { exact: 0, fuzzy: 0, mismatch: 0, missing_pred: 0, missing_expected: 0 };
    (b as unknown as Record<string, number>)[f.match_status] += 1;
    buckets.set(f.field_name, b);
  }
  const summary = Array.from(buckets.entries()).map(([name, b]) => {
    const denom = b.exact + b.fuzzy + b.mismatch + b.missing_pred;
    const accuracy = denom ? (b.exact + b.fuzzy) / denom : 0;
    return { name, ...b, accuracy };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold mb-2">{t("evaluate.perFieldSummary")}</h2>
      <table className="text-xs w-full">
        <thead>
          <tr className="text-left text-muted">
            <th className="pr-2">{t("evaluate.thField")}</th>
            <th>exact</th><th>fuzzy</th><th>mismatch</th>
            <th>missing</th><th>{t("evaluate.thAccuracy")}</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.name}>
              <td className="pr-2 font-mono">{s.name}</td>
              <td>{s.exact}</td>
              <td>{s.fuzzy}</td>
              <td>{s.mismatch}</td>
              <td>{s.missing_pred + s.missing_expected}</td>
              <td>{(s.accuracy * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="button"
        className="text-xs text-accent hover:underline mt-3"
        onClick={() => setShowRows((v) => !v)}
      >
        {showRows ? t("evaluate.hideRows") : t("evaluate.showRows")}{" "}
        {t("evaluate.rowsCount", { count: detail.fields.length })}
      </button>
      {showRows && (
        <table className="text-xs w-full mt-2">
          <thead>
            <tr className="text-left text-muted">
              <th>{t("evaluate.thFilename")}</th>
              <th>{t("evaluate.thField")}</th>
              <th>{t("evaluate.thPredicted")}</th>
              <th>{t("evaluate.thExpected")}</th>
              <th>{t("evaluate.thStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {detail.fields.map((f) => (
              <tr key={f.id}>
                <td>{f.document_filename}</td>
                <td className="font-mono">{f.field_name}</td>
                <td className="text-diff-removed-fg">{f.predicted_value ?? ""}</td>
                <td className="text-diff-added-fg">{f.expected_value ?? ""}</td>
                <td>{f.match_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

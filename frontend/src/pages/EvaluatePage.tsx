import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  usePredictStore,
  type EvaluationRun,
  type EvaluationFieldResult,
} from "../stores/predict-store";

export default function EvaluatePage() {
  const { slug, pid } = useParams();
  const navigate = useNavigate();
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
          setError((e as { message?: string }).message ?? "Failed to load");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pid, listEvaluations]);

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
      setError((e as { message?: string }).message ?? "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete(rid: string) {
    if (!pid) return;
    if (!confirm("Delete this evaluation run?")) return;
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
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          ◀ Back to Project
        </button>
        <h1 className="text-lg font-semibold">📊 Evaluate</h1>
        <div />
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          disabled={running}
          onClick={() => void handleRun()}
          className="bg-[#6366f1] text-white px-3 py-1 rounded text-sm disabled:opacity-50"
        >
          {running ? "Running..." : "Run Evaluation"}
        </button>
        <span className="text-xs text-[#64748b]">
          Edit annotations first for meaningful accuracy.
        </span>
      </div>

      {error && (
        <div className="text-xs text-[#ef4444] bg-[#3f1d1d] border border-[#ef4444] rounded p-2 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-[#94a3b8]">Loading...</div>
      ) : runs.length === 0 ? (
        <div className="text-xs text-[#64748b] text-center py-8">
          Run your first evaluation to see accuracy metrics.
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div
              key={r.id}
              className={`bg-[#0f1117] border rounded p-2 cursor-pointer ${
                selectedRunId === r.id ? "border-[#6366f1]" : "border-[#2a2e3d]"
              }`}
              onClick={() => setSelectedRunId(r.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-[#818cf8]">
                    {(r.accuracy_avg * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs text-[#94a3b8] ml-2">
                    · {r.num_docs} docs · {r.num_fields_evaluated} fields
                  </span>
                  {r.status === "failed" && (
                    <span className="ml-2 text-[#ef4444]">FAILED</span>
                  )}
                  {r.name && (
                    <span className="ml-2 italic text-[#94a3b8]">{r.name}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDownload(r.id); }}
                    className="text-xs text-[#6366f1] hover:underline"
                    title="Download Excel"
                  >
                    📥
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDelete(r.id); }}
                    className="text-xs text-[#ef4444] hover:underline"
                    title="Delete run"
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
  const [showRows, setShowRows] = useState(false);

  // Aggregate per-field
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
      <h2 className="text-sm font-semibold mb-2">Per-field summary</h2>
      <table className="text-xs w-full">
        <thead>
          <tr className="text-left text-[#94a3b8]">
            <th className="pr-2">Field</th>
            <th>exact</th><th>fuzzy</th><th>mismatch</th>
            <th>missing</th><th>accuracy</th>
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
        className="text-xs text-[#6366f1] hover:underline mt-3"
        onClick={() => setShowRows((v) => !v)}
      >
        {showRows ? "Hide" : "Show"} per-doc rows ({detail.fields.length})
      </button>
      {showRows && (
        <table className="text-xs w-full mt-2">
          <thead>
            <tr className="text-left text-[#94a3b8]">
              <th>filename</th><th>field</th><th>predicted</th><th>expected</th><th>status</th>
            </tr>
          </thead>
          <tbody>
            {detail.fields.map((f) => (
              <tr key={f.id}>
                <td>{f.document_filename}</td>
                <td className="font-mono">{f.field_name}</td>
                <td className="text-[#fca5a5]">{f.predicted_value ?? ""}</td>
                <td className="text-[#86efac]">{f.expected_value ?? ""}</td>
                <td>{f.match_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

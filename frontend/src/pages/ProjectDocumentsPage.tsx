import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import DocumentUploader from "../components/upload/DocumentUploader";
import BatchPredictDrawer from "../components/predict/BatchPredictDrawer";
import { api, extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";
import { usePredictStore } from "../stores/predict-store";

interface Document {
  id: string;
  project_id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  status: string;
  is_ground_truth: boolean;
  created_at: string;
}

interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  template_key: string | null;
  template: { display_name: string } | null;
  document_count: number;
  workspace_id: string;
}

interface DocList {
  items: Document[];
  total: number;
  page: number;
  page_size: number;
}

export default function ProjectDocumentsPage() {
  const { slug, pid } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const workspaces = useAuthStore((s) => s.workspaces);
  const ws = workspaces.find((w) => w.slug === slug);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [docs, setDocs] = useState<DocList>({ items: [], total: 0, page: 1, page_size: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [gt, setGt] = useState<"all" | "true" | "false">("all");
  const [sortBy, setSortBy] = useState("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const [batchOpen, setBatchOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const predictBatch = usePredictStore((s) => s.predictBatch);
  const loadNextUnreviewed = usePredictStore((s) => s.loadNextUnreviewed);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onBatchPredict() {
    if (selected.size === 0 || !pid) return;
    setBatchOpen(true);
    await predictBatch(pid, Array.from(selected));
  }

  async function onNextUnreviewed() {
    if (!pid) return;
    const doc = await loadNextUnreviewed(pid);
    if (doc) {
      const wsSlug = ws?.slug;
      if (wsSlug) {
        navigate(`/workspaces/${wsSlug}/projects/${pid}/workspace?doc=${doc.id}`);
      }
    } else {
      alert(t("documents.allPredicted"));
    }
  }

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (gt !== "all") params.set("is_ground_truth", gt);
    params.set("sort_by", sortBy);
    params.set("order", order);
    params.set("page", String(page));
    params.set("page_size", "20");
    return params.toString();
  }, [debouncedSearch, gt, sortBy, order, page]);

  async function loadProject() {
    if (!pid || !ws) return;
    try {
      const r = await api.get<ProjectDetail>(
        `/api/v1/workspaces/${ws.id}/projects/${pid}`
      );
      setProject(r.data);
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  async function loadDocs() {
    if (!pid) return;
    setLoading(true);
    try {
      const r = await api.get<DocList>(
        `/api/v1/projects/${pid}/documents?${queryString}`
      );
      setDocs(r.data);
      setError(null);
    } catch (e) {
      setError(extractApiError(e).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadProject is a local closure; effect intentionally re-runs only on pid/ws change
  }, [pid, ws?.id]);

  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadDocs is a local closure; effect intentionally re-runs only on pid/queryString change
  }, [pid, queryString]);

  async function toggleGT(doc: Document) {
    await api.patch(`/api/v1/projects/${pid}/documents/${doc.id}`, {
      is_ground_truth: !doc.is_ground_truth,
    });
    await loadDocs();
  }

  async function onDelete(doc: Document) {
    if (!confirm(t("documents.deleteConfirm", { name: doc.filename }))) return;
    await api.delete(`/api/v1/projects/${pid}/documents/${doc.id}`);
    await loadDocs();
  }

  const totalPages = Math.max(1, Math.ceil(docs.total / 20));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{project?.name ?? "..."}</h1>
        <div className="text-sm text-[#94a3b8]">
          {project?.template?.display_name && (
            <span>{project.template.display_name} · </span>
          )}
          {t("documents.countLabel", { count: docs.total })}
        </div>
      </div>

      <DocumentUploader
        projectId={pid ?? ""}
        onUploaded={() => void loadDocs()}
      />

      <div className="flex gap-2 mt-4 mb-4">
        <button
          type="button" onClick={() => void onBatchPredict()}
          disabled={selected.size === 0}
          className="bg-[#6366f1] hover:bg-[#818cf8] text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
        >
          {t("documents.batchPredictBtn", { count: selected.size })}
        </button>
        <button
          type="button" onClick={() => void onNextUnreviewed()}
          className="text-sm text-[#94a3b8] border border-[#2a2e3d] px-3 py-1.5 rounded hover:bg-[#1a1d27]"
        >
          {t("documents.nextUnreviewed")}
        </button>
        <button
          type="button"
          onClick={() => ws && navigate(`/workspaces/${ws.slug}/projects/${pid}/evaluate`)}
          className="text-xs text-[#6366f1] hover:underline"
          title={t("documents.evaluateBtn")}
        >
          {t("documents.evaluateBtn")}
        </button>
        <button
          type="button"
          onClick={() => ws && navigate(`/workspaces/${ws.slug}/projects/${pid}/api`)}
          className="text-xs text-[#6366f1] hover:underline"
          title={t("documents.apiBtn")}
        >
          {t("documents.apiBtn")}
        </button>
      </div>

      <div className="mt-6 mb-4 flex flex-wrap gap-3 items-center">
        <input
          type="search"
          placeholder={t("documents.searchFilename")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-1.5 text-sm focus:border-[#6366f1] outline-none"
        />
        <label className="text-xs text-[#94a3b8] flex items-center gap-1">
          {t("documents.groundTruth")}
          <select
            value={gt}
            onChange={(e) => {
              setGt(e.target.value as "all" | "true" | "false");
              setPage(1);
            }}
            className="bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm"
          >
            <option value="all">{t("common.all")}</option>
            <option value="true">{t("documents.gtOnly")}</option>
            <option value="false">{t("documents.gtNone")}</option>
          </select>
        </label>
        <label className="text-xs text-[#94a3b8] flex items-center gap-1">
          {t("documents.sortBy")}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm"
          >
            <option value="created_at">{t("documents.createdAt")}</option>
            <option value="filename">{t("documents.filename")}</option>
            <option value="file_size">{t("documents.size")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setOrder(order === "desc" ? "asc" : "desc")}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          {order === "desc" ? "↓" : "↑"}
        </button>
      </div>

      {error && <div className="text-[#ef4444] text-xs mb-3">{error}</div>}

      {loading && docs.items.length === 0 ? (
        <div className="text-[#64748b] text-sm">{t("common.loading")}</div>
      ) : docs.items.length === 0 ? (
        <div className="text-[#64748b] text-sm">{t("documents.noDocuments")}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase text-[#94a3b8] border-b border-[#2a2e3d]">
              <th className="text-left py-2 w-8"></th>
              <th className="text-left py-2">{t("documents.filename")}</th>
              <th className="text-left">{t("documents.size")}</th>
              <th className="text-left">{t("documents.type")}</th>
              <th className="text-left">{t("documents.status")}</th>
              <th className="text-left">{t("documents.gtShort")}</th>
              <th className="text-right">{t("documents.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {docs.items.map((d) => {
              const openWorkspace = () => {
                if (ws) {
                  navigate(
                    `/workspaces/${ws.slug}/projects/${pid}/workspace?doc=${d.id}`
                  );
                }
              };
              const stop = (e: React.MouseEvent | React.ChangeEvent) =>
                e.stopPropagation();
              return (
                <tr
                  key={d.id}
                  onClick={openWorkspace}
                  className="border-b border-surface cursor-pointer hover:bg-[#1a1d27] transition-colors"
                >
                  <td onClick={stop}>
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={(e) => {
                        stop(e);
                        toggleSelect(d.id);
                      }}
                    />
                  </td>
                  <td className="py-2">{d.filename}</td>
                  <td>{(d.file_size / 1024).toFixed(1)} KB</td>
                  <td className="text-[#94a3b8]">{d.mime_type}</td>
                  <td>{d.status}</td>
                  <td>
                    {d.is_ground_truth ? (
                      <span className="text-[#22c55e] text-xs">● {t("documents.gtShort")}</span>
                    ) : (
                      <span className="text-[#64748b] text-xs">—</span>
                    )}
                  </td>
                  <td className="text-right" onClick={stop}>
                    <button
                      type="button"
                      onClick={openWorkspace}
                      className="text-xs text-[#6366f1] hover:underline mr-3"
                    >
                      {t("documents.openWorkspace")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleGT(d)}
                      className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] mr-3"
                    >
                      {d.is_ground_truth ? t("documents.unmarkGT") : t("documents.markGT")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(d)}
                      className="text-xs text-[#ef4444] hover:underline"
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-3 mt-4 text-sm">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-[#94a3b8] disabled:opacity-30"
          >
            {t("common.previous")}
          </button>
          <span className="text-[#64748b]">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-[#94a3b8] disabled:opacity-30"
          >
            {t("common.next")}
          </button>
        </div>
      )}
      {batchOpen && <BatchPredictDrawer onClose={() => {
        setBatchOpen(false);
        void loadDocs();
      }} />}
    </div>
  );
}

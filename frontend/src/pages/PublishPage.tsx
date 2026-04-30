import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";
import {
  usePredictStore,
  type ApiKey,
  type ApiKeyCreateResponse,
  type ProjectApiState,
} from "../stores/predict-store";

interface ProjectFull extends ProjectApiState {
  workspace_id: string;
  name: string;
  slug: string;
}

type Status = "draft" | "published" | "disabled";

function deriveStatus(p: ProjectApiState | null): Status {
  if (!p || !p.api_code) return "draft";
  if (p.api_disabled_at) return "disabled";
  return "published";
}

export default function PublishPage() {
  const { slug, pid } = useParams();
  const navigate = useNavigate();
  const workspaces = useAuthStore((s) => s.workspaces);
  const ws = workspaces.find((w) => w.slug === slug);

  const publishApi = usePredictStore((s) => s.publishApi);
  const unpublishApi = usePredictStore((s) => s.unpublishApi);
  const listApiKeys = usePredictStore((s) => s.listApiKeys);
  const createApiKey = usePredictStore((s) => s.createApiKey);
  const deleteApiKey = usePredictStore((s) => s.deleteApiKey);

  const [project, setProject] = useState<ProjectFull | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [apiCodeInput, setApiCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Modal state for new-key flow
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<ApiKeyCreateResponse | null>(null);

  useEffect(() => {
    if (!ws || !pid) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<ProjectFull>(
          `/api/v1/workspaces/${ws.id}/projects/${pid}`,
        );
        if (cancelled) return;
        setProject(r.data);
        setApiCodeInput(r.data.slug || "");
        const ks = await listApiKeys(pid);
        if (!cancelled) setKeys(ks);
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => { cancelled = true; };
  }, [ws, pid, listApiKeys]);

  const status: Status = deriveStatus(project);

  async function handlePublish() {
    if (!pid) return;
    const code = project?.api_code ?? apiCodeInput.trim();
    if (!code) return;
    setBusy(true);
    try {
      const updated = await publishApi(pid, code);
      setProject(p => p ? { ...p, ...updated } : p);
      setError(null);
    } catch (e) {
      setError(extractApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpublish() {
    if (!pid) return;
    setBusy(true);
    try {
      const updated = await unpublishApi(pid);
      setProject(p => p ? { ...p, ...updated } : p);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateKey() {
    if (!pid) return;
    setBusy(true);
    try {
      const r = await createApiKey(pid, newKeyName);
      setRevealedKey(r);
      const ks = await listApiKeys(pid);
      setKeys(ks);
      setNewKeyName("");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteKey(kid: string) {
    if (!pid) return;
    if (!confirm("Delete this API key?")) return;
    await deleteApiKey(pid, kid);
    const ks = await listApiKeys(pid);
    setKeys(ks);
  }

  const publicUrl = project?.api_code
    ? `${window.location.origin}/extract/${project.api_code}`
    : "";

  return (
    <div className="text-sm space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => slug && pid && navigate(`/workspaces/${slug}/projects/${pid}`)}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          ◀ Back to Project
        </button>
        <h1 className="text-lg font-semibold">🔌 API for "{project?.name ?? "..."}"</h1>
        <div />
      </div>

      {error && (
        <div className="text-xs text-[#ef4444] bg-[#3f1d1d] border border-[#ef4444] rounded p-2">
          {error}
        </div>
      )}

      {/* Status section */}
      <section className="bg-[#0f1117] border border-[#2a2e3d] rounded p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8]">Status:</span>
          <StatusBadge status={status} />
        </div>

        {status === "draft" && (
          <div className="flex items-center gap-2">
            <input
              value={apiCodeInput}
              onChange={(e) => setApiCodeInput(e.target.value)}
              placeholder="api_code (e.g. receipts)"
              className="bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-1 text-sm flex-1 max-w-md"
            />
            <button
              type="button"
              disabled={busy || !apiCodeInput.trim()}
              onClick={() => void handlePublish()}
              className="bg-[#6366f1] text-white px-3 py-1 rounded text-xs disabled:opacity-50"
            >
              Publish
            </button>
          </div>
        )}

        {status === "published" && project?.api_code && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">Public URL:</div>
            <pre className="bg-[#0a0c11] p-2 rounded text-xs text-[#a5f3fc] mb-2">{publicUrl}</pre>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUnpublish()}
              className="text-xs text-[#ef4444] hover:underline"
            >
              Unpublish
            </button>
          </div>
        )}

        {status === "disabled" && project?.api_code && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">api_code: {project.api_code} (currently disabled)</div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handlePublish()}
              className="bg-[#6366f1] text-white px-3 py-1 rounded text-xs disabled:opacity-50"
            >
              Re-Publish
            </button>
          </div>
        )}
      </section>

      {/* API Keys section */}
      <section className="bg-[#0f1117] border border-[#2a2e3d] rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8]">API Keys</span>
          <button
            type="button"
            onClick={() => setNewKeyOpen(true)}
            className="text-xs text-[#6366f1] hover:underline"
          >
            + New Key
          </button>
        </div>
        {keys.length === 0 ? (
          <div className="text-xs text-[#64748b] text-center py-4">
            No keys. Create one to start using the API.
          </div>
        ) : (
          <div className="space-y-1">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between bg-[#1a1d27] rounded p-2">
                <div>
                  <span className="font-mono text-[#a5f3fc]">{k.key_prefix}···</span>
                  {k.name && <span className="ml-2 italic text-[#94a3b8]">"{k.name}"</span>}
                  <span className="ml-2 text-xs text-[#64748b]">
                    last: {k.last_used_at ?? "never"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteKey(k.id)}
                  className="text-xs text-[#ef4444] hover:underline"
                  title="Delete key"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* cURL hint section */}
      {project?.api_code && status === "published" && (
        <section className="bg-[#0f1117] border border-[#2a2e3d] rounded p-4">
          <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-2">
            Try it (cURL)
          </div>
          <pre className="text-xs whitespace-pre-wrap bg-[#0a0c11] p-2 rounded text-[#a5f3fc]">
{`curl -X POST "${publicUrl}" \\
  -H "X-Api-Key: dik_..." \\
  -F "file=@invoice.pdf"`}
          </pre>
        </section>
      )}

      {/* New key modal */}
      {newKeyOpen && (
        <NewKeyModal
          name={newKeyName}
          onNameChange={setNewKeyName}
          revealedKey={revealedKey}
          onSubmit={() => void handleCreateKey()}
          onClose={() => {
            setNewKeyOpen(false);
            setRevealedKey(null);
          }}
          busy={busy}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const styles = {
    draft: "bg-[#64748b] text-white",
    published: "bg-[#22c55e] text-white",
    disabled: "bg-[#ef4444] text-white",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${styles[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

function NewKeyModal({
  name, onNameChange, revealedKey, onSubmit, onClose, busy,
}: {
  name: string;
  onNameChange: (v: string) => void;
  revealedKey: ApiKeyCreateResponse | null;
  onSubmit: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 w-[480px] space-y-3">
        {!revealedKey ? (
          <>
            <h2 className="font-semibold">+ New API Key</h2>
            <input
              autoFocus
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Key name (e.g. production)"
              className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-xs text-[#94a3b8] px-3 py-1">Cancel</button>
              <button
                disabled={busy}
                onClick={onSubmit}
                className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-semibold">Your new API key</h2>
            <div className="text-xs text-[#fca5a5] bg-[#3f1d1d] border border-[#ef4444] rounded p-2">
              ⚠️ This is the only time you'll see this key. Store it safely; we cannot show it again.
            </div>
            <pre className="text-xs whitespace-pre-wrap bg-[#0a0c11] p-2 rounded text-[#a5f3fc] font-mono break-all">
              {revealedKey.key}
            </pre>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

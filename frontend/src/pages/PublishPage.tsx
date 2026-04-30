import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
    if (!confirm(t("publish.deleteKeyConfirm"))) return;
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
          className="text-xs text-muted hover:text-primary"
        >
          {t("publish.back")}
        </button>
        <h1 className="text-lg font-semibold">
          {t("publish.title", { name: project?.name ?? "..." })}
        </h1>
        <div />
      </div>

      {error && (
        <div className="text-xs text-danger bg-danger-soft border border-danger rounded p-2">
          {error}
        </div>
      )}

      <section className="bg-surface-input border border-default rounded p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs uppercase font-semibold tracking-wider text-muted">
            {t("publish.status")}
          </span>
          <StatusBadge status={status} />
        </div>

        {status === "draft" && (
          <div className="flex items-center gap-2">
            <input
              value={apiCodeInput}
              onChange={(e) => setApiCodeInput(e.target.value)}
              placeholder={t("publish.apiCodePlaceholder")}
              className="bg-surface border border-default rounded px-2 py-1 text-sm flex-1 max-w-md"
            />
            <button
              type="button"
              disabled={busy || !apiCodeInput.trim()}
              onClick={() => void handlePublish()}
              className="bg-accent text-white px-3 py-1 rounded text-xs disabled:opacity-50"
            >
              {t("publish.publish")}
            </button>
          </div>
        )}

        {status === "published" && project?.api_code && (
          <div>
            <div className="text-xs text-muted mb-1">{t("publish.publicUrl")}</div>
            <pre className="bg-code-bg p-2 rounded text-xs text-code mb-2">{publicUrl}</pre>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUnpublish()}
              className="text-xs text-danger hover:underline"
            >
              {t("publish.unpublish")}
            </button>
          </div>
        )}

        {status === "disabled" && project?.api_code && (
          <div>
            <div className="text-xs text-muted mb-1">
              {t("publish.apiCodeDisabled", { code: project.api_code })}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handlePublish()}
              className="bg-accent text-white px-3 py-1 rounded text-xs disabled:opacity-50"
            >
              {t("publish.republish")}
            </button>
          </div>
        )}
      </section>

      <section className="bg-surface-input border border-default rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase font-semibold tracking-wider text-muted">
            {t("publish.apiKeys")}
          </span>
          <button
            type="button"
            onClick={() => setNewKeyOpen(true)}
            className="text-xs text-accent hover:underline"
          >
            {t("publish.newKey")}
          </button>
        </div>
        {keys.length === 0 ? (
          <div className="text-xs text-subtle text-center py-4">
            {t("publish.noKeys")}
          </div>
        ) : (
          <div className="space-y-1">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between bg-surface rounded p-2">
                <div>
                  <span className="font-mono text-code">{k.key_prefix}···</span>
                  {k.name && <span className="ml-2 italic text-muted">"{k.name}"</span>}
                  <span className="ml-2 text-xs text-subtle">
                    {t("publish.lastUsed", { when: k.last_used_at ?? t("publish.never") })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteKey(k.id)}
                  className="text-xs text-danger hover:underline"
                  title={t("common.delete")}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {project?.api_code && status === "published" && (
        <section className="bg-surface-input border border-default rounded p-4">
          <div className="text-xs uppercase font-semibold tracking-wider text-muted mb-2">
            {t("publish.tryItCurl")}
          </div>
          <pre className="text-xs whitespace-pre-wrap bg-code-bg p-2 rounded text-code">
{`curl -X POST "${publicUrl}" \\
  -H "X-Api-Key: dik_..." \\
  -F "file=@invoice.pdf"`}
          </pre>
        </section>
      )}

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
  const { t } = useTranslation();
  const styles: Record<Status, string> = {
    draft: "bg-subtle text-white",
    published: "bg-success text-white",
    disabled: "bg-danger text-white",
  };
  const label: Record<Status, string> = {
    draft: t("publish.draft"),
    published: t("publish.published"),
    disabled: t("publish.disabled"),
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${styles[status]}`}>
      {label[status]}
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
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-surface-overlay flex items-center justify-center z-50">
      <div className="bg-surface border border-default rounded p-4 w-[480px] space-y-3">
        {!revealedKey ? (
          <>
            <h2 className="font-semibold">{t("publish.newKeyTitle")}</h2>
            <input
              autoFocus
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t("publish.keyNamePlaceholder")}
              className="w-full bg-surface-input border border-default rounded px-2 py-1 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-xs text-muted px-3 py-1">
                {t("common.cancel")}
              </button>
              <button
                disabled={busy}
                onClick={onSubmit}
                className="bg-accent text-white text-xs px-3 py-1 rounded disabled:opacity-50"
              >
                {t("publish.createKey")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-semibold">{t("publish.newKeyHeader")}</h2>
            <div className="text-xs text-diff-removed-fg bg-danger-soft border border-danger rounded p-2">
              {t("publish.newKeyWarning")}
            </div>
            <pre className="text-xs whitespace-pre-wrap bg-code-bg p-2 rounded text-code font-mono break-all">
              {revealedKey.key}
            </pre>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="bg-accent text-white text-xs px-3 py-1 rounded"
              >
                {t("common.done")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  projectId: string;
}

export default function PromptHistoryPanel({ projectId }: Props) {
  const { t } = useTranslation();
  const open = usePredictStore((s) => s.promptHistoryOpen);
  const setOpen = usePredictStore((s) => s.setPromptHistoryOpen);
  const versions = usePredictStore((s) => s.promptVersions);
  const loadPromptVersions = usePredictStore((s) => s.loadPromptVersions);
  const setActivePrompt = usePredictStore((s) => s.setActivePrompt);
  const deletePromptVersion = usePredictStore((s) => s.deletePromptVersion);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && versions.length === 0) void loadPromptVersions(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, loadPromptVersions]);

  if (!open) return null;

  async function activate(vid: string) {
    setBusy(true);
    try {
      await setActivePrompt(projectId, vid);
      await loadPromptVersions(projectId);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    try {
      await setActivePrompt(projectId, null);
      await loadPromptVersions(projectId);
    } finally {
      setBusy(false);
    }
  }

  async function remove(vid: string) {
    setBusy(true);
    try {
      await deletePromptVersion(projectId, vid);
      await loadPromptVersions(projectId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-surface border-l border-default z-50 flex flex-col text-sm">
      <header className="flex items-center justify-between px-4 py-3 border-b border-default">
        <h2 className="font-semibold text-primary">{t("workspacePage.promptHistoryTitle")}</h2>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-primary">✕</button>
      </header>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {versions.length === 0 ? (
          <div className="text-xs text-subtle text-center py-8">
            {t("workspacePage.promptHistoryEmpty")}
          </div>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              className="bg-surface-input border border-default rounded p-2"
            >
              <button
                type="button"
                onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                className="w-full flex items-center justify-between text-left"
              >
                <span className="font-mono text-accent-hover">v{v.version}</span>
                <span className="flex-1 mx-2 text-xs italic text-muted truncate">
                  {v.summary || t("workspacePage.noSummary")}
                </span>
                {v.is_active && (
                  <span className="text-xs bg-accent-strong text-white rounded px-2 py-0.5">
                    {t("workspacePage.active")}
                  </span>
                )}
              </button>
              {expanded === v.id && (
                <div className="mt-2 space-y-2">
                  <pre className="text-xs whitespace-pre-wrap text-code bg-code-bg p-2 rounded max-h-64 overflow-auto">
                    {v.prompt_text}
                  </pre>
                  <div className="flex gap-2">
                    {!v.is_active && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void activate(v.id)}
                        className="text-xs bg-accent text-white px-2 py-1 rounded disabled:opacity-50"
                      >
                        {t("workspacePage.setAsActive")}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy || v.is_active}
                      onClick={() => void remove(v.id)}
                      className="text-xs text-danger hover:underline disabled:opacity-30 disabled:no-underline"
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <footer className="px-3 py-2 border-t border-default">
        <button
          type="button"
          disabled={busy}
          onClick={() => void deactivate()}
          className="text-xs text-muted hover:text-primary w-full"
        >
          {t("workspacePage.useTemplateDefault")}
        </button>
      </footer>
    </div>
  );
}

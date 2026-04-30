import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../stores/auth-store";

export default function WorkspaceSwitcher() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentId = useAuthStore((s) => s.currentWorkspaceId);
  const switchById = useAuthStore((s) => s.switchWorkspaceById);
  const [open, setOpen] = useState(false);

  const current = workspaces.find((w) => w.id === currentId) ?? null;

  function pickWorkspace(id: string, slug: string) {
    switchById(id);
    setOpen(false);
    navigate(`/workspaces/${slug}`);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bg-surface border border-default rounded px-3 py-1.5 text-sm hover:bg-surface-hover flex items-center gap-2"
      >
        <span className="font-semibold">
          {current ? current.name : t("workspace.selectWorkspace")}
        </span>
        <span className="text-subtle">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-surface border border-default rounded shadow-lg z-50">
          {workspaces.length === 0 && (
            <div className="px-3 py-2 text-xs text-subtle">
              {t("workspace.noWorkspaces")}
            </div>
          )}
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => pickWorkspace(w.id, w.slug)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-hover ${
                w.id === currentId ? "text-accent-hover" : "text-primary"
              }`}
            >
              <div className="font-medium">{w.name}</div>
              <div className="text-xs text-subtle">
                {w.slug} · {w.role}
              </div>
            </button>
          ))}
          <div className="border-t border-default">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/workspaces/new");
              }}
              className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-surface-hover"
            >
              {t("workspace.newWorkspace")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

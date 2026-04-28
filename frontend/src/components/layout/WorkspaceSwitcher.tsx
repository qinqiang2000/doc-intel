import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store";

export default function WorkspaceSwitcher() {
  const navigate = useNavigate();
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
        className="bg-[#1a1d27] border border-[#2a2e3d] rounded px-3 py-1.5 text-sm hover:bg-[#232736] flex items-center gap-2"
      >
        <span className="font-semibold">
          {current ? current.name : "选择 Workspace"}
        </span>
        <span className="text-[#64748b]">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-[#1a1d27] border border-[#2a2e3d] rounded shadow-lg z-50">
          {workspaces.length === 0 && (
            <div className="px-3 py-2 text-xs text-[#64748b]">
              还没有 workspace
            </div>
          )}
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => pickWorkspace(w.id, w.slug)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[#232736] ${
                w.id === currentId ? "text-[#818cf8]" : "text-[#e2e8f0]"
              }`}
            >
              <div className="font-medium">{w.name}</div>
              <div className="text-xs text-[#64748b]">
                {w.slug} · {w.role}
              </div>
            </button>
          ))}
          <div className="border-t border-[#2a2e3d]">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/workspaces/new");
              }}
              className="w-full text-left px-3 py-2 text-sm text-[#6366f1] hover:bg-[#232736]"
            >
              + 新建 Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

export default function AppShell() {
  const navigate = useNavigate();
  const params = useParams();
  const user = useAuthStore((s) => s.user);
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentWorkspaceId = useAuthStore((s) => s.currentWorkspaceId);
  const switchBySlug = useAuthStore((s) => s.switchWorkspaceBySlug);
  const logout = useAuthStore((s) => s.logout);

  // Sync currentWorkspaceId with URL slug if route has one
  useEffect(() => {
    if (params.slug) {
      switchBySlug(params.slug);
    }
  }, [params.slug, switchBySlug]);

  // If user has zero workspaces, redirect to /workspaces/new
  useEffect(() => {
    if (workspaces.length === 0) {
      navigate("/workspaces/new", { replace: true });
    }
  }, [workspaces.length, navigate]);

  function onLogout() {
    logout();
    navigate("/login");
  }

  const current = workspaces.find((w) => w.id === currentWorkspaceId);

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e2e8f0]">
      <header className="bg-[#1a1d27] border-b border-[#2a2e3d] px-5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">⚡</span>
          <span className="font-bold tracking-tight">doc-intel</span>
          <span className="bg-[rgba(99,102,241,0.12)] text-[#94a3b8] text-[10px] px-2 py-0.5 rounded">
            S0
          </span>
        </div>

        <div className="flex items-center gap-3">
          <WorkspaceSwitcher />
          {current && current.role === "owner" && (
            <button
              type="button"
              onClick={() => navigate(`/workspaces/${current.slug}/settings`)}
              className="text-sm text-[#94a3b8] hover:text-[#e2e8f0]"
            >
              设置
            </button>
          )}
          <div className="text-sm text-[#94a3b8]">{user?.display_name}</div>
          <button
            type="button"
            onClick={onLogout}
            className="text-sm text-[#94a3b8] hover:text-[#e2e8f0]"
          >
            退出
          </button>
        </div>
      </header>

      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { useProjectStore } from "../stores/project-store";

export default function ProjectListPage() {
  const navigate = useNavigate();
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentId = useAuthStore((s) => s.currentWorkspaceId);
  const current = workspaces.find((w) => w.id === currentId);

  const projects = useProjectStore((s) => s.projects);
  const loading = useProjectStore((s) => s.loading);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  useEffect(() => {
    if (current) {
      void loadProjects(current.id);
    }
  }, [current?.id, loadProjects]);

  if (!current) {
    return <div className="text-[#94a3b8]">加载中...</div>;
  }

  async function onDelete(projectId: string) {
    if (!current) return;
    if (!confirm("软删 Project？后续可在管理页恢复。")) return;
    await deleteProject(current.id, projectId);
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{current.name}</h1>
        <button
          type="button"
          onClick={() => navigate(`/workspaces/${current.slug}/projects/new`)}
          className="bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold px-4 py-2 rounded text-sm"
        >
          + 新建 Project
        </button>
      </div>

      {loading && projects.length === 0 ? (
        <div className="text-[#64748b] text-sm">加载中...</div>
      ) : projects.length === 0 ? (
        <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-6 text-center">
          <div className="text-[#94a3b8] text-sm mb-1">还没有 Project</div>
          <div className="text-xs text-[#64748b]">
            点击 "+ 新建 Project" 选模板开始
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects.map((p) => (
            <li
              key={p.id}
              className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 flex flex-col gap-2"
            >
              <button
                type="button"
                onClick={() =>
                  navigate(`/workspaces/${current.slug}/projects/${p.id}`)
                }
                className="text-left"
              >
                <div className="font-semibold text-base">{p.name}</div>
                <div className="text-xs text-[#64748b]">
                  slug: {p.slug}
                  {p.template_key ? ` · ${p.template_key}` : ""}
                </div>
                {p.description && (
                  <div className="text-xs text-[#94a3b8] mt-1 line-clamp-2">
                    {p.description}
                  </div>
                )}
              </button>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/workspaces/${current.slug}/projects/${p.id}/settings`
                    )
                  }
                  className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
                >
                  设置
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  className="text-xs text-[#ef4444] hover:underline"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

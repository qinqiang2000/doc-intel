import { useEffect, useState, FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";

interface ProjectDetail {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  template_key: string | null;
  template: {
    key: string;
    display_name: string;
    description: string;
    expected_fields: string[];
    recommended_processor: string;
  } | null;
  document_count: number;
}

export default function ProjectSettingsPage() {
  const { slug, pid } = useParams();
  const navigate = useNavigate();
  const workspaces = useAuthStore((s) => s.workspaces);
  const ws = workspaces.find((w) => w.slug === slug);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ws || !pid) return;
    void (async () => {
      try {
        const r = await api.get<ProjectDetail>(
          `/api/v1/workspaces/${ws.id}/projects/${pid}`
        );
        setProject(r.data);
        setName(r.data.name);
        setDescription(r.data.description ?? "");
      } catch (e) {
        setError(extractApiError(e).message);
      }
    })();
  }, [ws?.id, pid]);

  if (!ws) return <div className="text-[#94a3b8]">未找到 workspace</div>;
  if (ws.role !== "owner") {
    return <div className="text-[#ef4444]">只有 owner 可以访问 Project 设置</div>;
  }
  if (error && !project) return <div className="text-[#ef4444]">{error}</div>;
  if (!project) return <div className="text-[#94a3b8]">加载中...</div>;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!ws || !pid) return;
    setError(null);
    setSaving(true);
    try {
      await api.patch(`/api/v1/workspaces/${ws.id}/projects/${pid}`, {
        name,
        description,
      });
    } catch (e) {
      setError(extractApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!ws || !pid) return;
    if (!confirm(`软删 Project "${project?.name}"？后续可恢复。`)) return;
    try {
      await api.delete(`/api/v1/workspaces/${ws.id}/projects/${pid}`);
      navigate(`/workspaces/${ws.slug}`);
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-6">{project.name} · 设置</h1>

      <form onSubmit={onSave} className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">基本信息</h2>

        <label htmlFor="ps-name" className="block text-xs text-[#94a3b8] mb-1">名称</label>
        <input
          id="ps-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-3 text-sm"
        />

        <label htmlFor="ps-desc" className="block text-xs text-[#94a3b8] mb-1">描述</label>
        <textarea
          id="ps-desc"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-3 text-sm h-20"
        />

        <button
          type="submit"
          disabled={saving}
          className="bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </form>

      {project.template && (
        <section className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 mb-4">
          <h2 className="text-sm font-semibold mb-2">模板（只读）</h2>
          <div className="text-sm">
            {project.template.display_name}
            <span className="text-xs text-[#64748b] ml-2">
              · {project.template.expected_fields.length} 个字段
            </span>
          </div>
          <div className="text-xs text-[#94a3b8] mt-1">{project.template.description}</div>
        </section>
      )}

      <section className="bg-[#1a1d27] border border-[#ef4444] rounded p-4">
        <h2 className="text-sm font-semibold mb-2 text-[#ef4444]">危险区</h2>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="bg-[#ef4444] hover:bg-[#dc2626] text-white font-semibold px-4 py-2 rounded text-sm"
        >
          删除 Project
        </button>
      </section>

      {error && <div className="text-[#ef4444] text-xs mt-3">{error}</div>}
    </div>
  );
}

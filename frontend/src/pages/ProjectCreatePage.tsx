import { useEffect, useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { useProjectStore, type Template } from "../stores/project-store";

export default function ProjectCreatePage() {
  const navigate = useNavigate();
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentId = useAuthStore((s) => s.currentWorkspaceId);
  const current = workspaces.find((w) => w.id === currentId);

  const templates = useProjectStore((s) => s.templates);
  const loadTemplates = useProjectStore((s) => s.loadTemplates);
  const createProject = useProjectStore((s) => s.createProject);

  const [picked, setPicked] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  function autoSlug(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60)
      );
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!current || !picked) return;
    setError(null);
    setSubmitting(true);
    try {
      const p = await createProject(current.id, {
        name,
        slug,
        description: description || undefined,
        template_key: picked.key,
      });
      navigate(`/workspaces/${current.slug}/projects/${p.id}`);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "创建失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">新建 Project</h1>

      <section className="mb-6">
        <h2 className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-2">
          1. 选择模板
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {templates.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setPicked(t)}
              className={`bg-[#1a1d27] border rounded p-3 text-left text-sm hover:bg-[#232736] ${
                picked?.key === t.key
                  ? "border-[#6366f1]"
                  : "border-[#2a2e3d]"
              }`}
            >
              <div className="font-semibold mb-1">{t.display_name}</div>
              <div className="text-xs text-[#64748b]">{t.description}</div>
              {t.expected_fields.length > 0 && (
                <div className="text-[10px] text-[#94a3b8] mt-1">
                  {t.expected_fields.length} 个预置字段
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      <form onSubmit={onSubmit} className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-6">
        <h2 className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-3">
          2. Project 基本信息
        </h2>

        <label htmlFor="proj-name" className="block text-xs text-[#94a3b8] mb-1">
          名称
        </label>
        <input
          id="proj-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => autoSlug(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-3 focus:border-[#6366f1] outline-none text-sm"
        />

        <label htmlFor="proj-slug" className="block text-xs text-[#94a3b8] mb-1">
          Slug
        </label>
        <input
          id="proj-slug"
          type="text"
          required
          minLength={3}
          maxLength={60}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-3 focus:border-[#6366f1] outline-none text-sm font-mono"
        />

        <label htmlFor="proj-desc" className="block text-xs text-[#94a3b8] mb-1">
          描述（可选）
        </label>
        <textarea
          id="proj-desc"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-2 mb-4 focus:border-[#6366f1] outline-none text-sm h-20"
        />

        {error && <div className="text-[#ef4444] text-xs mb-3">{error}</div>}

        <button
          type="submit"
          disabled={!picked || submitting}
          className="bg-[#6366f1] hover:bg-[#818cf8] text-white font-semibold px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {submitting ? "创建中..." : "创建 Project"}
        </button>
      </form>
    </div>
  );
}

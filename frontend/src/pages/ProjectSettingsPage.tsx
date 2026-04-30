import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effect intentionally keyed on ws.id/pid only; ws object reference changes are irrelevant
  }, [ws?.id, pid]);

  if (!ws) return <div className="text-muted">{t("workspace.notFound")}</div>;
  if (ws.role !== "owner") {
    return <div className="text-danger">{t("project.ownerOnly")}</div>;
  }
  if (error && !project) return <div className="text-danger">{error}</div>;
  if (!project) return <div className="text-muted">{t("common.loading")}</div>;

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
    if (!confirm(t("project.deleteProjectNamedConfirm", { name: project?.name ?? "" }))) return;
    try {
      await api.delete(`/api/v1/workspaces/${ws.id}/projects/${pid}`);
      navigate(`/workspaces/${ws.slug}`);
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-6">
        {t("project.settingsHeader", { name: project.name })}
      </h1>

      <form onSubmit={onSave} className="bg-surface border border-default rounded p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">{t("project.basicInfo")}</h2>

        <label htmlFor="ps-name" className="block text-xs text-muted mb-1">
          {t("common.name")}
        </label>
        <input
          id="ps-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-3 text-sm"
        />

        <label htmlFor="ps-desc" className="block text-xs text-muted mb-1">
          {t("common.description")}
        </label>
        <textarea
          id="ps-desc"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-3 text-sm h-20"
        />

        <button
          type="submit"
          disabled={saving}
          className="bg-accent hover:bg-accent-hover text-white font-semibold px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </form>

      {project.template && (
        <section className="bg-surface border border-default rounded p-4 mb-4">
          <h2 className="text-sm font-semibold mb-2">{t("project.templateReadOnly")}</h2>
          <div className="text-sm">
            {project.template.display_name}
            <span className="text-xs text-subtle ml-2">
              · {t("project.templateFieldsCount", { count: project.template.expected_fields.length })}
            </span>
          </div>
          <div className="text-xs text-muted mt-1">{project.template.description}</div>
        </section>
      )}

      <section className="bg-surface border border-danger rounded p-4">
        <h2 className="text-sm font-semibold mb-2 text-danger">{t("common.dangerZone")}</h2>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="bg-danger hover:bg-danger-hover text-white font-semibold px-4 py-2 rounded text-sm"
        >
          {t("project.deleteProject")}
        </button>
      </section>

      {error && <div className="text-danger text-xs mt-3">{error}</div>}
    </div>
  );
}

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/auth-store";
import { useProjectStore } from "../stores/project-store";

export default function ProjectListPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effect intentionally keyed on current.id; loadProjects is a stable zustand action
  }, [current?.id, loadProjects]);

  if (!current) {
    return <div className="text-muted">{t("common.loading")}</div>;
  }

  async function onDelete(projectId: string) {
    if (!current) return;
    if (!confirm(t("project.deleteProjectConfirm"))) return;
    await deleteProject(current.id, projectId);
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{current.name}</h1>
        <button
          type="button"
          onClick={() => navigate(`/workspaces/${current.slug}/projects/new`)}
          className="bg-accent hover:bg-accent-hover text-white font-semibold px-4 py-2 rounded text-sm"
        >
          {t("project.newProject")}
        </button>
      </div>

      {loading && projects.length === 0 ? (
        <div className="text-subtle text-sm">{t("common.loading")}</div>
      ) : projects.length === 0 ? (
        <div className="bg-surface border border-default rounded p-6 text-center">
          <div className="text-muted text-sm mb-1">{t("project.noProjects")}</div>
          <div className="text-xs text-subtle">{t("project.noProjectsHint")}</div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects.map((p) => (
            <li
              key={p.id}
              className="bg-surface border border-default rounded p-4 flex flex-col gap-2"
            >
              <button
                type="button"
                onClick={() =>
                  navigate(`/workspaces/${current.slug}/projects/${p.id}`)
                }
                className="text-left"
              >
                <div className="font-semibold text-base">{p.name}</div>
                <div className="text-xs text-subtle">
                  slug: {p.slug}
                  {p.template_key ? ` · ${p.template_key}` : ""}
                </div>
                {p.description && (
                  <div className="text-xs text-muted mt-1 line-clamp-2">
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
                  className="text-xs text-muted hover:text-primary"
                >
                  {t("common.settings")}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  className="text-xs text-danger hover:underline"
                >
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

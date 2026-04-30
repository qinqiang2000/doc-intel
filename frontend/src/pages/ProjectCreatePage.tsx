import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/auth-store";
import { useProjectStore, type Template } from "../stores/project-store";

export default function ProjectCreatePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
      setError((e as { message?: string })?.message ?? t("common.createFailed"));
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">{t("project.createNewProjectTitle")}</h1>

      <section className="mb-6">
        <h2 className="text-xs uppercase font-semibold tracking-wider text-muted mb-2">
          {t("project.stepChooseTemplate")}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {templates.map((tpl) => (
            <button
              key={tpl.key}
              type="button"
              onClick={() => setPicked(tpl)}
              className={`bg-surface border rounded p-3 text-left text-sm hover:bg-surface-hover ${
                picked?.key === tpl.key
                  ? "border-accent"
                  : "border-default"
              }`}
            >
              <div className="font-semibold mb-1">{tpl.display_name}</div>
              <div className="text-xs text-subtle">{tpl.description}</div>
              {tpl.expected_fields.length > 0 && (
                <div className="text-[10px] text-muted mt-1">
                  {t("project.presetFields", { count: tpl.expected_fields.length })}
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      <form onSubmit={onSubmit} className="bg-surface border border-default rounded p-6">
        <h2 className="text-xs uppercase font-semibold tracking-wider text-muted mb-3">
          {t("project.stepProjectInfo")}
        </h2>

        <label htmlFor="proj-name" className="block text-xs text-muted mb-1">
          {t("common.name")}
        </label>
        <input
          id="proj-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => autoSlug(e.target.value)}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-3 focus:border-accent outline-none text-sm"
        />

        <label htmlFor="proj-slug" className="block text-xs text-muted mb-1">
          {t("project.slug")}
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
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-3 focus:border-accent outline-none text-sm font-mono"
        />

        <label htmlFor="proj-desc" className="block text-xs text-muted mb-1">
          {t("common.descriptionOptional")}
        </label>
        <textarea
          id="proj-desc"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-4 focus:border-accent outline-none text-sm h-20"
        />

        {error && <div className="text-danger text-xs mb-3">{error}</div>}

        <button
          type="submit"
          disabled={!picked || submitting}
          className="bg-accent hover:bg-accent-hover text-white font-semibold px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {submitting ? t("common.creating") : t("project.createProject")}
        </button>
      </form>
    </div>
  );
}

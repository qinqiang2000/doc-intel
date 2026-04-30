import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";

export default function WorkspaceCreatePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const createWorkspace = useAuthStore((s) => s.createWorkspace);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  function autoFillSlug(value: string) {
    setName(value);
    if (!slugTouched) {
      const auto = value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      setSlug(auto.slice(0, 60));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ws = await createWorkspace({
        name,
        slug,
        description: description || undefined,
      });
      navigate(`/workspaces/${ws.slug}`);
    } catch (e) {
      setError(extractApiError(e).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-bold mb-6">{t("workspace.createNewWorkspaceTitle")}</h1>
      <form
        onSubmit={onSubmit}
        className="bg-surface border border-default rounded p-6"
      >
        <label
          htmlFor="ws-name"
          className="block text-xs uppercase font-semibold tracking-wider text-muted mb-1"
        >
          {t("common.name")}
        </label>
        <input
          id="ws-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(e) => autoFillSlug(e.target.value)}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-4 focus:border-accent outline-none text-sm"
        />

        <label
          htmlFor="ws-slug"
          className="block text-xs uppercase font-semibold tracking-wider text-muted mb-1"
        >
          {t("workspace.slugHint")}
        </label>
        <input
          id="ws-slug"
          type="text"
          required
          minLength={3}
          maxLength={60}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-4 focus:border-accent outline-none text-sm font-mono"
        />

        <label
          htmlFor="ws-desc"
          className="block text-xs uppercase font-semibold tracking-wider text-muted mb-1"
        >
          {t("common.descriptionOptional")}
        </label>
        <textarea
          id="ws-desc"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-surface-input border border-default rounded px-3 py-2 mb-6 focus:border-accent outline-none text-sm h-20"
        />

        {error && <div className="text-danger text-xs mb-4">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover text-white font-semibold px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {submitting ? t("common.creating") : t("workspace.createWorkspace")}
        </button>
      </form>
    </div>
  );
}

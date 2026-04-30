import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";

interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: "owner" | "member";
}

export default function WorkspaceSettingsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const workspaces = useAuthStore((s) => s.workspaces);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const ws = workspaces.find((w) => w.slug === slug);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    if (!ws) return;
    setLoading(true);
    try {
      const r = await api.get(`/api/v1/workspaces/${ws.id}`);
      setMembers((r.data.members ?? []) as Member[]);
    } catch (e) {
      setError(extractApiError(e).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (ws) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effect intentionally keyed on ws.id only; load is a local closure and ws object identity is irrelevant
  }, [ws?.id]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!ws) return;
    try {
      await api.post(`/api/v1/workspaces/${ws.id}/members`, {
        email: inviteEmail,
        role: "member",
      });
      const invited = inviteEmail;
      setInviteEmail("");
      setInfo(t("workspace.invited", { email: invited }));
      await load();
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  async function onRemove(userId: string) {
    if (!ws) return;
    if (!confirm(t("workspace.removeMemberConfirm"))) return;
    try {
      await api.delete(`/api/v1/workspaces/${ws.id}/members/${userId}`);
      await load();
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  async function onDeleteWorkspace() {
    if (!ws) return;
    if (!confirm(t("workspace.deleteWorkspaceConfirm", { name: ws.name }))) return;
    try {
      await api.delete(`/api/v1/workspaces/${ws.id}`);
      await refreshMe();
      navigate("/dashboard");
    } catch (e) {
      setError(extractApiError(e).message);
    }
  }

  if (!ws) return <div className="text-muted">{t("workspace.notFound")}</div>;
  if (ws.role !== "owner") {
    return (
      <div className="text-danger">{t("workspace.ownerOnly")}</div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-6">{t("workspace.settingsHeader", { name: ws.name })}</h1>

      <section className="bg-surface border border-default rounded p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">{t("workspace.inviteMember")}</h2>
        <form onSubmit={onInvite} className="flex gap-2">
          <input
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            className="flex-1 bg-surface-input border border-default rounded px-3 py-2 text-sm focus:border-accent outline-none"
          />
          <button
            type="submit"
            className="bg-accent hover:bg-accent-hover text-white font-semibold px-4 rounded text-sm"
          >
            {t("workspace.invite")}
          </button>
        </form>
        {info && <div className="text-success text-xs mt-2">{info}</div>}
      </section>

      <section className="bg-surface border border-default rounded p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">
          {t("workspace.membersWithCount", { count: members.length })}
        </h2>
        {loading ? (
          <div className="text-subtle text-sm">{t("common.loading")}</div>
        ) : (
          <ul className="divide-y divide-default">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center justify-between py-2"
              >
                <div>
                  <div className="text-sm">{m.display_name}</div>
                  <div className="text-xs text-subtle">
                    {m.email} · {m.role}
                  </div>
                </div>
                {m.role !== "owner" && (
                  <button
                    type="button"
                    onClick={() => onRemove(m.user_id)}
                    className="text-xs text-danger hover:underline"
                  >
                    {t("common.remove")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-surface border border-danger rounded p-4">
        <h2 className="text-sm font-semibold mb-2 text-danger">{t("common.dangerZone")}</h2>
        <button
          type="button"
          onClick={onDeleteWorkspace}
          className="bg-danger hover:bg-danger-hover text-white font-semibold px-4 py-2 rounded text-sm"
        >
          {t("workspace.deleteWorkspace")}
        </button>
      </section>

      {error && <div className="text-danger text-xs mt-4">{error}</div>}
    </div>
  );
}

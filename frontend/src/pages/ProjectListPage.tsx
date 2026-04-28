import { useAuthStore } from "../stores/auth-store";

export default function ProjectListPage() {
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentId = useAuthStore((s) => s.currentWorkspaceId);
  const current = workspaces.find((w) => w.id === currentId);

  if (!current) {
    return <div className="text-[#94a3b8]">加载中...</div>;
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-4">{current.name}</h1>
      <div className="text-sm text-[#64748b]">
        Project list — populated in S1/T10.
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, extractApiError } from "../lib/api-client";
import { useAuthStore } from "../stores/auth-store";

interface ProcessorInfo {
  type: string;
  models: string[];
}

interface EngineInfo {
  processors: ProcessorInfo[];
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const workspaces = useAuthStore((s) => s.workspaces);
  const currentId = useAuthStore((s) => s.currentWorkspaceId);
  const current = workspaces.find((w) => w.id === currentId);

  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<EngineInfo>("/api/v1/engine/info")
      .then((r) => setEngineInfo(r.data))
      .catch((e) => setEngineError(extractApiError(e).message));
  }, []);

  if (!current) {
    return <div className="text-[#94a3b8]">加载中...</div>;
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">{current.name}</h1>
      <div className="text-sm text-[#94a3b8] mb-6">
        slug: <code className="text-[#a5f3fc]">{current.slug}</code> · 你的角色:{" "}
        {current.role}
      </div>

      <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-[#94a3b8] mb-2 font-semibold">
          Engine Processors
        </div>
        {engineInfo ? (
          <ul className="text-sm space-y-1">
            {engineInfo.processors.map((p) => (
              <li key={p.type} className="flex items-center gap-1">
                <span className="text-[#22c55e]">●</span>
                <span className="font-medium">{p.type}</span>
                {p.models.length > 0 && (
                  <span className="text-[#94a3b8] text-xs">
                    ({p.models.length} model{p.models.length !== 1 ? "s" : ""})
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : engineError ? (
          <div className="text-sm text-[#ef4444]">● {engineError}</div>
        ) : (
          <div className="text-sm text-[#64748b]">检查中...</div>
        )}
      </div>

      <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-6 text-center">
        <div className="text-[#94a3b8] text-sm mb-2">📋 项目即将上线</div>
        <div className="text-xs text-[#64748b]">
          S1 阶段会在这里加上 Project 列表和文档上传。当前是 S0 Foundation 完成态。
        </div>
      </div>

      <div className="text-xs text-[#64748b] mt-4">登录身份: {user?.email}</div>
    </div>
  );
}

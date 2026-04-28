import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, extractApiError } from "../lib/api-client";

export default function WorkspacePage() {
  const { slug, pid } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const docId = searchParams.get("doc");
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (docId || !pid || !slug) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.get<{ items: { id: string }[] }>(
          `/api/v1/projects/${pid}/documents?page=1&page_size=1`
        );
        if (cancelled) return;
        if (r.data.items.length === 0) {
          setEmpty(true);
          return;
        }
        const firstId = r.data.items[0].id;
        navigate(`/workspaces/${slug}/projects/${pid}/workspace?doc=${firstId}`, {
          replace: true,
        });
      } catch (e) {
        if (!cancelled) setError(extractApiError(e).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, pid, slug, navigate]);

  if (empty) {
    return (
      <div className="text-center text-[#94a3b8] py-12">
        <div className="text-sm mb-2">这个 Project 还没有任何文档</div>
        <div className="text-xs text-[#64748b]">请先上传文档</div>
      </div>
    );
  }
  if (error) {
    return <div className="text-center text-[#ef4444] py-12 text-sm">{error}</div>;
  }
  if (!docId) {
    return <div className="text-center text-[#94a3b8] py-12 text-sm">Loading workspace...</div>;
  }

  return (
    <div className="text-center text-[#94a3b8] py-12 text-sm">
      Loading workspace... (doc={docId})
    </div>
  );
}

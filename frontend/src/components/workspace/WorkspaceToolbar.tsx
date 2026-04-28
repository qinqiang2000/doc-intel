import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePredictStore } from "../../stores/predict-store";

interface Props {
  projectId: string;
  projectName: string;
  documents: { id: string; filename: string }[];
  currentDocId: string;
  onSwitch: (docId: string) => void;
}

export default function WorkspaceToolbar({
  projectId, projectName, documents, currentDocId, onSwitch,
}: Props) {
  const navigate = useNavigate();
  const loadNextUnreviewed = usePredictStore((s) => s.loadNextUnreviewed);
  const [open, setOpen] = useState(false);

  const idx = documents.findIndex((d) => d.id === currentDocId);
  const current = idx >= 0 ? documents[idx] : null;
  const prev = idx > 0 ? documents[idx - 1] : null;
  const next = idx >= 0 && idx < documents.length - 1 ? documents[idx + 1] : null;

  async function onNext() {
    const doc = await loadNextUnreviewed(projectId);
    if (doc) {
      onSwitch(doc.id);
    } else {
      alert("已全部 predict 过");
    }
  }

  return (
    <div className="bg-[#1a1d27] border-b border-[#2a2e3d] px-4 py-2 flex items-center gap-3 text-sm">
      <button
        type="button"
        onClick={() => navigate(`/projects/${projectId}`)}
        className="text-[#94a3b8] hover:text-[#e2e8f0] flex items-center gap-1"
        title="回到项目列表"
      >
        ◀ <span>{projectName}</span>
      </button>

      <span className="text-[#2a2e3d]">|</span>

      <span className="text-xs">📄</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="bg-[#0f1117] border border-[#2a2e3d] rounded px-3 py-1 hover:border-[#6366f1] flex items-center gap-2"
        >
          <span className="font-medium">{current ? current.filename : "(选择文档)"}</span>
          <span className="text-[#64748b]">▾</span>
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 w-64 bg-[#1a1d27] border border-[#2a2e3d] rounded shadow-lg z-50 max-h-80 overflow-auto">
            {documents.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onSwitch(d.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#232736] ${
                  d.id === currentDocId ? "text-[#818cf8]" : "text-[#e2e8f0]"
                }`}
              >
                {d.id === currentDocId && "● "}{d.filename}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && onSwitch(prev.id)}
        className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] disabled:opacity-30"
      >
        ← 上一份
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && onSwitch(next.id)}
        className="text-xs text-[#94a3b8] hover:text-[#e2e8f0] disabled:opacity-30"
      >
        下一份 →
      </button>

      <button
        type="button"
        onClick={() => void onNext()}
        className="text-xs text-[#6366f1] hover:underline ml-auto"
      >
        ▶ Next Unreviewed
      </button>
    </div>
  );
}

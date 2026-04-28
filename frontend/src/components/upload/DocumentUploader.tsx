import { useRef, useState, type ChangeEvent } from "react";
import { api, extractApiError } from "../../lib/api-client";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

interface Props {
  projectId: string;
  onUploaded: (doc: { id: string; filename: string }) => void;
}

interface Row {
  filename: string;
  status: "pending" | "uploading" | "done" | "error";
  message?: string;
}

export default function DocumentUploader({ projectId, onUploaded }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const startIndex = rows.length;
    const newRows: Row[] = list.map((f) => ({ filename: f.name, status: "pending" }));
    setRows((prev) => [...prev, ...newRows]);

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const rowIndex = startIndex + i;

      if (file.size > MAX_BYTES) {
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === rowIndex
              ? { ...r, status: "error", message: `超过 50MB 上限（${file.size} bytes）` }
              : r
          )
        );
        continue;
      }
      if (!ALLOWED_MIME.has(file.type)) {
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === rowIndex
              ? { ...r, status: "error", message: `不支持的文件类型: ${file.type || "未知"}` }
              : r
          )
        );
        continue;
      }

      setRows((prev) =>
        prev.map((r, idx) => (idx === rowIndex ? { ...r, status: "uploading" } : r))
      );

      try {
        const fd = new FormData();
        fd.append("file", file);
        const resp = await api.post(`/api/v1/projects/${projectId}/documents`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setRows((prev) =>
          prev.map((r, idx) => (idx === rowIndex ? { ...r, status: "done" } : r))
        );
        onUploaded({ id: resp.data.id, filename: resp.data.filename });
      } catch (e) {
        const err = extractApiError(e);
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === rowIndex
              ? { ...r, status: "error", message: err.message }
              : r
          )
        );
      }
    }
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      void handleFiles(e.target.files);
      e.target.value = "";
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  return (
    <div className="bg-[#1a1d27] border border-dashed border-[#2a2e3d] rounded p-6">
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="text-center cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="text-sm text-[#94a3b8]">
          拖拽文件到此处，或点击选择
        </div>
        <div className="text-xs text-[#64748b] mt-1">
          支持 PDF / PNG / JPG / XLSX / CSV（≤ 50MB）
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onChange}
          className="hidden"
        />
      </div>

      {rows.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs">
          {rows.map((r, idx) => (
            <li
              key={idx}
              className={
                r.status === "done"
                  ? "text-[#22c55e]"
                  : r.status === "error"
                  ? "text-[#ef4444]"
                  : "text-[#94a3b8]"
              }
            >
              {r.status === "done"
                ? "✓"
                : r.status === "error"
                ? "✗"
                : r.status === "uploading"
                ? "⋯"
                : "•"}{" "}
              {r.filename}
              {r.message && ` — ${r.message}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

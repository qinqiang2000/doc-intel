import { useState } from "react";
import type { Annotation, AnnotationPatch, NewAnnotation } from "../../stores/predict-store";

interface Props {
  annotations: Annotation[];
  onPatch: (id: string, patch: AnnotationPatch) => Promise<Annotation>;
  onDelete: (id: string) => Promise<void>;
  onAdd: (input: NewAnnotation) => Promise<Annotation>;
}

export default function AnnotationEditor({
  annotations, onPatch, onDelete, onAdd,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newType, setNewType] = useState("string");
  const [error, setError] = useState<string | null>(null);

  async function handleBlur(a: Annotation, value: string) {
    if (value === a.field_value) return;
    try {
      await onPatch(a.id, { field_value: value });
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "保存失败");
    }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    try {
      await onAdd({ field_name: newName, field_value: newValue, field_type: newType });
      setNewName("");
      setNewValue("");
      setNewType("string");
      setAdding(false);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "添加失败");
    }
  }

  return (
    <div className="space-y-2">
      {annotations.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-sm">
          <span className="text-xs text-[#94a3b8] w-32 truncate" title={a.field_name}>
            {a.field_name}
          </span>
          <input
            type="text"
            defaultValue={a.field_value ?? ""}
            onBlur={(e) => void handleBlur(a, e.target.value)}
            className="flex-1 bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm focus:border-[#6366f1] outline-none"
          />
          <span className="text-xs">
            {a.source === "ai_detected" ? "🤖" : "✏️"}
          </span>
          <button
            type="button"
            onClick={() => void onDelete(a.id)}
            className="text-xs text-[#ef4444] hover:underline"
          >
            删除
          </button>
        </div>
      ))}

      {adding ? (
        <div className="bg-[#0f1117] border border-[#2a2e3d] rounded p-2 space-y-2">
          <label className="block text-xs">
            字段名
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            值
            <input
              value={newValue} onChange={(e) => setNewValue(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            类型
            <select
              value={newType} onChange={(e) => setNewType(e.target.value)}
              className="ml-2 bg-[#1a1d27] border border-[#2a2e3d] rounded px-2 py-0.5 text-sm"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="array">array</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button" onClick={() => void handleAdd()}
              className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded"
            >
              保存
            </button>
            <button
              type="button" onClick={() => setAdding(false)}
              className="text-xs text-[#94a3b8]"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button" onClick={() => setAdding(true)}
          className="text-xs text-[#6366f1] hover:underline"
        >
          + 添加字段
        </button>
      )}

      {error && <div className="text-xs text-[#ef4444]">{error}</div>}
    </div>
  );
}

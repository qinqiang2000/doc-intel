import { useState } from "react";
import { usePredictStore, type Annotation } from "../../stores/predict-store";
import { lineDiff, fieldDiff } from "../../lib/diff";

interface Props {
  projectId: string;
  documentId: string;
  currentPrompt: string;
  annotations: Annotation[];
  currentResult: { structured_data: Record<string, unknown> } | null;
}

export default function NLCorrectionConsole({
  projectId, documentId, currentPrompt, annotations, currentResult,
}: Props) {
  const open = usePredictStore((s) => s.correctionConsoleOpen);
  const setCorrectionConsoleOpen = usePredictStore((s) => s.setCorrectionConsoleOpen);
  const stream = usePredictStore((s) => s.correctionStream);
  const streamCorrection = usePredictStore((s) => s.streamCorrection);
  const discardCorrection = usePredictStore((s) => s.discardCorrection);
  const saveAsNewVersion = usePredictStore((s) => s.saveAsNewVersion);
  const setActivePrompt = usePredictStore((s) => s.setActivePrompt);
  const setPromptHistoryOpen = usePredictStore((s) => s.setPromptHistoryOpen);

  const [userMessage, setUserMessage] = useState("");
  const [targetField, setTargetField] = useState<string>("");
  const [savingSummary, setSavingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");

  if (!open) return null;

  const accumulatedTokens = stream.promptTokens.join("");
  const promptDiff = stream.revisedPrompt ? lineDiff(currentPrompt, stream.revisedPrompt) : null;
  const resultDiff = stream.previewResult
    ? fieldDiff(
        currentResult?.structured_data ?? null,
        stream.previewResult.structured_data,
      )
    : null;

  async function send() {
    if (!userMessage.trim() || stream.active) return;
    await streamCorrection(projectId, documentId, {
      user_message: userMessage,
      current_prompt: currentPrompt,
      target_field: targetField || null,
    });
  }

  function startSave() {
    if (!stream.revisedPrompt) return;
    setSavingSummary(true);
  }

  async function confirmSave() {
    if (!stream.revisedPrompt) return;
    const v = await saveAsNewVersion(projectId, stream.revisedPrompt, summaryDraft);
    await setActivePrompt(projectId, v.id);
    discardCorrection();
    setSavingSummary(false);
    setSummaryDraft("");
    setUserMessage("");
    setCorrectionConsoleOpen(false);
    setPromptHistoryOpen(true);
  }

  return (
    <div className="fixed left-0 right-0 bottom-0 h-[480px] bg-[#1a1d27] border-t border-[#2a2e3d] z-50 flex flex-col text-sm">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#2a2e3d]">
        <h2 className="font-semibold">⚙️ AI 矫正</h2>
        <button onClick={() => setCorrectionConsoleOpen(false)} className="text-[#94a3b8] hover:text-[#e2e8f0]">✕</button>
      </header>

      <div className="px-4 py-2 border-b border-[#2a2e3d] flex gap-2 items-start">
        <textarea
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          placeholder="用自然语言描述如何修改 prompt..."
          rows={2}
          className="flex-1 bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-sm"
        />
        <select
          value={targetField}
          onChange={(e) => setTargetField(e.target.value)}
          className="bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-1 text-xs"
        >
          <option value="">(no target)</option>
          {annotations.map((a) => (
            <option key={a.id} value={a.field_name}>{a.field_name}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={stream.active || !userMessage.trim()}
          onClick={() => void send()}
          className="bg-[#6366f1] text-white px-3 py-1 rounded text-xs disabled:opacity-50"
        >
          Send
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {stream.error && (
          <div className="text-sm text-[#ef4444] bg-[#3f1d1d] border border-[#ef4444] rounded p-2">
            {stream.error}
          </div>
        )}
        {(stream.active || stream.promptTokens.length > 0) && !stream.revisedPrompt && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">Revising prompt...</div>
            <pre className="text-xs whitespace-pre-wrap bg-[#0a0c11] p-2 rounded">
              {accumulatedTokens}
            </pre>
          </div>
        )}
        {promptDiff && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">Revised prompt:</div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <pre className="bg-[#0a0c11] p-2 rounded whitespace-pre-wrap">
                {promptDiff.oldLines.map((l, i) => (
                  <div key={i} className={l.status === "removed" ? "bg-[#3f1d1d] text-[#fca5a5]" : ""}>
                    {l.line}
                  </div>
                ))}
              </pre>
              <pre className="bg-[#0a0c11] p-2 rounded whitespace-pre-wrap">
                {promptDiff.newLines.map((l, i) => (
                  <div key={i} className={l.status === "added" ? "bg-[#1d3f24] text-[#86efac]" : ""}>
                    {l.line}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        )}
        {resultDiff && (
          <div>
            <div className="text-xs text-[#94a3b8] mb-1">Predict result:</div>
            <table className="text-xs w-full">
              <tbody>
                {resultDiff.map((d) => (
                  <tr key={d.field}>
                    <td className="text-[#94a3b8] pr-2">{d.field}</td>
                    <td className="text-[#fca5a5]">{JSON.stringify(d.oldValue ?? null)}</td>
                    <td className="text-[#86efac]">{JSON.stringify(d.newValue ?? null)}</td>
                    <td className="text-[#64748b] pl-2">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 px-4 py-2 border-t border-[#2a2e3d]">
        <button
          type="button"
          onClick={() => discardCorrection()}
          className="text-xs text-[#94a3b8] hover:text-[#e2e8f0]"
        >
          Discard
        </button>
        <div className="flex-1" />
        {savingSummary ? (
          <>
            <input
              autoFocus
              placeholder="summary"
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              className="bg-[#0f1117] border border-[#2a2e3d] rounded px-2 py-0.5 text-xs"
            />
            <button
              type="button" onClick={() => void confirmSave()}
              className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded"
            >
              确认保存
            </button>
            <button
              type="button" onClick={() => setSavingSummary(false)}
              className="text-xs text-[#94a3b8]"
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!stream.revisedPrompt || !stream.previewResult || stream.active}
            onClick={() => startSave()}
            className="bg-[#6366f1] text-white text-xs px-3 py-1 rounded disabled:opacity-50"
          >
            Save as new version
          </button>
        )}
      </footer>
    </div>
  );
}

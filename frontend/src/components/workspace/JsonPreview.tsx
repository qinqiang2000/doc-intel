interface Props {
  structuredData: Record<string, unknown> | null;
  version: number | null;
}

export default function JsonPreview({ structuredData, version }: Props) {
  return (
    <div className="bg-[#1a1d27] border border-[#2a2e3d] rounded p-3 overflow-auto h-full">
      <div className="text-xs uppercase font-semibold tracking-wider text-[#94a3b8] mb-2">
        Structured Data{version != null && ` · v${version}`}
      </div>
      {structuredData ? (
        <pre
          className="text-xs leading-relaxed whitespace-pre-wrap text-[#a5f3fc]"
          style={{ fontFamily: "Fira Code, Courier New, monospace" }}
        >
          {JSON.stringify(structuredData, null, 2)}
        </pre>
      ) : (
        <div className="text-xs text-[#64748b]">尚无 predict 结果</div>
      )}
    </div>
  );
}

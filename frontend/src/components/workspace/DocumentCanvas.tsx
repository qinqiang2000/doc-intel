import { useState, type ReactNode } from "react";
import { Document, Page } from "react-pdf";

interface Props {
  previewUrl: string;
  mimeType: string;
  filename: string;
  children?: ReactNode;
}

export default function DocumentCanvas({
  previewUrl, mimeType, filename, children,
}: Props) {
  const [numPages, setNumPages] = useState<number>(0);

  if (mimeType.startsWith("image/")) {
    return (
      <div className="relative inline-block">
        <img
          src={previewUrl}
          alt={filename}
          className="max-w-full block"
        />
        {children}
      </div>
    );
  }

  if (mimeType === "application/pdf") {
    return (
      <div className="relative">
        <Document
          file={previewUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="text-sm text-[#94a3b8] p-4">加载 PDF...</div>}
        >
          {Array.from({ length: numPages || 1 }, (_, i) => (
            <div key={i} className="relative mb-2 border border-[#2a2e3d]">
              <Page pageNumber={i + 1} renderTextLayer={false} renderAnnotationLayer={false} />
            </div>
          ))}
          {/* Single overlay rendered after all pages. S2b1 assumes page=0;
              multi-page bbox positioning deferred to S2b2. */}
          {children}
        </Document>
      </div>
    );
  }

  return (
    <div className="text-center text-[#94a3b8] p-12 border border-dashed border-[#2a2e3d] rounded">
      <div className="text-sm mb-1">📄 {filename}</div>
      <div className="text-xs text-[#64748b]">暂不支持预览此文件类型 ({mimeType})</div>
    </div>
  );
}

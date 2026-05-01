import { useEffect, useRef, useState, type ReactNode } from "react";
import { Document, Page } from "react-pdf";
import { useTranslation } from "react-i18next";

interface Props {
  previewUrl: string;
  mimeType: string;
  filename: string;
  /** Single overlay for the image branch. Ignored on PDF / unsupported branches. */
  overlay?: ReactNode;
  /** Per-page overlay for the PDF branch. Ignored on image / unsupported branches. */
  renderPageOverlay?: (pageNumber: number, pageRect: DOMRect) => ReactNode;
}

export default function DocumentCanvas({
  previewUrl, mimeType, filename, overlay, renderPageOverlay,
}: Props) {
  const { t } = useTranslation();
  const [numPages, setNumPages] = useState<number>(0);

  if (mimeType.startsWith("image/")) {
    return (
      <div className="relative inline-block">
        <img src={previewUrl} alt={filename} className="max-w-full block" />
        {overlay}
      </div>
    );
  }

  if (mimeType === "application/pdf") {
    return (
      <div className="relative">
        <Document
          file={previewUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="text-sm text-[#94a3b8] p-4">{t("workspacePage.loadingPdf")}</div>}
        >
          {Array.from({ length: numPages || 1 }, (_, i) => (
            <PageWithOverlay
              key={i}
              pageNumber={i + 1}
              renderOverlay={renderPageOverlay}
            />
          ))}
        </Document>
      </div>
    );
  }

  return (
    <div className="text-center text-[#94a3b8] p-12 border border-dashed border-[#2a2e3d] rounded">
      <div className="text-sm mb-1">📄 {filename}</div>
      <div className="text-xs text-[#64748b]">
        {t("workspacePage.previewUnsupported", { mime: mimeType })}
      </div>
    </div>
  );
}

interface PageWithOverlayProps {
  pageNumber: number;
  renderOverlay?: (pageNumber: number, pageRect: DOMRect) => ReactNode;
}

function PageWithOverlay({ pageNumber, renderOverlay }: PageWithOverlayProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setRect(el.getBoundingClientRect());
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setRect(el.getBoundingClientRect());
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="relative mb-2 border border-[#2a2e3d]">
      <Page pageNumber={pageNumber} renderTextLayer={false} renderAnnotationLayer={false} />
      {renderOverlay && rect ? renderOverlay(pageNumber, rect) : null}
    </div>
  );
}

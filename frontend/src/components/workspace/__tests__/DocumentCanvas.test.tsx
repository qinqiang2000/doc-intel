class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof StubResizeObserver })
  .ResizeObserver = StubResizeObserver;

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-pdf", () => ({
  Document: ({ children, file, onLoadSuccess }: {
    children: React.ReactNode;
    file: string;
    onLoadSuccess?: (a: { numPages: number }) => void;
  }) => {
    queueMicrotask(() => onLoadSuccess?.({ numPages: 2 }));
    return <div data-testid="pdf-document" data-file={file}>{children}</div>;
  },
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`pdf-page-${pageNumber}`} data-page={pageNumber}>Page {pageNumber}</div>
  ),
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
}));

import DocumentCanvas from "../DocumentCanvas";

afterEach(() => vi.clearAllMocks());

describe("DocumentCanvas", () => {
  it("renders <img> for image mime types with single `overlay` slot", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview"
        mimeType="image/png"
        filename="x.png"
        overlay={<span data-testid="image-overlay">o</span>}
      />
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "http://x/preview");
    expect(screen.getByTestId("image-overlay")).toBeInTheDocument();
  });

  it("renders react-pdf Document for application/pdf", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview.pdf"
        mimeType="application/pdf"
        filename="x.pdf"
        renderPageOverlay={() => null}
      />
    );
    expect(screen.getByTestId("pdf-document")).toHaveAttribute(
      "data-file",
      "http://x/preview.pdf"
    );
  });

  it("renders unsupported placeholder for xlsx and ignores overlay", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview.xlsx"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename="x.xlsx"
        overlay={<span data-testid="ignored-overlay">should not show</span>}
      />
    );
    expect(screen.getByText(/暂不支持预览/)).toBeInTheDocument();
    expect(screen.queryByTestId("ignored-overlay")).not.toBeInTheDocument();
  });

  it("calls renderPageOverlay once per page after onLoadSuccess fires", async () => {
    const renderPageOverlay = vi.fn((p: number) => (
      <span data-testid={`overlay-page-${p}`}>p{p}</span>
    ));
    render(
      <DocumentCanvas
        previewUrl="http://x/p.pdf"
        mimeType="application/pdf"
        filename="p.pdf"
        renderPageOverlay={renderPageOverlay}
      />
    );
    expect(await screen.findByTestId("overlay-page-1")).toBeInTheDocument();
    expect(await screen.findByTestId("overlay-page-2")).toBeInTheDocument();
    expect(renderPageOverlay).toHaveBeenCalledWith(1, expect.any(Object));
    expect(renderPageOverlay).toHaveBeenCalledWith(2, expect.any(Object));
  });

  it("works without an overlay prop on image branch (renders image only)", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/p.png"
        mimeType="image/jpeg"
        filename="p.jpg"
      />
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "http://x/p.png");
  });

  it("works without renderPageOverlay on PDF branch (renders pages only)", async () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/p.pdf"
        mimeType="application/pdf"
        filename="p.pdf"
      />
    );
    expect(await screen.findByTestId("pdf-page-1")).toBeInTheDocument();
    expect(await screen.findByTestId("pdf-page-2")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock react-pdf to avoid pdfjs worker in jsdom
vi.mock("react-pdf", () => ({
  Document: ({ children, file }: { children: React.ReactNode; file: string }) => (
    <div data-testid="pdf-document" data-file={file}>{children}</div>
  ),
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid="pdf-page" data-page={pageNumber}>Page {pageNumber}</div>
  ),
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
}));

import DocumentCanvas from "../DocumentCanvas";

afterEach(() => vi.clearAllMocks());

describe("DocumentCanvas", () => {
  it("renders <img> for image mime types", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview"
        mimeType="image/png"
        filename="x.png"
      >
        <span data-testid="bbox-overlay">bboxes</span>
      </DocumentCanvas>
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "http://x/preview");
    expect(screen.getByTestId("bbox-overlay")).toBeInTheDocument();
  });

  it("renders react-pdf Document for application/pdf", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview.pdf"
        mimeType="application/pdf"
        filename="x.pdf"
      >
        <span data-testid="bbox-overlay">bboxes</span>
      </DocumentCanvas>
    );
    expect(screen.getByTestId("pdf-document")).toHaveAttribute(
      "data-file",
      "http://x/preview.pdf"
    );
  });

  it("renders unsupported placeholder for xlsx", () => {
    render(
      <DocumentCanvas
        previewUrl="http://x/preview.xlsx"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename="x.xlsx"
      >
        <span data-testid="bbox-overlay">bboxes</span>
      </DocumentCanvas>
    );
    expect(screen.getByText(/暂不支持预览/)).toBeInTheDocument();
    expect(screen.queryByTestId("bbox-overlay")).not.toBeInTheDocument();
  });

  it("renders children (BboxOverlay) inside container for images and PDFs", () => {
    const { rerender } = render(
      <DocumentCanvas
        previewUrl="http://x/p.png"
        mimeType="image/png"
        filename="p.png"
      >
        <span data-testid="overlay">o</span>
      </DocumentCanvas>
    );
    expect(screen.getByTestId("overlay")).toBeInTheDocument();
    rerender(
      <DocumentCanvas
        previewUrl="http://x/p.pdf"
        mimeType="application/pdf"
        filename="p.pdf"
      >
        <span data-testid="overlay">o</span>
      </DocumentCanvas>
    );
    expect(screen.getByTestId("overlay")).toBeInTheDocument();
  });
});

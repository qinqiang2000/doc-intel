import MockAdapter from "axios-mock-adapter";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/api-client";
import DocumentUploader from "../DocumentUploader";

let mock: MockAdapter;
const onUploadedMock = vi.fn();

beforeEach(() => {
  mock = new MockAdapter(api);
  onUploadedMock.mockReset();
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

function makeFile(name: string, size: number, type = "application/pdf") {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe("DocumentUploader", () => {
  it("renders the dropzone", () => {
    render(<DocumentUploader projectId="p-1" onUploaded={onUploadedMock} />);
    expect(screen.getByText(/Drag files/i)).toBeInTheDocument();
  });

  it("uploads a single file via POST and calls onUploaded", async () => {
    mock.onPost("/api/v1/projects/p-1/documents").reply(201, {
      id: "d-1", project_id: "p-1", filename: "x.pdf",
      file_path: "x.pdf", file_size: 10, mime_type: "application/pdf",
      status: "ready", is_ground_truth: false, uploaded_by: "u-1",
      created_at: "", updated_at: "", deleted_at: null,
    });

    const { container } = render(
      <DocumentUploader projectId="p-1" onUploaded={onUploadedMock} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile("x.pdf", 10);
    await userEvent.upload(fileInput, file);

    await waitFor(() => expect(mock.history.post.length).toBe(1));
    expect(onUploadedMock).toHaveBeenCalled();
  });

  it("rejects files > 50MB client-side without POSTing", async () => {
    const { container } = render(
      <DocumentUploader projectId="p-1" onUploaded={onUploadedMock} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const big = makeFile("big.pdf", 51 * 1024 * 1024);
    await userEvent.upload(fileInput, big);

    await waitFor(() => {
      expect(screen.getByText(/Exceeds.*50/i)).toBeInTheDocument();
    });
    expect(mock.history.post.length).toBe(0);
  });

  it("rejects unsupported types client-side", async () => {
    const { container } = render(
      <DocumentUploader projectId="p-1" onUploaded={onUploadedMock} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const bad = makeFile("doc.docx", 10, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    await userEvent.upload(fileInput, bad);

    await waitFor(() => {
      expect(screen.getByText(/Unsupported/i)).toBeInTheDocument();
    });
    expect(mock.history.post.length).toBe(0);
  });

  it("uploads multiple files serially", async () => {
    mock.onPost("/api/v1/projects/p-1/documents").reply(201, {
      id: "d", project_id: "p-1", filename: "x.pdf", file_path: "x.pdf",
      file_size: 1, mime_type: "application/pdf", status: "ready",
      is_ground_truth: false, uploaded_by: "u-1",
      created_at: "", updated_at: "", deleted_at: null,
    });

    const { container } = render(
      <DocumentUploader projectId="p-1" onUploaded={onUploadedMock} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, [makeFile("a.pdf", 1), makeFile("b.pdf", 1)]);

    await waitFor(() => expect(mock.history.post.length).toBe(2));
    expect(onUploadedMock).toHaveBeenCalledTimes(2);
  });

  it("shows error on server failure but keeps the upload UI", async () => {
    mock.onPost("/api/v1/projects/p-1/documents").reply(500, {
      error: { code: "upload_failed", message: "Disk full" },
    });

    const { container } = render(
      <DocumentUploader projectId="p-1" onUploaded={onUploadedMock} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, makeFile("x.pdf", 1));

    expect(await screen.findByText(/Disk full/)).toBeInTheDocument();
    expect(onUploadedMock).not.toHaveBeenCalled();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnnotationEditor from "../AnnotationEditor";
import { usePredictStore } from "../../../stores/predict-store";

const onPatchMock = vi.fn();
const onDeleteMock = vi.fn();
const onAddMock = vi.fn();
const onRemoveLocalMock = vi.fn();
const onRestoreLocalMock = vi.fn();

const annotations = [
  {
    id: "a-1", document_id: "d-1", field_name: "invoice_number",
    field_value: "INV-001", field_type: "string", bounding_box: null,
    source: "ai_detected", confidence: 0.95, is_ground_truth: false,
    created_by: "u-1", updated_by_user_id: null,
    created_at: "", updated_at: "",
  },
  {
    id: "a-2", document_id: "d-1", field_name: "total_amount",
    field_value: "1234", field_type: "number", bounding_box: null,
    source: "manual", confidence: null, is_ground_truth: false,
    created_by: "u-1", updated_by_user_id: null,
    created_at: "", updated_at: "",
  },
];

beforeEach(() => {
  vi.useRealTimers();
  onPatchMock.mockReset().mockImplementation(async (_id, p) => ({ ...annotations[0], ...p }));
  onDeleteMock.mockReset().mockResolvedValue(undefined);
  onAddMock.mockReset().mockResolvedValue({
    ...annotations[0], id: "a-new", field_name: "new_field", field_value: "v",
  });
  onRemoveLocalMock.mockReset();
  onRestoreLocalMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("AnnotationEditor", () => {
  it("renders all annotations with name, value, source chip", () => {
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
        onRemoveLocal={onRemoveLocalMock}
        onRestoreLocal={onRestoreLocalMock}
      />
    );
    expect(screen.getByDisplayValue("INV-001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1234")).toBeInTheDocument();
    expect(screen.getByText("🤖")).toBeInTheDocument();
    expect(screen.getByText("✏️")).toBeInTheDocument();
  });

  it("editing a field on blur calls onPatch", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
        onRemoveLocal={onRemoveLocalMock}
        onRestoreLocal={onRestoreLocalMock}
      />
    );
    const input = screen.getByDisplayValue("INV-001");
    await user.clear(input);
    await user.type(input, "INV-002");
    await user.tab();
    await waitFor(() => expect(onPatchMock).toHaveBeenCalledWith("a-1", { field_value: "INV-002" }));
  });

  it("clicking delete optimistically removes the row and defers onDelete to the undo window", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
        onRemoveLocal={onRemoveLocalMock}
        onRestoreLocal={onRestoreLocalMock}
      />
    );
    const buttons = screen.getAllByRole("button", { name: /Delete/i });
    await user.click(buttons[0]);
    expect(onRemoveLocalMock).toHaveBeenCalledWith("a-1");
    expect(onDeleteMock).not.toHaveBeenCalled();

    // Real-timer wait: undo window is 5s, so we wait a bit longer for the
    // commit. waitFor polls so this resolves as soon as commit fires.
    await waitFor(
      () => expect(onDeleteMock).toHaveBeenCalledWith("a-1"),
      { timeout: 7000 },
    );
  }, 10000);

  it("'+ Add field' opens form and POSTs", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
        onRemoveLocal={onRemoveLocalMock}
        onRestoreLocal={onRestoreLocalMock}
      />
    );
    await user.click(screen.getByRole("button", { name: /Add field/i }));
    await user.type(screen.getByLabelText(/Field name/i), "new_field");
    await user.type(screen.getByLabelText(/^Value/i), "v");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(onAddMock).toHaveBeenCalledWith({
        field_name: "new_field",
        field_value: "v",
        field_type: "string",
      })
    );
  });

  it("empty annotations renders only the + button", () => {
    render(
      <AnnotationEditor
        annotations={[]}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
        onRemoveLocal={onRemoveLocalMock}
        onRestoreLocal={onRestoreLocalMock}
      />
    );
    expect(screen.getByRole("button", { name: /Add field/i })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("INV-001")).not.toBeInTheDocument();
  });

  it("highlights the row whose id matches selectedAnnotationId", () => {
    usePredictStore.setState({ selectedAnnotationId: "a-2" });
    render(
      <AnnotationEditor
        annotations={[
          {
            id: "a-1", document_id: "d-1", field_name: "field-1",
            field_value: "v1", field_type: "string", bounding_box: null,
            source: "ai_detected", confidence: null, is_ground_truth: false,
            created_by: "u-1", updated_by_user_id: null,
            created_at: "", updated_at: "",
          },
          {
            id: "a-2", document_id: "d-1", field_name: "field-2",
            field_value: "v2", field_type: "string", bounding_box: null,
            source: "ai_detected", confidence: null, is_ground_truth: false,
            created_by: "u-1", updated_by_user_id: null,
            created_at: "", updated_at: "",
          },
        ]}
        onPatch={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
        onRemoveLocal={vi.fn()} onRestoreLocal={vi.fn()}
      />
    );
    const row1 = screen.getByText("field-1").closest("[data-row-id]") as HTMLElement;
    const row2 = screen.getByText("field-2").closest("[data-row-id]") as HTMLElement;
    expect(row1.className).not.toMatch(/border-\[#6366f1\]/);
    expect(row2.className).toMatch(/border-\[#6366f1\]/);
  });

  it("clicking a row body sets selectedAnnotationId in store", async () => {
    usePredictStore.setState({ selectedAnnotationId: null });
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={[{
          id: "a-1", document_id: "d-1", field_name: "field-1",
          field_value: "v1", field_type: "string", bounding_box: null,
          source: "ai_detected", confidence: null, is_ground_truth: false,
          created_by: "u-1", updated_by_user_id: null,
          created_at: "", updated_at: "",
        }]}
        onPatch={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
        onRemoveLocal={vi.fn()} onRestoreLocal={vi.fn()}
      />
    );
    await user.click(screen.getByText("field-1"));
    expect(usePredictStore.getState().selectedAnnotationId).toBe("a-1");
  });

  it("clicking the value input does NOT trigger row selection", async () => {
    usePredictStore.setState({ selectedAnnotationId: null });
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={[{
          id: "a-1", document_id: "d-1", field_name: "field-1",
          field_value: "v1", field_type: "string", bounding_box: null,
          source: "ai_detected", confidence: null, is_ground_truth: false,
          created_by: "u-1", updated_by_user_id: null,
          created_at: "", updated_at: "",
        }]}
        onPatch={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
        onRemoveLocal={vi.fn()} onRestoreLocal={vi.fn()}
      />
    );
    const input = screen.getByDisplayValue("v1");
    await user.click(input);
    expect(usePredictStore.getState().selectedAnnotationId).toBeNull();
  });

  it("calls scrollIntoView on the selected row when selection changes", () => {
    const scrollFn = vi.fn();
    Element.prototype.scrollIntoView = scrollFn;
    usePredictStore.setState({ selectedAnnotationId: "a-1" });
    render(
      <AnnotationEditor
        annotations={[{
          id: "a-1", document_id: "d-1", field_name: "field-1",
          field_value: "v1", field_type: "string", bounding_box: null,
          source: "ai_detected", confidence: null, is_ground_truth: false,
          created_by: "u-1", updated_by_user_id: null,
          created_at: "", updated_at: "",
        }]}
        onPatch={vi.fn()} onDelete={vi.fn()} onAdd={vi.fn()}
        onRemoveLocal={vi.fn()} onRestoreLocal={vi.fn()}
      />
    );
    expect(scrollFn).toHaveBeenCalledWith(
      expect.objectContaining({ block: "nearest" })
    );
  });
});

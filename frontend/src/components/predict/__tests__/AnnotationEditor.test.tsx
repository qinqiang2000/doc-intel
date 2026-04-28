import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnnotationEditor from "../AnnotationEditor";

const onPatchMock = vi.fn();
const onDeleteMock = vi.fn();
const onAddMock = vi.fn();

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
  onPatchMock.mockReset().mockImplementation(async (_id, p) => ({ ...annotations[0], ...p }));
  onDeleteMock.mockReset();
  onAddMock.mockReset().mockResolvedValue({
    ...annotations[0], id: "a-new", field_name: "new_field", field_value: "v",
  });
});

afterEach(() => vi.clearAllMocks());

describe("AnnotationEditor", () => {
  it("renders all annotations with name, value, source chip", () => {
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
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
      />
    );
    const input = screen.getByDisplayValue("INV-001");
    await user.clear(input);
    await user.type(input, "INV-002");
    await user.tab();
    await waitFor(() => expect(onPatchMock).toHaveBeenCalledWith("a-1", { field_value: "INV-002" }));
  });

  it("clicking delete calls onDelete", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
      />
    );
    const buttons = screen.getAllByRole("button", { name: /删除/ });
    await user.click(buttons[0]);
    expect(onDeleteMock).toHaveBeenCalledWith("a-1");
  });

  it("'+ 添加字段' opens form and POSTs", async () => {
    const user = userEvent.setup();
    render(
      <AnnotationEditor
        annotations={annotations as never}
        onPatch={onPatchMock}
        onDelete={onDeleteMock}
        onAdd={onAddMock}
      />
    );
    await user.click(screen.getByRole("button", { name: /添加字段/ }));
    await user.type(screen.getByLabelText(/字段名/), "new_field");
    await user.type(screen.getByLabelText(/^值/), "v");
    await user.click(screen.getByRole("button", { name: /保存/ }));
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
      />
    );
    expect(screen.getByRole("button", { name: /添加字段/ })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("INV-001")).not.toBeInTheDocument();
  });
});

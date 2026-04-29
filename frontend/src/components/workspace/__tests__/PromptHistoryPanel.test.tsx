import MockAdapter from "axios-mock-adapter";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/api-client";
import { usePredictStore, type PromptVersion } from "../../../stores/predict-store";
import PromptHistoryPanel from "../PromptHistoryPanel";

let mock: MockAdapter;

const pv = (overrides: Partial<PromptVersion> = {}): PromptVersion => ({
  id: "v-1", project_id: "p-1", version: 1,
  prompt_text: "body", summary: "first",
  created_by: "u-1", created_at: "",
  is_active: false,
  ...overrides,
});

beforeEach(() => {
  mock = new MockAdapter(api);
  usePredictStore.setState({
    promptVersions: [],
    promptHistoryOpen: true,
  });
});

afterEach(() => {
  mock.restore();
  vi.clearAllMocks();
});

describe("PromptHistoryPanel", () => {
  it("does not render when promptHistoryOpen is false", () => {
    usePredictStore.setState({ promptHistoryOpen: false });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, []);
    render(<PromptHistoryPanel projectId="p-1" />);
    expect(screen.queryByText(/Prompt 历史/)).not.toBeInTheDocument();
  });

  it("renders versions in DESC order with active badged", () => {
    usePredictStore.setState({
      promptVersions: [
        pv({ id: "v-2", version: 2, summary: "fix tax", is_active: true }),
        pv({ id: "v-1", version: 1, summary: "first" }),
      ],
    });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, []);
    render(<PromptHistoryPanel projectId="p-1" />);
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    expect(screen.getByText(/v1/)).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it("clicking 'Set as active' triggers PATCH and reload", async () => {
    usePredictStore.setState({
      promptVersions: [pv({ is_active: false })],
    });
    let patched = false;
    mock.onPatch("/api/v1/projects/p-1/active-prompt").reply((cfg) => {
      patched = true;
      return [200, { id: "p-1", active_prompt_version_id: "v-1" }];
    });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, [
      pv({ is_active: true }),
    ]);
    const user = userEvent.setup();
    render(<PromptHistoryPanel projectId="p-1" />);
    await user.click(screen.getByText(/v1/));
    await user.click(screen.getByRole("button", { name: /Set as active/i }));
    expect(patched).toBe(true);
  });

  it("'Delete' button is disabled on the active version", async () => {
    usePredictStore.setState({
      promptVersions: [pv({ is_active: true })],
    });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, []);
    const user = userEvent.setup();
    render(<PromptHistoryPanel projectId="p-1" />);
    await user.click(screen.getByText(/v1/));
    const del = screen.getByRole("button", { name: /Delete/i });
    expect(del).toBeDisabled();
  });

  it("'Use template default' calls setActivePrompt with null", async () => {
    usePredictStore.setState({
      promptVersions: [pv({ is_active: true })],
    });
    let patchedNull = false;
    mock.onPatch("/api/v1/projects/p-1/active-prompt").reply((cfg) => {
      const body = JSON.parse(cfg.data || "{}");
      if (body.version_id === null) patchedNull = true;
      return [200, { id: "p-1", active_prompt_version_id: null }];
    });
    mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, [
      pv({ is_active: false }),
    ]);
    const user = userEvent.setup();
    render(<PromptHistoryPanel projectId="p-1" />);
    await user.click(screen.getByRole("button", { name: /Use template default/i }));
    expect(patchedNull).toBe(true);
  });
});

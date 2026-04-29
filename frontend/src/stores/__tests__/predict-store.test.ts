import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../lib/api-client";
import { usePredictStore } from "../predict-store";

let mock: MockAdapter;

const PR = {
  id: "pr-1", document_id: "d-1", version: 1,
  structured_data: { invoice_number: "INV-001" },
  inferred_schema: { invoice_number: "string" },
  prompt_used: "p", processor_key: "mock|m", source: "predict",
  created_by: "u-1", created_at: "2026-04-28T00:00:00Z",
};

const ANN = {
  id: "a-1", document_id: "d-1", field_name: "invoice_number",
  field_value: "INV-001", field_type: "string", bounding_box: null,
  source: "ai_detected", confidence: null, is_ground_truth: false,
  created_by: "u-1", updated_by_user_id: null,
  created_at: "2026-04-28T00:00:00Z", updated_at: "2026-04-28T00:00:00Z",
};

beforeEach(() => {
  mock = new MockAdapter(api);
  usePredictStore.setState({
    loading: {}, results: {}, batchProgress: null,
    selectedAnnotationId: null,
    currentStep: 0,
    apiFormat: "flat",
    processorOverride: "",
    promptOverride: "",
    promptVersions: [],
    correctionStream: {
      active: false, promptTokens: [], revisedPrompt: null,
      previewResult: null, error: null,
    },
    promptHistoryOpen: false,
    correctionConsoleOpen: false,
  });
});

afterEach(() => mock.restore());

describe("predict-store", () => {
  it("predictSingle calls POST and stores result", async () => {
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(200, PR);
    const got = await usePredictStore.getState().predictSingle("p-1", "d-1");
    expect(got.id).toBe("pr-1");
    expect(usePredictStore.getState().results["d-1"].id).toBe("pr-1");
  });

  it("predictSingle sets loading flag during call and clears after", async () => {
    let resolved = false;
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply(() => {
      resolved = true;
      return [200, PR];
    });
    const promise = usePredictStore.getState().predictSingle("p-1", "d-1");
    expect(usePredictStore.getState().loading["d-1"]).toBe(true);
    await promise;
    expect(resolved).toBe(true);
    expect(usePredictStore.getState().loading["d-1"]).toBe(false);
  });

  it("predictSingle accepts overrides as options", async () => {
    mock.onPost("/api/v1/projects/p-1/documents/d-1/predict").reply((cfg) => {
      const body = JSON.parse(cfg.data);
      expect(body.prompt_override).toBe("custom");
      expect(body.processor_key_override).toBe("openai|gpt-4o");
      return [200, PR];
    });
    await usePredictStore.getState().predictSingle("p-1", "d-1", {
      promptOverride: "custom",
      processorKeyOverride: "openai|gpt-4o",
    });
  });

  it("loadAnnotations populates and returns array", async () => {
    mock.onGet("/api/v1/documents/d-1/annotations").reply(200, [ANN]);
    const arr = await usePredictStore.getState().loadAnnotations("d-1");
    expect(arr).toHaveLength(1);
  });

  it("patchAnnotation calls PATCH and returns updated row", async () => {
    mock.onPatch("/api/v1/documents/d-1/annotations/a-1").reply(200, {
      ...ANN, field_value: "v2",
    });
    const out = await usePredictStore.getState().patchAnnotation("d-1", "a-1", { field_value: "v2" });
    expect(out.field_value).toBe("v2");
  });

  it("deleteAnnotation calls DELETE", async () => {
    mock.onDelete("/api/v1/documents/d-1/annotations/a-1").reply(204);
    await usePredictStore.getState().deleteAnnotation("d-1", "a-1");
    expect(mock.history.delete.length).toBe(1);
  });

  it("addAnnotation calls POST with body", async () => {
    mock.onPost("/api/v1/documents/d-1/annotations").reply(201, ANN);
    const out = await usePredictStore.getState().addAnnotation("d-1", {
      field_name: "x", field_value: "v",
    });
    expect(out.id).toBe("a-1");
  });

  it("loadNextUnreviewed returns null on 404", async () => {
    mock.onGet("/api/v1/projects/p-1/documents/next-unreviewed").reply(404, {
      error: { code: "no_unreviewed_documents", message: "all done" },
    });
    const r = await usePredictStore.getState().loadNextUnreviewed("p-1");
    expect(r).toBeNull();
  });

  describe("workspace state (S2b1 additions)", () => {
    it("setSelectedAnnotationId updates state", () => {
      usePredictStore.getState().setSelectedAnnotationId("a-1");
      expect(usePredictStore.getState().selectedAnnotationId).toBe("a-1");
      usePredictStore.getState().setSelectedAnnotationId(null);
      expect(usePredictStore.getState().selectedAnnotationId).toBeNull();
    });

    it("setStep updates currentStep", () => {
      usePredictStore.getState().setStep(2);
      expect(usePredictStore.getState().currentStep).toBe(2);
    });

    it("setApiFormat updates apiFormat", () => {
      usePredictStore.getState().setApiFormat("detailed");
      expect(usePredictStore.getState().apiFormat).toBe("detailed");
    });

    it("setProcessorOverride updates processorOverride", () => {
      usePredictStore.getState().setProcessorOverride("openai|gpt-4o");
      expect(usePredictStore.getState().processorOverride).toBe("openai|gpt-4o");
    });

    it("setPromptOverride updates promptOverride", () => {
      usePredictStore.getState().setPromptOverride("custom prompt");
      expect(usePredictStore.getState().promptOverride).toBe("custom prompt");
    });
  });

  describe("S3 prompt-version + correction state", () => {
    it("loadPromptVersions GETs and stores", async () => {
      const versions = [
        {
          id: "v-1", project_id: "p-1", version: 1,
          prompt_text: "first", summary: "x",
          created_by: "u-1", created_at: "",
          is_active: true,
        },
      ];
      mock.onGet("/api/v1/projects/p-1/prompt-versions").reply(200, versions);
      const out = await usePredictStore.getState().loadPromptVersions("p-1");
      expect(out).toEqual(versions);
      expect(usePredictStore.getState().promptVersions).toEqual(versions);
    });

    it("saveAsNewVersion POSTs and returns the row", async () => {
      mock.onPost("/api/v1/projects/p-1/prompt-versions").reply(201, {
        id: "v-2", project_id: "p-1", version: 2,
        prompt_text: "rev", summary: "fix tax-id",
        created_by: "u-1", created_at: "",
        is_active: false,
      });
      const out = await usePredictStore
        .getState()
        .saveAsNewVersion("p-1", "rev", "fix tax-id");
      expect(out.version).toBe(2);
      expect(out.summary).toBe("fix tax-id");
    });

    it("setActivePrompt PATCHes and returns active id", async () => {
      mock.onPatch("/api/v1/projects/p-1/active-prompt").reply(200, {
        id: "p-1", active_prompt_version_id: "v-1",
      });
      const out = await usePredictStore.getState().setActivePrompt("p-1", "v-1");
      expect(out.active_prompt_version_id).toBe("v-1");
    });

    it("discardCorrection resets correctionStream", () => {
      usePredictStore.setState({
        correctionStream: {
          active: false,
          promptTokens: ["a", "b"],
          revisedPrompt: "ab",
          previewResult: { structured_data: { x: 1 }, annotations: [] },
          error: null,
        },
      });
      usePredictStore.getState().discardCorrection();
      const s = usePredictStore.getState().correctionStream;
      expect(s.promptTokens).toEqual([]);
      expect(s.revisedPrompt).toBeNull();
      expect(s.previewResult).toBeNull();
      expect(s.active).toBe(false);
      expect(s.error).toBeNull();
    });
  });
});

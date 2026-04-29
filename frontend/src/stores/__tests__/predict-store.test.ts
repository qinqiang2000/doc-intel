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

  describe("S4 evaluation state", () => {
    it("runEvaluation POSTs and returns the row", async () => {
      mock.onPost("/api/v1/projects/p-1/evaluations").reply(201, {
        id: "r-1", project_id: "p-1", prompt_version_id: null,
        name: "first", num_docs: 1, num_fields_evaluated: 5, num_matches: 4,
        accuracy_avg: 0.8, status: "completed", error_message: null,
        created_by: "u-1", created_at: "",
      });
      const out = await usePredictStore.getState().runEvaluation("p-1", "first");
      expect(out.accuracy_avg).toBe(0.8);
      expect(out.name).toBe("first");
    });

    it("listEvaluations GETs the list", async () => {
      mock.onGet("/api/v1/projects/p-1/evaluations").reply(200, [
        {
          id: "r-1", project_id: "p-1", prompt_version_id: null,
          name: "x", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
          accuracy_avg: 1, status: "completed", error_message: null,
          created_by: "u-1", created_at: "",
        },
      ]);
      const out = await usePredictStore.getState().listEvaluations("p-1");
      expect(out.length).toBe(1);
      expect(out[0].id).toBe("r-1");
    });

    it("getEvaluationDetail returns {run, fields}", async () => {
      mock.onGet("/api/v1/evaluations/r-1").reply(200, {
        run: {
          id: "r-1", project_id: "p-1", prompt_version_id: null,
          name: "", num_docs: 1, num_fields_evaluated: 1, num_matches: 1,
          accuracy_avg: 1, status: "completed", error_message: null,
          created_by: "u-1", created_at: "",
        },
        fields: [
          {
            id: "fr-1", run_id: "r-1", document_id: "d-1",
            document_filename: "a.pdf", field_name: "invoice_number",
            predicted_value: "INV-1", expected_value: "INV-1",
            match_status: "exact", created_at: "",
          },
        ],
      });
      const out = await usePredictStore.getState().getEvaluationDetail("r-1");
      expect(out.run.id).toBe("r-1");
      expect(out.fields.length).toBe(1);
    });

    it("deleteEvaluation DELETEs", async () => {
      let deleted = false;
      mock.onDelete("/api/v1/evaluations/r-1").reply(() => {
        deleted = true;
        return [204, ""];
      });
      await usePredictStore.getState().deleteEvaluation("r-1");
      expect(deleted).toBe(true);
    });
  });

  describe("S5 api publish state", () => {
    it("publishApi POSTs and returns project with api_code", async () => {
      mock.onPost("/api/v1/projects/p-1/publish").reply(200, {
        id: "p-1", workspace_id: "ws-1", name: "P", slug: "p", description: null,
        template_key: "custom", created_by: "u-1",
        created_at: "", updated_at: "", deleted_at: null,
        api_code: "receipts",
        api_published_at: "2026-04-29T12:00:00",
        api_disabled_at: null,
      });
      const out = await usePredictStore.getState().publishApi("p-1", "receipts");
      expect(out.api_code).toBe("receipts");
      expect(out.api_disabled_at).toBeNull();
    });

    it("unpublishApi POSTs and returns project with api_disabled_at", async () => {
      mock.onPost("/api/v1/projects/p-1/unpublish").reply(200, {
        id: "p-1", workspace_id: "ws-1", name: "P", slug: "p", description: null,
        template_key: "custom", created_by: "u-1",
        created_at: "", updated_at: "", deleted_at: null,
        api_code: "receipts",
        api_published_at: "2026-04-29T12:00:00",
        api_disabled_at: "2026-04-29T13:00:00",
      });
      const out = await usePredictStore.getState().unpublishApi("p-1");
      expect(out.api_disabled_at).not.toBeNull();
    });

    it("listApiKeys GETs and returns array", async () => {
      mock.onGet("/api/v1/projects/p-1/api-keys").reply(200, [{
        id: "k-1", project_id: "p-1", name: "production",
        key_prefix: "dik_AbCdEfGh", is_active: true,
        last_used_at: null, created_by: "u-1", created_at: "",
      }]);
      const out = await usePredictStore.getState().listApiKeys("p-1");
      expect(out.length).toBe(1);
      expect(out[0].key_prefix).toBe("dik_AbCdEfGh");
    });

    it("createApiKey POSTs and returns response with full key once", async () => {
      mock.onPost("/api/v1/projects/p-1/api-keys").reply(201, {
        id: "k-1", project_id: "p-1", name: "production",
        key_prefix: "dik_AbCdEfGh", is_active: true,
        last_used_at: null, created_by: "u-1", created_at: "",
        key: "dik_AbCdEfGh_LongFullKeyHereXYZ123",
      });
      const out = await usePredictStore.getState().createApiKey("p-1", "production");
      expect(out.key).toMatch(/^dik_/);
      expect(out.key.startsWith(out.key_prefix)).toBe(true);
    });

    it("deleteApiKey DELETEs", async () => {
      let deleted = false;
      mock.onDelete("/api/v1/projects/p-1/api-keys/k-1").reply(() => {
        deleted = true;
        return [204, ""];
      });
      await usePredictStore.getState().deleteApiKey("p-1", "k-1");
      expect(deleted).toBe(true);
    });
  });
});

import { create } from "zustand";
import { api, extractApiError } from "../lib/api-client";
import { streamSse } from "../lib/sse";
import { getToken } from "../lib/auth-storage";

export interface ProcessingResult {
  id: string;
  document_id: string;
  version: number;
  structured_data: Record<string, unknown>;
  inferred_schema: Record<string, string> | null;
  prompt_used: string;
  processor_key: string;
  source: string;
  created_by: string;
  created_at: string;
}

export interface Annotation {
  id: string;
  document_id: string;
  field_name: string;
  field_value: string | null;
  field_type: string;
  bounding_box: Record<string, number> | null;
  source: "ai_detected" | "manual";
  confidence: number | null;
  is_ground_truth: boolean;
  created_by: string;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptVersion {
  id: string;
  project_id: string;
  version: number;
  prompt_text: string;
  summary: string;
  created_by: string;
  created_at: string;
  is_active: boolean;
}

export interface EvaluationRun {
  id: string;
  project_id: string;
  prompt_version_id: string | null;
  name: string;
  num_docs: number;
  num_fields_evaluated: number;
  num_matches: number;
  accuracy_avg: number;
  status: "completed" | "failed";
  error_message: string | null;
  created_by: string;
  created_at: string;
}

export interface EvaluationFieldResult {
  id: string;
  run_id: string;
  document_id: string | null;
  document_filename: string;
  field_name: string;
  predicted_value: string | null;
  expected_value: string | null;
  match_status: "exact" | "fuzzy" | "mismatch" | "missing_pred" | "missing_expected";
  created_at: string;
}

export interface CorrectionStreamState {
  active: boolean;
  promptTokens: string[];
  revisedPrompt: string | null;
  previewResult: {
    structured_data: Record<string, unknown>;
    annotations: unknown[];
  } | null;
  error: string | null;
}

export interface PredictOptions {
  promptOverride?: string;
  processorKeyOverride?: string;
}

export interface NewAnnotation {
  field_name: string;
  field_value?: string;
  field_type?: string;
  bounding_box?: Record<string, number>;
  is_ground_truth?: boolean;
}

export interface AnnotationPatch {
  field_value?: string | null;
  field_type?: string;
  bounding_box?: Record<string, number> | null;
  is_ground_truth?: boolean;
}

export interface BatchEvent {
  document_id: string;
  status: "started" | "completed" | "failed";
  processing_result_id?: string;
  error?: string;
}

export interface BatchProgress {
  total: number;
  events: BatchEvent[];
  done: boolean;
  succeeded: number;
  failed: number;
}

interface PredictState {
  loading: Record<string, boolean>;
  results: Record<string, ProcessingResult>;
  batchProgress: BatchProgress | null;
  selectedAnnotationId: string | null;
  currentStep: 0 | 1 | 2 | 3 | 4;
  apiFormat: "flat" | "detailed" | "grouped";
  processorOverride: string;
  promptOverride: string;
  setSelectedAnnotationId: (id: string | null) => void;
  setStep: (step: 0 | 1 | 2 | 3 | 4) => void;
  setApiFormat: (f: "flat" | "detailed" | "grouped") => void;
  setProcessorOverride: (s: string) => void;
  setPromptOverride: (s: string) => void;

  predictSingle: (
    projectId: string, documentId: string, opts?: PredictOptions
  ) => Promise<ProcessingResult>;
  predictBatch: (
    projectId: string, documentIds: string[], opts?: PredictOptions
  ) => Promise<void>;
  loadAnnotations: (documentId: string) => Promise<Annotation[]>;
  patchAnnotation: (
    documentId: string, annotationId: string, patch: AnnotationPatch
  ) => Promise<Annotation>;
  deleteAnnotation: (documentId: string, annotationId: string) => Promise<void>;
  addAnnotation: (documentId: string, input: NewAnnotation) => Promise<Annotation>;
  loadNextUnreviewed: (projectId: string) => Promise<{ id: string; filename: string } | null>;

  promptVersions: PromptVersion[];
  correctionStream: CorrectionStreamState;
  promptHistoryOpen: boolean;
  correctionConsoleOpen: boolean;
  loadPromptVersions: (projectId: string) => Promise<PromptVersion[]>;
  saveAsNewVersion: (projectId: string, prompt_text: string, summary: string) => Promise<PromptVersion>;
  deletePromptVersion: (projectId: string, versionId: string) => Promise<void>;
  setActivePrompt: (projectId: string, versionId: string | null) => Promise<{ id: string; active_prompt_version_id: string | null }>;
  streamCorrection: (
    projectId: string,
    documentId: string,
    body: {
      user_message: string;
      current_prompt: string;
      target_field?: string | null;
      processor_key_override?: string | null;
    },
  ) => Promise<void>;
  discardCorrection: () => void;
  setPromptHistoryOpen: (open: boolean) => void;
  setCorrectionConsoleOpen: (open: boolean) => void;

  runEvaluation: (projectId: string, name?: string) => Promise<EvaluationRun>;
  listEvaluations: (projectId: string) => Promise<EvaluationRun[]>;
  getEvaluationDetail: (runId: string) => Promise<{ run: EvaluationRun; fields: EvaluationFieldResult[] }>;
  deleteEvaluation: (runId: string) => Promise<void>;
  downloadEvaluationExcel: (runId: string) => Promise<void>;
}

export const usePredictStore = create<PredictState>((set, get) => ({
  loading: {},
  results: {},
  batchProgress: null,
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

  setSelectedAnnotationId: (id) => set({ selectedAnnotationId: id }),
  setStep: (step) => set({ currentStep: step }),
  setApiFormat: (f) => set({ apiFormat: f }),
  setProcessorOverride: (s) => set({ processorOverride: s }),
  setPromptOverride: (s) => set({ promptOverride: s }),

  predictSingle: async (projectId, documentId, opts) => {
    set((s) => ({ loading: { ...s.loading, [documentId]: true } }));
    try {
      const r = await api.post<ProcessingResult>(
        `/api/v1/projects/${projectId}/documents/${documentId}/predict`,
        {
          prompt_override: opts?.promptOverride,
          processor_key_override: opts?.processorKeyOverride,
        }
      );
      set((s) => ({
        results: { ...s.results, [documentId]: r.data },
        loading: { ...s.loading, [documentId]: false },
      }));
      return r.data;
    } catch (e) {
      set((s) => ({ loading: { ...s.loading, [documentId]: false } }));
      throw extractApiError(e);
    }
  },

  predictBatch: async (projectId, documentIds, opts) => {
    set({
      batchProgress: { total: documentIds.length, events: [], done: false, succeeded: 0, failed: 0 },
    });
    const token = getToken();
    const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";
    const url = `${baseUrl}/api/v1/projects/${projectId}/batch-predict`;
    const body = JSON.stringify({
      document_ids: documentIds,
      prompt_override: opts?.promptOverride,
      processor_key_override: opts?.processorKeyOverride,
    });
    type Evt = BatchEvent | { total: number; succeeded: number; failed: number };
    for await (const e of streamSse<Evt>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    })) {
      if (e.event === "predict_progress") {
        const evt = e.data as BatchEvent;
        set((s) => ({
          batchProgress: s.batchProgress
            ? { ...s.batchProgress, events: [...s.batchProgress.events, evt] }
            : s.batchProgress,
        }));
      } else if (e.event === "done") {
        const final = e.data as { total: number; succeeded: number; failed: number };
        set((s) => ({
          batchProgress: s.batchProgress
            ? { ...s.batchProgress, done: true, succeeded: final.succeeded, failed: final.failed }
            : s.batchProgress,
        }));
      }
    }
  },

  loadAnnotations: async (documentId) => {
    const r = await api.get<Annotation[]>(`/api/v1/documents/${documentId}/annotations`);
    return r.data;
  },

  patchAnnotation: async (documentId, annotationId, patch) => {
    const r = await api.patch<Annotation>(
      `/api/v1/documents/${documentId}/annotations/${annotationId}`,
      patch,
    );
    return r.data;
  },

  deleteAnnotation: async (documentId, annotationId) => {
    await api.delete(`/api/v1/documents/${documentId}/annotations/${annotationId}`);
  },

  addAnnotation: async (documentId, input) => {
    const r = await api.post<Annotation>(`/api/v1/documents/${documentId}/annotations`, input);
    return r.data;
  },

  loadNextUnreviewed: async (projectId) => {
    try {
      const r = await api.get<{ id: string; filename: string }>(
        `/api/v1/projects/${projectId}/documents/next-unreviewed`
      );
      return r.data;
    } catch (e) {
      const err = extractApiError(e);
      if (err.code === "no_unreviewed_documents") return null;
      throw err;
    }
  },

  loadPromptVersions: async (projectId) => {
    const r = await api.get<PromptVersion[]>(
      `/api/v1/projects/${projectId}/prompt-versions`
    );
    set({ promptVersions: r.data });
    return r.data;
  },

  saveAsNewVersion: async (projectId, prompt_text, summary) => {
    const r = await api.post<PromptVersion>(
      `/api/v1/projects/${projectId}/prompt-versions`,
      { prompt_text, summary },
    );
    return r.data;
  },

  deletePromptVersion: async (projectId, versionId) => {
    await api.delete(
      `/api/v1/projects/${projectId}/prompt-versions/${versionId}`
    );
  },

  setActivePrompt: async (projectId, versionId) => {
    const r = await api.patch<{ id: string; active_prompt_version_id: string | null }>(
      `/api/v1/projects/${projectId}/active-prompt`,
      { version_id: versionId },
    );
    return r.data;
  },

  streamCorrection: async (projectId, documentId, body) => {
    set({
      correctionStream: {
        active: true, promptTokens: [], revisedPrompt: null,
        previewResult: null, error: null,
      },
    });
    try {
      const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";
      const url = `${baseUrl}/api/v1/projects/${projectId}/documents/${documentId}/correct`;
      const { streamSse } = await import("../lib/sse");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      for await (const evt of streamSse<Record<string, unknown>>(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })) {
        const cs = get().correctionStream;
        if (evt.event === "prompt_token") {
          set({
            correctionStream: {
              ...cs,
              promptTokens: [...cs.promptTokens, (evt.data as { chunk: string }).chunk],
            },
          });
        } else if (evt.event === "revised_prompt") {
          set({
            correctionStream: {
              ...cs,
              revisedPrompt: (evt.data as { prompt_text: string }).prompt_text,
            },
          });
        } else if (evt.event === "predict_result") {
          set({
            correctionStream: {
              ...cs,
              previewResult: evt.data as CorrectionStreamState["previewResult"],
            },
          });
        } else if (evt.event === "error") {
          set({
            correctionStream: {
              ...cs,
              error: (evt.data as { message: string }).message,
              active: false,
            },
          });
          return;
        } else if (evt.event === "done") {
          set({ correctionStream: { ...get().correctionStream, active: false } });
          return;
        }
      }
    } catch (e) {
      const cs = get().correctionStream;
      set({
        correctionStream: {
          ...cs, active: false,
          error: (e as { message?: string }).message ?? "stream failed",
        },
      });
    }
  },

  discardCorrection: () => set({
    correctionStream: {
      active: false, promptTokens: [], revisedPrompt: null,
      previewResult: null, error: null,
    },
  }),

  setPromptHistoryOpen: (open) => set({ promptHistoryOpen: open }),
  setCorrectionConsoleOpen: (open) => set({ correctionConsoleOpen: open }),

  runEvaluation: async (projectId, name = "") => {
    const r = await api.post<EvaluationRun>(
      `/api/v1/projects/${projectId}/evaluations`,
      { name },
    );
    return r.data;
  },

  listEvaluations: async (projectId) => {
    const r = await api.get<EvaluationRun[]>(
      `/api/v1/projects/${projectId}/evaluations`,
    );
    return r.data;
  },

  getEvaluationDetail: async (runId) => {
    const r = await api.get<{ run: EvaluationRun; fields: EvaluationFieldResult[] }>(
      `/api/v1/evaluations/${runId}`,
    );
    return r.data;
  },

  deleteEvaluation: async (runId) => {
    await api.delete(`/api/v1/evaluations/${runId}`);
  },

  downloadEvaluationExcel: async (runId) => {
    const r = await api.get<Blob>(
      `/api/v1/evaluations/${runId}/excel`,
      { responseType: "blob" },
    );
    const url = URL.createObjectURL(r.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evaluation-${runId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
}));

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
}

export const usePredictStore = create<PredictState>((set, get) => ({
  loading: {},
  results: {},
  batchProgress: null,

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
}));

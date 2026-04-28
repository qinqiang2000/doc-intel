import { create } from "zustand";
import { api, extractApiError } from "../lib/api-client";

export interface Template {
  key: string;
  display_name: string;
  description: string;
  expected_fields: string[];
  recommended_processor: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  template_key: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProjectCreateInput {
  name: string;
  slug: string;
  description?: string;
  template_key: string;
}

interface ProjectState {
  projects: Project[];
  templates: Template[];
  loading: boolean;
  error: string | null;

  loadProjects: (workspaceId: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  createProject: (workspaceId: string, input: ProjectCreateInput) => Promise<Project>;
  deleteProject: (workspaceId: string, projectId: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  templates: [],
  loading: false,
  error: null,

  loadProjects: async (workspaceId) => {
    set({ loading: true, error: null });
    try {
      const r = await api.get<Project[]>(`/api/v1/workspaces/${workspaceId}/projects`);
      set({ projects: r.data, loading: false });
    } catch (e) {
      set({ error: extractApiError(e).message, loading: false });
    }
  },

  loadTemplates: async () => {
    if (get().templates.length > 0) return;
    try {
      const r = await api.get<Template[]>("/api/v1/templates");
      set({ templates: r.data });
    } catch (e) {
      set({ error: extractApiError(e).message });
    }
  },

  createProject: async (workspaceId, input) => {
    try {
      const r = await api.post<Project>(`/api/v1/workspaces/${workspaceId}/projects`, input);
      set((s) => ({ projects: [r.data, ...s.projects] }));
      return r.data;
    } catch (e) {
      throw extractApiError(e);
    }
  },

  deleteProject: async (workspaceId, projectId) => {
    await api.delete(`/api/v1/workspaces/${workspaceId}/projects/${projectId}`);
    set((s) => ({ projects: s.projects.filter((p) => p.id !== projectId) }));
  },
}));

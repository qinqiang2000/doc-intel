import { create } from "zustand";
import { api, extractApiError } from "../lib/api-client";
import {
  clearToken,
  getCurrentWorkspaceId,
  getToken,
  setCurrentWorkspaceId,
  setToken,
} from "../lib/auth-storage";

export interface User {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
}

export interface WorkspaceWithRole {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "member";
}

export interface WorkspaceCreateInput {
  name: string;
  slug: string;
  description?: string;
}

interface AuthState {
  token: string | null;
  user: User | null;
  workspaces: WorkspaceWithRole[];
  currentWorkspaceId: string | null;
  loading: boolean;
  error: string | null;
  meLoaded: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
  switchWorkspaceById: (workspaceId: string) => void;
  switchWorkspaceBySlug: (slug: string) => void;
  createWorkspace: (input: WorkspaceCreateInput) => Promise<WorkspaceWithRole>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: getToken(),
  user: null,
  workspaces: [],
  currentWorkspaceId: getCurrentWorkspaceId(),
  loading: false,
  error: null,
  meLoaded: false,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.post("/api/v1/auth/login", { email, password });
      setToken(resp.data.token);
      set({
        token: resp.data.token,
        user: resp.data.user,
        loading: false,
      });
      await get().refreshMe();
    } catch (e) {
      const err = extractApiError(e);
      set({ loading: false, error: err.message });
      throw err;
    }
  },

  register: async (email, password, displayName) => {
    set({ loading: true, error: null });
    try {
      const resp = await api.post("/api/v1/auth/register", {
        email,
        password,
        display_name: displayName,
      });
      setToken(resp.data.token);
      set({
        token: resp.data.token,
        user: resp.data.user,
        loading: false,
      });
      await get().refreshMe();
    } catch (e) {
      const err = extractApiError(e);
      set({ loading: false, error: err.message });
      throw err;
    }
  },

  logout: () => {
    clearToken();
    set({
      token: null,
      user: null,
      workspaces: [],
      currentWorkspaceId: null,
      meLoaded: false,
    });
  },

  refreshMe: async () => {
    if (!get().token) return;
    try {
      const resp = await api.get("/api/v1/auth/me");
      const workspaces: WorkspaceWithRole[] = resp.data.workspaces;
      let current = get().currentWorkspaceId;
      if (current && !workspaces.find((w) => w.id === current)) {
        current = null;
      }
      if (!current && workspaces.length > 0) {
        current = workspaces[0].id;
      }
      setCurrentWorkspaceId(current);
      set({
        user: resp.data.user,
        workspaces,
        currentWorkspaceId: current,
      });
    } catch (e) {
      const err = extractApiError(e);
      if (err.code !== "network_error") {
        get().logout();
      }
    } finally {
      set({ meLoaded: true });
    }
  },

  switchWorkspaceById: (workspaceId) => {
    setCurrentWorkspaceId(workspaceId);
    set({ currentWorkspaceId: workspaceId });
  },

  switchWorkspaceBySlug: (slug) => {
    const ws = get().workspaces.find((w) => w.slug === slug);
    if (ws) {
      setCurrentWorkspaceId(ws.id);
      set({ currentWorkspaceId: ws.id });
    }
  },

  createWorkspace: async (input) => {
    const resp = await api.post("/api/v1/workspaces", input);
    const ws: WorkspaceWithRole = {
      id: resp.data.id,
      name: resp.data.name,
      slug: resp.data.slug,
      role: "owner",
    };
    setCurrentWorkspaceId(ws.id);
    set((s) => ({
      workspaces: [...s.workspaces, ws],
      currentWorkspaceId: ws.id,
    }));
    return ws;
  },
}));

import { afterEach, describe, expect, it } from "vitest";
import {
  clearToken,
  getCurrentWorkspaceId,
  getToken,
  setCurrentWorkspaceId,
  setToken,
} from "../auth-storage";

afterEach(() => {
  localStorage.clear();
});

describe("auth-storage", () => {
  describe("token", () => {
    it("returns null when no token is stored", () => {
      expect(getToken()).toBeNull();
    });

    it("persists and retrieves a token", () => {
      setToken("abc.def.ghi");
      expect(getToken()).toBe("abc.def.ghi");
    });

    it("clearToken removes both token and workspace id", () => {
      setToken("t");
      setCurrentWorkspaceId("ws-1");
      clearToken();
      expect(getToken()).toBeNull();
      expect(getCurrentWorkspaceId()).toBeNull();
    });
  });

  describe("currentWorkspaceId", () => {
    it("returns null when nothing stored", () => {
      expect(getCurrentWorkspaceId()).toBeNull();
    });

    it("setCurrentWorkspaceId(id) stores and getCurrentWorkspaceId returns it", () => {
      setCurrentWorkspaceId("ws-42");
      expect(getCurrentWorkspaceId()).toBe("ws-42");
    });

    it("setCurrentWorkspaceId(null) removes the entry", () => {
      setCurrentWorkspaceId("ws-42");
      setCurrentWorkspaceId(null);
      expect(getCurrentWorkspaceId()).toBeNull();
    });
  });
});

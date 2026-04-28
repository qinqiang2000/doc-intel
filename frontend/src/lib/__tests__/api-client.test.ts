import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, extractApiError } from "../api-client";
import { setToken } from "../auth-storage";

let mock: MockAdapter;

beforeEach(() => {
  localStorage.clear();
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

describe("api-client", () => {
  describe("Bearer interceptor", () => {
    it("does not set Authorization header when no token is stored", async () => {
      mock.onGet("/api/v1/probe").reply(200, { ok: true });

      await api.get("/api/v1/probe");
      const last = mock.history.get[0];
      expect(last.headers?.Authorization).toBeUndefined();
    });

    it("sets Authorization: Bearer <token> when token is stored", async () => {
      setToken("xyz");
      mock.onGet("/api/v1/probe").reply(200, { ok: true });

      await api.get("/api/v1/probe");
      const last = mock.history.get[0];
      expect(last.headers?.Authorization).toBe("Bearer xyz");
    });
  });

  describe("401 response handling", () => {
    it("clears token and redirects on 401 (non-auth endpoint)", async () => {
      setToken("expired");
      mock.onGet("/api/v1/me").reply(401, {
        error: { code: "unauthorized", message: "expired" },
      });

      const assignSpy = vi
        .spyOn(window.location, "assign")
        .mockImplementation(() => {});
      // pretend we're on /dashboard so the interceptor redirects
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, pathname: "/dashboard", assign: assignSpy },
      });

      await expect(api.get("/api/v1/me")).rejects.toThrow();
      expect(localStorage.getItem("doc-intel.token")).toBeNull();
    });

    it("does NOT redirect when 401 comes from /auth/login (avoid loop)", async () => {
      setToken("any");
      mock.onPost("/api/v1/auth/login").reply(401, {
        error: { code: "invalid_credentials", message: "wrong" },
      });

      const assignSpy = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, pathname: "/login", assign: assignSpy },
      });

      await expect(
        api.post("/api/v1/auth/login", { email: "x", password: "y" })
      ).rejects.toThrow();
      expect(assignSpy).not.toHaveBeenCalled();
    });
  });

  describe("extractApiError", () => {
    it("returns the {code, message} from a structured API error", async () => {
      mock.onGet("/api/v1/x").reply(409, {
        error: { code: "email_already_registered", message: "Email exists" },
      });
      try {
        await api.get("/api/v1/x");
        throw new Error("expected reject");
      } catch (e) {
        const err = extractApiError(e);
        expect(err.code).toBe("email_already_registered");
        expect(err.message).toBe("Email exists");
      }
    });

    it("returns network_error code on non-axios errors", () => {
      const err = extractApiError("plain string");
      expect(err.code).toBe("unknown");
    });
  });
});

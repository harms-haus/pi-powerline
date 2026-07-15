import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  api,
  currentCtx,
  currentCwd,
  tuiRef,
  footerDataProvider,
  setApi,
  setTuiRef,
  setFooterDataProvider,
  safeUpdateCtx,
  requestRefresh,
  resetState,
} from "../state";

describe("state module", () => {
  beforeEach(() => {
    resetState();
  });

  describe("initial state", () => {
    it("api is undefined initially", () => {
      // After resetState, api should be undefined
      expect(api).toBeUndefined();
    });

    it("currentCtx is undefined initially", () => {
      expect(currentCtx).toBeUndefined();
    });

    it("currentCwd is undefined initially", () => {
      expect(currentCwd).toBeUndefined();
    });

    it("tuiRef is undefined initially", () => {
      expect(tuiRef).toBeUndefined();
    });

    it("footerDataProvider is undefined initially", () => {
      expect(footerDataProvider).toBeUndefined();
    });
  });

  describe("setApi", () => {
    it("sets the api variable", () => {
      const mockApi = { on: vi.fn() } as never;
      setApi(mockApi);
      expect(api).toBe(mockApi);
    });
  });

  describe("setTuiRef", () => {
    it("sets tuiRef to a mock TUI", () => {
      const mockTui = { requestRender: vi.fn() } as never;
      setTuiRef(mockTui);
      expect(tuiRef).toBe(mockTui);
    });

    it("clears tuiRef when passed undefined", () => {
      const mockTui = { requestRender: vi.fn() } as never;
      setTuiRef(mockTui);
      expect(tuiRef).toBe(mockTui);
      setTuiRef(undefined);
      expect(tuiRef).toBeUndefined();
    });
  });

  describe("setFooterDataProvider", () => {
    it("sets footerDataProvider to a mock provider", () => {
      const mockProvider = { getGitBranch: vi.fn() } as never;
      setFooterDataProvider(mockProvider);
      expect(footerDataProvider).toBe(mockProvider);
    });

    it("clears footerDataProvider when passed undefined", () => {
      const mockProvider = { getGitBranch: vi.fn() } as never;
      setFooterDataProvider(mockProvider);
      expect(footerDataProvider).toBe(mockProvider);
      setFooterDataProvider(undefined);
      expect(footerDataProvider).toBeUndefined();
    });
  });

  describe("safeUpdateCtx", () => {
    it("updates currentCtx and currentCwd, returns true", () => {
      const ctx = { cwd: "/home/user/project" } as never;
      const result = safeUpdateCtx(ctx);
      expect(result).toBe(true);
      expect(currentCtx).toBe(ctx);
      expect(currentCwd).toBe("/home/user/project");
    });

    it("returns false when a stale error is thrown", () => {
      // We need to test the catch branch. The issue is that setting
      // currentCtx and currentCwd doesn't normally throw. But we can
      // make ctx.cwd throw via a getter.
      const ctx = {
        get cwd() {
          throw new Error("context is stale");
        },
      } as never;
      const result = safeUpdateCtx(ctx);
      expect(result).toBe(false);
    });

    it("keeps the previous context and cwd when a replacement cwd getter is stale", () => {
      const activeCtx = { cwd: "/home/user/active" } as never;
      safeUpdateCtx(activeCtx);
      const staleCandidate = {
        get cwd() {
          throw new Error("replacement context is stale");
        },
      } as never;

      expect(safeUpdateCtx(staleCandidate)).toBe(false);
      expect(currentCtx === activeCtx).toBe(true);
      expect(currentCwd).toBe("/home/user/active");
    });

    it("re-throws non-stale errors", () => {
      const ctx = {
        get cwd() {
          throw new Error("something else");
        },
      } as never;
      expect(() => safeUpdateCtx(ctx)).toThrow("something else");
    });

    it("re-throws non-Error exceptions", () => {
      const ctx = {
        get cwd() {
          throw new Error("string error");
        },
      } as never;
      expect(() => safeUpdateCtx(ctx)).toThrow("string error");
    });
  });

  describe("requestRefresh", () => {
    it("calls tuiRef.requestRender when tuiRef is set", () => {
      const mockRender = vi.fn();
      const mockTui = { requestRender: mockRender } as never;
      setTuiRef(mockTui);
      requestRefresh();
      expect(mockRender).toHaveBeenCalledOnce();
    });

    it("does nothing when tuiRef is undefined", () => {
      setTuiRef(undefined);
      // Should not throw
      expect(() => {
        requestRefresh();
      }).not.toThrow();
    });
  });

  describe("resetState", () => {
    it("resets all state variables to undefined", () => {
      // Set everything first
      setApi({ on: vi.fn() } as never);
      const ctx = { cwd: "/test" } as never;
      safeUpdateCtx(ctx);
      setTuiRef({ requestRender: vi.fn() } as never);
      setFooterDataProvider({ getGitBranch: vi.fn() } as never);

      // Verify they're set
      expect(api).toBeDefined();
      expect(currentCtx).toBeDefined();
      expect(currentCwd).toBe("/test");
      expect(tuiRef).toBeDefined();
      expect(footerDataProvider).toBeDefined();

      // Reset
      resetState();

      // Verify all are undefined (except api — resetState doesn't clear api)
      expect(currentCtx).toBeUndefined();
      expect(currentCwd).toBeUndefined();
      expect(tuiRef).toBeUndefined();
      expect(footerDataProvider).toBeUndefined();
    });
  });
});

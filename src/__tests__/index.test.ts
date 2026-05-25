import { describe, it, expect, beforeEach, vi } from "vitest";

// Collect event handlers registered by the extension
let handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {};

// Mock state module
const mockSetApi = vi.fn();
const mockSetTuiRef = vi.fn();
const mockSetFooterDataProvider = vi.fn();
const mockSafeUpdateCtx = vi.fn();
const mockRequestRefresh = vi.fn();
const mockResetState = vi.fn();

vi.mock("../state", () => ({
  setApi: (...args: unknown[]) => mockSetApi(...args),
  setTuiRef: (...args: unknown[]) => mockSetTuiRef(...args),
  setFooterDataProvider: (...args: unknown[]) => mockSetFooterDataProvider(...args),
  safeUpdateCtx: (...args: unknown[]) => mockSafeUpdateCtx(...args),
  requestRefresh: (...args: unknown[]) => mockRequestRefresh(...args),
  resetState: (...args: unknown[]) => mockResetState(...args),
}));

// Mock git module
const mockRefreshGitDiff = vi.fn();
const mockDebouncedRefreshGitDiff = vi.fn();
const mockClearGitTimer = vi.fn();

vi.mock("../git", () => ({
  refreshGitDiff: (...args: unknown[]) => mockRefreshGitDiff(...args),
  debouncedRefreshGitDiff: (...args: unknown[]) => mockDebouncedRefreshGitDiff(...args),
  clearGitTimer: (...args: unknown[]) => mockClearGitTimer(...args),
}));

// Mock footer and above-widget
vi.mock("../footer", () => ({
  renderFooterLine: vi.fn(() => ["line"]),
}));

vi.mock("../above-widget", () => ({
  renderAboveWidget: vi.fn(() => []),
}));

// Mock pi-coding-agent type guards
vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@earendil-works/pi-coding-agent");
  return {
    ...actual,
    isBashToolResult: (e: { toolName: string }) => e.toolName === "bash",
    isEditToolResult: (e: { toolName: string }) => e.toolName === "edit",
    isWriteToolResult: (e: { toolName: string }) => e.toolName === "write",
  };
});

// Import after mocks are set up
const extensionDefault = (await import("../index")).default;

function createMockPi(): {
  on: ReturnType<typeof vi.fn>;
} {
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
  };
}

function getHandler(name: string): (...args: unknown[]) => void {
  const h = handlers[name];
  if (!h) throw new Error(`Handler "${name}" not registered`);
  return h;
}

interface MockUI {
  setFooter: ReturnType<typeof vi.fn>;
  setWidget: ReturnType<typeof vi.fn>;
}

function createMockCtx(hasUI = false): Record<string, unknown> & { ui?: MockUI } {
  const ui: MockUI = {
    setFooter: vi.fn((factory: (tui: unknown, theme: unknown, data: unknown) => unknown) => {
      const mockTui = { requestRender: vi.fn() };
      const mockTheme = { fg: vi.fn((_c: string, t: string) => t) };
      const mockFooterData = {
        onBranchChange: vi.fn(() => vi.fn()),
      };
      factory(mockTui, mockTheme, mockFooterData);
    }),
    setWidget: vi.fn(),
  };
  return {
    cwd: "/home/user/project",
    hasUI,
    ui: hasUI ? ui : undefined,
    model: { id: "test-model", provider: "test", contextWindow: 128000, reasoning: false },
    modelRegistry: { getProviderDisplayName: vi.fn((p: string) => p) },
    getContextUsage: vi.fn(() => ({
      tokens: 1000,
      contextWindow: 128000,
      percent: 0.8,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSafeUpdateCtx.mockReturnValue(true);
  handlers = {};
});

describe("extension entry point", () => {
  it("calls setApi with the provided pi", () => {
    const pi = createMockPi();
    extensionDefault(pi as never);
    expect(mockSetApi).toHaveBeenCalledWith(pi);
  });

  it("registers handlers for all event types", () => {
    const pi = createMockPi();
    extensionDefault(pi as never);

    const events = pi.on.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(events).toContain("session_start");
    expect(events).toContain("session_tree");
    expect(events).toContain("session_shutdown");
    expect(events).toContain("turn_end");
    expect(events).toContain("model_select");
    expect(events).toContain("thinking_level_select");
    expect(events).toContain("tool_result");
    expect(events).toContain("message_end");
  });

  describe("session_start handler", () => {
    it("calls setApi, clearGitTimer, setupUI, and refreshGitDiff", () => {
      const pi = createMockPi();
      const ctx = createMockCtx(true);
      extensionDefault(pi as never);

      expect(mockSetApi).toHaveBeenCalledWith(pi);

      getHandler("session_start")({}, ctx);

      expect(mockSafeUpdateCtx).toHaveBeenCalledWith(ctx);
      expect(mockClearGitTimer).toHaveBeenCalled();
      expect(mockRefreshGitDiff).toHaveBeenCalled();
    });

    it("skips setupUI when safeUpdateCtx returns false (stale)", () => {
      const pi = createMockPi();
      const ctx = createMockCtx(true);
      mockSafeUpdateCtx.mockReturnValue(false);
      extensionDefault(pi as never);

      getHandler("session_start")({}, ctx);

      expect(mockClearGitTimer).not.toHaveBeenCalled();
      expect(mockRefreshGitDiff).not.toHaveBeenCalled();
    });

    it("sets up footer and widget when ctx.hasUI is true", () => {
      const pi = createMockPi();
      const ctx = createMockCtx(true);
      extensionDefault(pi as never);

      getHandler("session_start")({}, ctx);

      expect(ctx.ui!.setFooter).toHaveBeenCalled();
      expect(ctx.ui!.setWidget).toHaveBeenCalledWith("powerline-above", expect.any(Function), {
        placement: "aboveEditor",
      });
    });

    it("does not set up UI when ctx.hasUI is false", () => {
      const pi = createMockPi();
      const ctx = createMockCtx(false);
      extensionDefault(pi as never);

      getHandler("session_start")({}, ctx);

      // ui is undefined, so setFooter/setWidget won't be called
      expect(ctx.ui).toBeUndefined();
    });
  });

  describe("session_tree handler", () => {
    it("calls clearGitTimer and refreshGitDiff on session_tree", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      getHandler("session_tree")({}, ctx);

      expect(mockSafeUpdateCtx).toHaveBeenCalledWith(ctx);
      expect(mockClearGitTimer).toHaveBeenCalled();
      expect(mockRefreshGitDiff).toHaveBeenCalled();
    });

    it("skips when safeUpdateCtx returns false", () => {
      const pi = createMockPi();
      mockSafeUpdateCtx.mockReturnValue(false);
      extensionDefault(pi as never);

      getHandler("session_tree")({}, {});

      expect(mockClearGitTimer).not.toHaveBeenCalled();
    });
  });

  describe("session_shutdown handler", () => {
    it("calls cleanup (clearGitTimer + resetState)", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      getHandler("session_shutdown")();

      expect(mockClearGitTimer).toHaveBeenCalled();
      expect(mockResetState).toHaveBeenCalled();
    });
  });

  describe("turn_end handler", () => {
    it("calls debouncedRefreshGitDiff", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      getHandler("turn_end")({}, ctx);

      expect(mockSafeUpdateCtx).toHaveBeenCalledWith(ctx);
      expect(mockDebouncedRefreshGitDiff).toHaveBeenCalled();
    });

    it("skips when safeUpdateCtx returns false", () => {
      const pi = createMockPi();
      mockSafeUpdateCtx.mockReturnValue(false);
      extensionDefault(pi as never);

      getHandler("turn_end")({}, {});

      expect(mockDebouncedRefreshGitDiff).not.toHaveBeenCalled();
    });
  });

  describe("model_select handler", () => {
    it("calls requestRefresh", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      getHandler("model_select")({}, ctx);

      expect(mockSafeUpdateCtx).toHaveBeenCalledWith(ctx);
      expect(mockRequestRefresh).toHaveBeenCalled();
    });

    it("skips when safeUpdateCtx returns false", () => {
      const pi = createMockPi();
      mockSafeUpdateCtx.mockReturnValue(false);
      extensionDefault(pi as never);

      getHandler("model_select")({}, {});

      expect(mockRequestRefresh).not.toHaveBeenCalled();
    });
  });

  describe("thinking_level_select handler", () => {
    it("calls requestRefresh", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      getHandler("thinking_level_select")({}, ctx);

      expect(mockSafeUpdateCtx).toHaveBeenCalledWith(ctx);
      expect(mockRequestRefresh).toHaveBeenCalled();
    });

    it("skips when safeUpdateCtx returns false", () => {
      const pi = createMockPi();
      mockSafeUpdateCtx.mockReturnValue(false);
      extensionDefault(pi as never);

      getHandler("thinking_level_select")({}, {});

      expect(mockRequestRefresh).not.toHaveBeenCalled();
    });
  });

  describe("tool_result handler", () => {
    it("calls debouncedRefreshGitDiff for write tool results", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      const event = { toolName: "write" };
      getHandler("tool_result")(event, ctx);

      expect(mockSafeUpdateCtx).toHaveBeenCalledWith(ctx);
      expect(mockDebouncedRefreshGitDiff).toHaveBeenCalled();
    });

    it("calls debouncedRefreshGitDiff for edit tool results", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      const event = { toolName: "edit" };
      getHandler("tool_result")(event, ctx);

      expect(mockDebouncedRefreshGitDiff).toHaveBeenCalled();
    });

    it("calls debouncedRefreshGitDiff for bash tool results", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      const event = { toolName: "bash" };
      getHandler("tool_result")(event, ctx);

      expect(mockDebouncedRefreshGitDiff).toHaveBeenCalled();
    });

    it("does NOT call debouncedRefreshGitDiff for other tool results", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      const event = { toolName: "read" };
      getHandler("tool_result")(event, ctx);

      expect(mockDebouncedRefreshGitDiff).not.toHaveBeenCalled();
    });

    it("skips when safeUpdateCtx returns false", () => {
      const pi = createMockPi();
      mockSafeUpdateCtx.mockReturnValue(false);
      extensionDefault(pi as never);

      const event = { toolName: "write" };
      getHandler("tool_result")(event, {});

      expect(mockDebouncedRefreshGitDiff).not.toHaveBeenCalled();
    });
  });

  describe("message_end handler", () => {
    it("calls requestRefresh", () => {
      const pi = createMockPi();
      extensionDefault(pi as never);

      const ctx = createMockCtx();
      getHandler("message_end")({}, ctx);

      expect(mockSafeUpdateCtx).toHaveBeenCalledWith(ctx);
      expect(mockRequestRefresh).toHaveBeenCalled();
    });

    it("skips when safeUpdateCtx returns false", () => {
      const pi = createMockPi();
      mockSafeUpdateCtx.mockReturnValue(false);
      extensionDefault(pi as never);

      getHandler("message_end")({}, {});

      expect(mockRequestRefresh).not.toHaveBeenCalled();
    });
  });

  describe("footer lifecycle", () => {
    it("footer dispose clears git timer", () => {
      const pi = createMockPi();
      const ctx = createMockCtx(true);
      extensionDefault(pi as never);

      getHandler("session_start")({}, ctx);

      const footerFactory = ctx.ui!.setFooter.mock.calls[0]![0] as (
        tui: unknown,
        theme: unknown,
        footerData: unknown,
      ) => { dispose: () => void; invalidate: () => void; render: (w: number) => string[] };
      const mockTui = { requestRender: vi.fn() };
      const mockTheme = { fg: vi.fn((_c: string, t: string) => t) };
      const unsubFn = vi.fn();
      const mockFooterData = { onBranchChange: vi.fn(() => unsubFn) };

      const result = footerFactory(mockTui, mockTheme, mockFooterData);

      result.dispose();

      expect(unsubFn).toHaveBeenCalled();
      expect(mockClearGitTimer).toHaveBeenCalled();
    });

    it("footer render calls renderFooterLine", async () => {
      const { renderFooterLine } = await import("../footer");
      (renderFooterLine as ReturnType<typeof vi.fn>).mockReturnValue(["test-line"]);

      const pi = createMockPi();
      const ctx = createMockCtx(true);
      extensionDefault(pi as never);

      getHandler("session_start")({}, ctx);

      const footerFactory = ctx.ui!.setFooter.mock.calls[0]![0] as (
        tui: unknown,
        theme: unknown,
        footerData: unknown,
      ) => { dispose: () => void; invalidate: () => void; render: (w: number) => string[] };
      const mockTui = { requestRender: vi.fn() };
      const mockTheme = { fg: vi.fn((_c: string, t: string) => t) };
      const unsubFn = vi.fn();
      const mockFooterData = { onBranchChange: vi.fn(() => unsubFn) };

      const result = footerFactory(mockTui, mockTheme, mockFooterData);

      const lines = result.render(80);
      expect(renderFooterLine).toHaveBeenCalledWith(80, mockTheme);
      expect(lines).toEqual(["test-line"]);
    });

    it("footer onBranchChange triggers requestRender", () => {
      const pi = createMockPi();
      const ctx = createMockCtx(true);
      extensionDefault(pi as never);

      getHandler("session_start")({}, ctx);

      const footerFactory = ctx.ui!.setFooter.mock.calls[0]![0];
      const mockTui = { requestRender: vi.fn() };
      const mockTheme = { fg: vi.fn((_c: string, t: string) => t) };
      let capturedBranchHandler: (() => void) | undefined;
      const mockFooterData = {
        onBranchChange: vi.fn((handler: () => void) => {
          capturedBranchHandler = handler;
          return vi.fn();
        }),
      };

      footerFactory(mockTui, mockTheme, mockFooterData);

      expect(capturedBranchHandler).toBeDefined();
      capturedBranchHandler!();
      expect(mockTui.requestRender).toHaveBeenCalled();
    });

    it("widget render calls renderAboveWidget", async () => {
      const { renderAboveWidget } = await import("../above-widget");
      (renderAboveWidget as ReturnType<typeof vi.fn>).mockReturnValue(["widget-line"]);

      const pi = createMockPi();
      const ctx = createMockCtx(true);
      extensionDefault(pi as never);

      getHandler("session_start")({}, ctx);

      const widgetFactory = ctx.ui!.setWidget.mock.calls[0]![1] as (
        tui: unknown,
        theme: unknown,
      ) => { dispose: () => void; invalidate: () => void; render: (w: number) => string[] };
      const mockTheme = { fg: vi.fn((_c: string, t: string) => t) };

      const result = widgetFactory({}, mockTheme);
      const lines = result.render(80);

      expect(renderAboveWidget).toHaveBeenCalledWith(80, mockTheme);
      expect(lines).toEqual(["widget-line"]);
    });
  });
});

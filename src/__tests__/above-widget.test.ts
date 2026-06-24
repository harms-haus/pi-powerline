import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mutable backing for the mock — tests update this before importing above-widget
let mockGetExtensionStatuses: (() => Map<string, string>) | null = null;

vi.mock("../state", () => ({
  footerDataProvider: {
    get getExtensionStatuses() {
      return mockGetExtensionStatuses;
    },
  },
}));

// Dynamic import so the mock is applied before the module is evaluated
const { renderAboveWidget } = vi.mocked(await import("../above-widget"));

import { mockTheme } from "./test-utils.js";

describe("renderAboveWidget", () => {
  beforeEach(() => {
    mockGetExtensionStatuses = null;
  });

  afterEach(() => {
    mockGetExtensionStatuses = null;
  });

  it("returns [] when there are no statuses", () => {
    mockGetExtensionStatuses = () => new Map();
    const result = renderAboveWidget(80, mockTheme);
    expect(result).toEqual([]);
  });

  it("returns [] when there are no relevant statuses", () => {
    mockGetExtensionStatuses = () => new Map<string, string>([["some-other-key", "some value"]]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result).toEqual([]);
  });

  it("returns [line] for only a todo status (til-done)", () => {
    mockGetExtensionStatuses = () => new Map<string, string>([["til-done", "3 / 10"]]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("3 / 10");
  });

  it("returns multiple lines for active items with newlines", () => {
    mockGetExtensionStatuses = () =>
      new Map<string, string>([["til-done-active", "fix login\ndeploy to staging"]]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(2);
    expect(result[0]).toContain("fix login");
    expect(result[1]).toContain("deploy to staging");
  });

  it("returns [line] for only a workflow status", () => {
    mockGetExtensionStatuses = () => new Map<string, string>([["workflow", "PR #42"]]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("PR #42");
  });

  it("returns [line] with both todo and workflow when both are present", () => {
    mockGetExtensionStatuses = () =>
      new Map<string, string>([
        ["til-done", "3 / 10"],
        ["workflow", "PR #42"],
      ]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("3 / 10");
    expect(result[0]).toContain("PR #42");
  });

  it("gives workflow priority over rpir when both are present", () => {
    mockGetExtensionStatuses = () =>
      new Map<string, string>([
        ["workflow", "PR #42"],
        ["rpir-workflow", "RPIR-7"],
      ]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("PR #42");
    expect(result[0]).not.toContain("RPIR-7");
  });

  it("truncates output when width is very narrow", () => {
    mockGetExtensionStatuses = () =>
      new Map<string, string>([["til-done-active", "this is a very long active item"]]);
    const result = renderAboveWidget(4, mockTheme);
    expect(result.length).toBe(1);
    // truncateToWidth limits visible width; with mock theme wrapping, total length may
    // exceed width but visible portion is truncated
    expect(result[0]!.length).toBeLessThan(30);
  });

  it("shows overflow indicator when items exceed MAX_ACTIVE_ITEMS", () => {
    // Create 13 items — should show 10 + overflow indicator
    const items = Array.from({ length: 13 }, (_, i) => `item ${i + 1}`).join("\n");
    mockGetExtensionStatuses = () => new Map<string, string>([["til-done-active", items]]);
    const result = renderAboveWidget(80, mockTheme);
    // 10 display items + 1 overflow line
    expect(result.length).toBe(11);
    // Last line should be the overflow indicator
    expect(result[10]).toBe("[dim]... +3 more");
    // First 10 lines should contain the items
    for (let i = 0; i < 10; i++) {
      expect(result[i]).toContain(`item ${i + 1}`);
    }
  });

  it("renders RPIR-only status right-aligned", () => {
    mockGetExtensionStatuses = () => new Map<string, string>([["rpir-workflow", "RPIR-7"]]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("RPIR-7");
    // RPIR is right-aligned: line should start with spaces
    const stripped = result[0]!.replace(
      /\[dim\]|\[accent\]|\[warning\]|\[success\]|\[error\]|\[muted\]/g,
      "",
    );
    // Should be right-aligned (starts with spaces before the content)
    expect(stripped.startsWith(" ")).toBe(true);
  });

  it("returns [] when getExtensionStatuses throws", () => {
    mockGetExtensionStatuses = () => {
      throw new Error("test error");
    };
    const result = renderAboveWidget(80, mockTheme);
    expect(result).toEqual([]);
  });

  it("returns [] when footerDataProvider is null", () => {
    mockGetExtensionStatuses = null;
    const result = renderAboveWidget(80, mockTheme);
    expect(result).toEqual([]);
  });
});

describe("renderAboveWidget — kanban", () => {
  beforeEach(() => {
    mockGetExtensionStatuses = null;
  });

  afterEach(() => {
    mockGetExtensionStatuses = null;
  });

  function kanbanPayload(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      total: 8,
      claimed: 1,
      ready: 0,
      blocked: 0,
      done: 7,
      claimedTasks: [{ id: "kb-3", title: "Fix bug", phase: "implement" }],
      ...overrides,
    });
  }

  it("renders summary line and claimed task lines for kanban-only status", () => {
    mockGetExtensionStatuses = () => new Map<string, string>([["kanban", kanbanPayload()]]);
    const result = renderAboveWidget(80, mockTheme);
    // Should have 1 claimed task line + 1 summary line = 2 lines
    expect(result.length).toBe(2);
    // Task line contains phase icon, id, title
    expect(result[0]).toContain("kb-3");
    expect(result[0]).toContain("Fix bug");
    expect(result[0]).toContain("⚙️");
    // Summary line contains progress
    expect(result[1]).toContain("7/8");
    expect(result[1]).toContain("claimed");
  });

  it("renders only summary line when 0 claimed tasks", () => {
    mockGetExtensionStatuses = () =>
      new Map<string, string>([["kanban", kanbanPayload({ claimed: 0, claimedTasks: [] })]]);
    const result = renderAboveWidget(80, mockTheme);
    // Only summary line, no claimed task lines
    expect(result.length).toBe(1);
    expect(result[0]).toContain("7/8");
    // claimed=0 → should not appear in summary (only non-zero counts shown)
    expect(result[0]).not.toContain("claimed");
  });

  it("renders nothing for kanban when all tasks are done", () => {
    mockGetExtensionStatuses = () =>
      new Map<string, string>([
        ["kanban", kanbanPayload({ done: 8, total: 8, claimed: 0, claimedTasks: [] })],
      ]);
    const result = renderAboveWidget(80, mockTheme);
    // All done — nothing rendered
    expect(result).toEqual([]);
  });

  it("renders kanban, active items, and progress in correct vertical order", () => {
    mockGetExtensionStatuses = () =>
      new Map<string, string>([
        ["til-done-active", "fix login"],
        ["til-done", "3 / 10"],
        ["workflow", "PR #42"],
        ["kanban", kanbanPayload()],
      ]);
    const result = renderAboveWidget(80, mockTheme);
    // Expected order (top to bottom):
    // 1. Active item
    // 2. Kanban claimed task
    // 3. Progress line (til-done + workflow)
    // 4. Kanban summary
    expect(result.length).toBe(4);
    expect(result[0]).toContain("fix login"); // Active item
    expect(result[1]).toContain("kb-3"); // Kanban claimed task
    expect(result[2]).toContain("3 / 10"); // Progress line
    expect(result[2]).toContain("PR #42");
    expect(result[3]).toContain("7/8"); // Kanban summary
  });

  it("gracefully skips kanban when JSON is invalid", () => {
    mockGetExtensionStatuses = () => new Map<string, string>([["kanban", "not valid json{"]]);
    // No other statuses → should return []
    const result = renderAboveWidget(80, mockTheme);
    expect(result).toEqual([]);
  });

  it("renders correct phase icons for multiple claimed tasks", () => {
    const payload = kanbanPayload({
      claimed: 3,
      claimedTasks: [
        { id: "kb-1", title: "Write tests", phase: "test" },
        { id: "kb-2", title: "Implement feature", phase: "implement" },
        { id: "kb-3", title: "Review code", phase: "review" },
      ],
    });
    mockGetExtensionStatuses = () => new Map<string, string>([["kanban", payload]]);
    const result = renderAboveWidget(80, mockTheme);
    // 3 claimed task lines + 1 summary
    expect(result.length).toBe(4);
    expect(result[0]).toContain("🧪"); // test
    expect(result[0]).toContain("kb-1");
    expect(result[1]).toContain("⚙️"); // implement
    expect(result[1]).toContain("kb-2");
    expect(result[2]).toContain("👁"); // review
    expect(result[2]).toContain("kb-3");
  });

  it("does not render kanban when key is missing", () => {
    mockGetExtensionStatuses = () => new Map<string, string>([["til-done", "3 / 10"]]);
    const result = renderAboveWidget(80, mockTheme);
    // Only progress line, no kanban
    expect(result.length).toBe(1);
    expect(result[0]).not.toContain("claimed");
    expect(result[0]).not.toContain("7/8");
  });

  it("shows only non-zero counts in summary line", () => {
    const payload = kanbanPayload({
      total: 10,
      claimed: 2,
      ready: 3,
      blocked: 0,
      done: 5,
      claimedTasks: [],
    });
    mockGetExtensionStatuses = () => new Map<string, string>([["kanban", payload]]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(1);
    // Should have done/total
    expect(result[0]).toContain("5/10");
    // Should have claimed and ready (non-zero)
    expect(result[0]).toContain("claimed");
    expect(result[0]).toContain("ready");
    // Should NOT have blocked (zero)
    expect(result[0]).not.toContain("blocked");
  });

  it("uses question-mark icon for unknown phase", () => {
    const payload = kanbanPayload({
      claimedTasks: [{ id: "kb-5", title: "Mystery task", phase: "unknown-phase" }],
    });
    mockGetExtensionStatuses = () => new Map<string, string>([["kanban", payload]]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(2);
    expect(result[0]).toContain("?");
    expect(result[0]).toContain("kb-5");
  });

  it("uses done phase icon for completed claimed tasks", () => {
    const payload = kanbanPayload({
      claimedTasks: [{ id: "kb-7", title: "Done task", phase: "done" }],
    });
    mockGetExtensionStatuses = () => new Map<string, string>([["kanban", payload]]);
    const result = renderAboveWidget(80, mockTheme);
    expect(result.length).toBe(2);
    expect(result[0]).toContain("✓");
    expect(result[0]).toContain("kb-7");
  });
});

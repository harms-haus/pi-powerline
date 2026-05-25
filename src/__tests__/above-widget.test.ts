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
      expect(result[i]!).toContain(`item ${i + 1}`);
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

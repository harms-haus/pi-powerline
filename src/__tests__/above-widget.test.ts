import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";

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
const { renderAboveWidget } = await vi.mocked(await import("../above-widget"));

const mockTheme = { fg: (color: string, text: string) => `[${color}]${text}` } as unknown as Theme;

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
    expect(result[0].length).toBeLessThan(30);
  });
});

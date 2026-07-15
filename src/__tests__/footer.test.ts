import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Theme, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

// Mock the state module - we control these variables via the mock
vi.mock("../state", () => ({
  currentCwd: "/home/testuser/project",
  currentCtx: undefined as ExtensionContext | undefined,
  api: undefined,
  footerDataProvider: undefined as ReadonlyFooterDataProvider | undefined,
}));

// Mock the git module
vi.mock("../git", () => ({
  gitChanges: null as { insertions: number; deletions: number } | null,
  colorCodeGitChanges: vi.fn(
    (stat: { insertions: number; deletions: number } | null, theme: Theme) => {
      if (!stat) return theme.fg("dim", "");
      const { insertions, deletions } = stat;
      if (insertions > 0 && deletions > 0) {
        return `${theme.fg("success", `+${insertions}`)} ${theme.fg("error", `-${deletions}`)}`;
      } else if (insertions > 0) {
        return theme.fg("success", `+${insertions}`);
      } else if (deletions > 0) {
        return theme.fg("error", `-${deletions}`);
      }
      return theme.fg("dim", "");
    },
  ),
}));

// Mock the helpers module
vi.mock("../helpers", () => ({
  shortenPath: (path: string) => {
    // Always shorten /home/testuser/ to ~ for tests
    if (path.startsWith("/home/testuser")) {
      return "~" + path.slice("/home/testuser".length);
    }
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (home && path.startsWith(home)) {
      return "~" + path.slice(home.length);
    }
    return path;
  },
  formatTokens: (count: number) => {
    if (count < 1000) return count.toString();
    if (count < 10000) return (count / 1000).toFixed(1) + "k";
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    if (count < 10000000) return (count / 1000000).toFixed(1) + "M";
    return `${Math.round(count / 1000000)}M`;
  },
  alignLeftRight: (left: string, right: string, width: number) => {
    const leftW = visibleWidth(left);
    const rightW = visibleWidth(right);
    if (leftW + 2 + rightW <= width) {
      return left + " ".repeat(width - leftW - rightW) + right;
    }
    if (leftW + 2 <= width) {
      const availableForRight = width - leftW - 2;
      const truncatedRight = truncateToWidth(right, availableForRight, "");
      const actualRightW = visibleWidth(truncatedRight);
      return left + " ".repeat(width - leftW - actualRightW) + truncatedRight;
    }
    return truncateToWidth(left, width, "");
  },
}));

// Mock the path-compression module
let mockCompressPathToWidth = (path: string, _maxWidth: number): string => path;
vi.mock("../path-compression", () => ({
  compressPathToWidth: (...args: unknown[]) =>
    mockCompressPathToWidth(...(args as [string, number])),
  invalidateCompressionCache: vi.fn(),
}));

import * as state from "../state";
import * as git from "../git";
import {
  renderFooterLine,
  parseCwdStatus,
  parseZaiUsageStatus,
  parseCodexUsageStatus,
  formatResetTime,
  formatPercentage,
  buildZaiUsageBar,
  buildCodexUsageBar,
} from "../footer";

import { mockTheme, stripTags } from "./test-utils.js";

beforeEach(() => {
  // Reset all module-level state via mock
  (state as Record<string, unknown>).currentCwd = "/home/testuser/project";
  (state as Record<string, unknown>).currentCtx = undefined;
  (state as Record<string, unknown>).api = undefined;
  (state as Record<string, unknown>).footerDataProvider = undefined;
  (git as Record<string, unknown>).gitChanges = null;
  // Reset path compression mock to identity
  mockCompressPathToWidth = (path: string, _maxWidth: number): string => path;
});

afterEach(() => {
  // Full cleanup
  (state as Record<string, unknown>).currentCwd = undefined;
  (state as Record<string, unknown>).currentCtx = undefined;
  (state as Record<string, unknown>).api = undefined;
  (state as Record<string, unknown>).footerDataProvider = undefined;
  (git as Record<string, unknown>).gitChanges = null;
});

describe("renderFooterLine", () => {
  it("shows cwd with no branch, no git changes", () => {
    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // Should contain the shortened cwd
    expect(stripped).toContain("~/project");
    // Should contain model info
    expect(stripped).toContain("no-model");
    // Should contain context placeholder
    expect(stripped).toContain("?/0");
  });

  it("shows branch and git changes when available", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => undefined,
    };
    (git as Record<string, unknown>).gitChanges = { insertions: 10, deletions: 5 };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("(main)");
    expect(stripped).toContain("+10");
    expect(stripped).toContain("-5");
  });

  it("shows context usage with tokens and percent", () => {
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 50000,
        contextWindow: 128000,
        percent: 39.1,
      }),
      model: {
        id: "sonnet-4",
        provider: "anthropic",
        contextWindow: 128000,
      },
      modelRegistry: {
        getProviderDisplayName: () => "Anthropic",
      },
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("50k/128k");
    expect(stripped).toContain("39.1%");
    expect(stripped).toContain("sonnet-4");
  });

  it("uses error color when context usage > 90%", () => {
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 122000,
        contextWindow: 128000,
        percent: 95.5,
      }),
      model: {
        id: "claude-opus-4",
        provider: "anthropic",
        contextWindow: 128000,
      },
      modelRegistry: {
        getProviderDisplayName: () => "Anthropic",
      },
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // Full context info is present (not replaced by compact overlay)
    expect(stripped).toContain("122k/128k");
    expect(stripped).toContain("95.5%");
    // Model name is present
    expect(stripped).toContain("claude-opus-4");
    // Error color wraps only the percentage, not the token counts
    expect(result[0]).toContain("[error]");
    expect(result[0]!.indexOf("122k")).toBeLessThan(result[0]!.indexOf("[error]"));
  });

  it("uses warning color when context usage > 70%", () => {
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 96000,
        contextWindow: 128000,
        percent: 75.3,
      }),
      model: {
        id: "gpt-4o",
        provider: "openai",
        contextWindow: 128000,
      },
      modelRegistry: {
        getProviderDisplayName: () => "OpenAI",
      },
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // Full context info is present (not replaced by compact overlay)
    expect(stripped).toContain("96k/128k");
    expect(stripped).toContain("75.3%");
    // Model name is present
    expect(stripped).toContain("gpt-4o");
    // Warning color wraps only the percentage, not the token counts
    expect(result[0]).toContain("[warning]");
    expect(result[0]!.indexOf("96k")).toBeLessThan(result[0]!.indexOf("[warning]"));
  });

  it("truncates output when width is very narrow", () => {
    const result = renderFooterLine(10, mockTheme);

    expect(result.length).toBe(1);
    // With width=10, the output should be truncated to fit
    const visibleWidth = stripTags(result[0]!).length;
    expect(visibleWidth).toBeLessThanOrEqual(10);
  });

  it("returns two lines when pi-lens status is present", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "issues", lsp: "clean", tsc: "skipped" }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    expect(line2).toContain("[success]\u2713[text]prettier");
    expect(line2).toContain("[error]\u2717[text]linters");
    expect(line2).toContain("[success]\u2713[text]lsp");
    expect(line2).toContain("[dim]\u2014[text]tsc");
  });
});

describe("renderFooterLine with pi-git integration", () => {
  it("renders pi-git enriched label when status is present", () => {
    const piGitJson = JSON.stringify({
      cwd: "~/project",
      branch: "feature",
      insertions: 100,
      deletions: 50,
      addedCount: 2,
      modifiedCount: 3,
      deletedCount: 1,
    });
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map<string, string>([["pi-git", piGitJson]]),
    };

    // Use generous width since mock theme tags count as visible chars
    const result = renderFooterLine(300, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("~/project");
    expect(stripped).toContain("(feature)");
    expect(stripped).toContain("+100");
    expect(stripped).toContain("-50");
    expect(stripped).toContain("2 new");
    expect(stripped).toContain("3 changed");
    expect(stripped).toContain("1 deleted");
    // pi-git branch overrides built-in branch
    expect(stripped).not.toContain("(main)");
    // Bullet separators between groups
    expect(stripped).toContain("\u2022");
  });

  it("falls back to built-in when pi-git status is absent", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map<string, string>(),
    };
    (git as Record<string, unknown>).gitChanges = { insertions: 10, deletions: 5 };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("(main)");
    expect(stripped).toContain("+10");
    expect(stripped).toContain("-5");
  });

  it("falls back gracefully when pi-git status is malformed JSON", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map<string, string>([["pi-git", "not-json"]]),
    };
    (git as Record<string, unknown>).gitChanges = { insertions: 10, deletions: 5 };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // Falls back to built-in rendering
    expect(stripped).toContain("+10");
    expect(stripped).toContain("-5");
  });

  it("falls back gracefully when pi-git JSON has missing required fields", () => {
    const piGitJson = JSON.stringify({ cwd: "~/project" }); // missing branch
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map<string, string>([["pi-git", piGitJson]]),
    };
    (git as Record<string, unknown>).gitChanges = { insertions: 10, deletions: 5 };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // Falls back to built-in rendering
    expect(stripped).toContain("(main)");
    expect(stripped).toContain("+10");
    expect(stripped).toContain("-5");
  });

  it("shows pi-processes status left-aligned on line 2 with center lens status", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "issues", lsp: "clean", tsc: "skipped" }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]!);
    // Process count should be left-aligned (at position 0)
    expect(line2Stripped.indexOf("3 processes")).toBe(0);
    // Lens checks should appear somewhere in the line
    expect(result[1]).toContain("[text]prettier");
    expect(result[1]).toContain("[text]linters");
  });

  it("shows only pi-processes on line 2 when no LSP/Lint", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>([["pi-processes", "3 processes"]]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]!);
    expect(line2Stripped).toContain("3 processes");
    // Should be left-aligned
    expect(line2Stripped.indexOf("3 processes")).toBe(0);
  });

  it("centers lens status when no pi-processes status", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "issues", lsp: "clean", tsc: "skipped" }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    expect(line2).toContain("[text]prettier");
    expect(line2).toContain("[text]linters");
    // Centered: should not start at position 0
    const line2Stripped = stripTags(line2);
    expect(line2Stripped.indexOf("\u2713")).toBeGreaterThan(0);
  });

  it("returns single line when no statuses at all", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>(),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
  });

  it("omits zero-count segments from pi-git label", () => {
    const piGitJson = JSON.stringify({
      cwd: "~/project",
      branch: "dev",
      insertions: 20,
      deletions: 0,
      addedCount: 0,
      modifiedCount: 5,
      deletedCount: 0,
    });
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map<string, string>([["pi-git", piGitJson]]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).not.toContain("0 new");
    expect(stripped).not.toContain("0 deleted");
    expect(stripped).toContain("+20");
    expect(stripped).toContain("5 changed");
  });
});

describe("buildLine2 truncation", () => {
  const longStatus = "This-is-a-really-long-process-status-string-that-exceeds-the-limit";

  it("truncates left part to 1/3 width when both left and center exist", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", longStatus],
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "issues", lsp: "clean", tsc: "skipped" }),
          ],
        ]),
    };

    const width = 120;
    const result = renderFooterLine(width, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    const line2Stripped = stripTags(line2);

    // Full status should NOT appear — it was truncated
    expect(line2Stripped).not.toContain(longStatus);
    // But the beginning of the status should still be present (left-aligned)
    expect(line2Stripped.startsWith("This-is-a-really")).toBe(true);
    // Total visible width should equal the requested width
    expect(visibleWidth(line2)).toBe(width);
  });

  it("does NOT truncate left part when only left exists (no center)", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>([["pi-processes", longStatus]]),
    };

    const width = 120;
    const result = renderFooterLine(width, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]!);

    // Full status should appear — no truncation without center
    expect(line2Stripped).toContain(longStatus);
    expect(line2Stripped.startsWith(longStatus)).toBe(true);
  });

  it("does NOT truncate left part when it is short enough", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 procs"],
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "issues", lsp: "clean", tsc: "skipped" }),
          ],
        ]),
    };

    const width = 120;
    const result = renderFooterLine(width, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]!);

    // Short status should appear in full
    expect(line2Stripped).toContain("3 procs");
    expect(line2Stripped.startsWith("3 procs")).toBe(true);
    // Total visible width should match
    expect(visibleWidth(result[1]!)).toBe(width);
  });

  it("center is still properly centered after left truncation", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", longStatus],
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "issues", lsp: "clean", tsc: "skipped" }),
          ],
        ]),
    };

    const width = 200;
    const result = renderFooterLine(width, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    const line2Stripped = stripTags(line2);

    // Both left and center content should be present
    expect(line2).toContain("[text]prettier");
    expect(line2).toContain("[text]linters");

    // Center should appear after the left part (not at position 0)
    const checkIndex = line2Stripped.indexOf("\u2713");
    expect(checkIndex).toBeGreaterThan(0);

    // There should be whitespace between left part and center
    const beforeCheck = line2Stripped.substring(0, checkIndex);
    expect(beforeCheck).toMatch(/\s+$/);

    // There should be trailing whitespace after center content
    // (proving center is not jammed to the right edge)
    expect(line2Stripped).toMatch(/\s+$/);
  });
});

describe("buildLine2 JSON rendering", () => {
  it("clean check renders success icon and text label", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    // success-colored checkmark for each check
    expect(line2).toContain("[success]\u2713[text]prettier");
    expect(line2).toContain("[success]\u2713[text]linters");
    expect(line2).toContain("[success]\u2713[text]lsp");
    expect(line2).toContain("[success]\u2713[text]tsc");
  });

  it("issues check renders error icon and text label", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "issues", lsp: "clean", tsc: "clean" }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    expect(line2).toContain("[error]\u2717[text]linters");
    // Clean checks still render with success icon
    expect(line2).toContain("[success]\u2713[text]prettier");
    expect(line2).toContain("[success]\u2713[text]lsp");
    expect(line2).toContain("[success]\u2713[text]tsc");
  });

  it("pending check renders dim circle icon and text label", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "pending", linters: "clean", lsp: "clean", tsc: "clean" }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    expect(line2).toContain("[dim]\u25CB[text]prettier");
    // Other checks still render normally
    expect(line2).toContain("[success]\u2713[text]linters");
  });

  it("skipped check renders dim dash icon and text label", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "clean", lsp: "clean", tsc: "skipped" }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    expect(line2).toContain("[dim]\u2014[text]tsc");
    // Other checks still render with success icon
    expect(line2).toContain("[success]\u2713[text]prettier");
    expect(line2).toContain("[success]\u2713[text]linters");
    expect(line2).toContain("[success]\u2713[text]lsp");
  });

  it("error check renders warning icon and text label", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "error", linters: "clean", lsp: "clean", tsc: "clean" }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    expect(line2).toContain("[error]\u26A0[text]prettier");
    // Other checks still render normally
    expect(line2).toContain("[success]\u2713[text]linters");
  });

  it("all four checks are space-separated", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    // All four checks should be present, space-separated
    expect(line2).toContain("[success]\u2713[text]prettier [success]\u2713[text]linters");
    expect(line2).toContain("[success]\u2713[text]lsp [success]\u2713[text]tsc");
  });

  it("mixed statuses render correct icon for each check", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({
              prettier: "clean",
              linters: "issues",
              lsp: "running",
              tsc: "skipped",
            }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    // Each check gets its own icon
    expect(line2).toContain("[success]\u2713[text]prettier");
    expect(line2).toContain("[error]\u2717[text]linters");
    expect(line2).toContain("[warning]\u27F3[text]lsp");
    expect(line2).toContain("[dim]\u2014[text]tsc");

    // Verify space separation between all four checks
    const expected =
      "[success]\u2713[text]prettier " +
      "[error]\u2717[text]linters " +
      "[warning]\u27F3[text]lsp " +
      "[dim]\u2014[text]tsc";
    expect(line2).toContain(expected);
  });

  it("pi-lens key always renders all four checks even when all skipped", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({
              prettier: "skipped",
              linters: "skipped",
              lsp: "skipped",
              tsc: "skipped",
            }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    // pi-lens key exists → always renders line 2 with all 4 checks
    expect(result.length).toBe(2);
    const line2 = result[1]!;
    expect(line2).toContain("[dim]\u2014[text]prettier");
    expect(line2).toContain("[dim]\u2014[text]linters");
    expect(line2).toContain("[dim]\u2014[text]lsp");
    expect(line2).toContain("[dim]\u2014[text]tsc");
  });

  it("running check renders warning rotation icon and text label", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "running", linters: "clean", lsp: "clean", tsc: "clean" }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    // Running check gets warning-colored rotation icon
    expect(line2).toContain("[warning]\u27F3[text]prettier");
    // Other checks still render normally
    expect(line2).toContain("[success]\u2713[text]linters");
    expect(line2).toContain("[success]\u2713[text]lsp");
    expect(line2).toContain("[success]\u2713[text]tsc");
  });

  it("Malformed JSON falls back to Lens: label", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>([["pi-lens", "not-valid-json"]]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    // Falls back to plain string rendering with "Lens:" label
    expect(line2).toContain("[muted]Lens:");
    expect(line2).toContain("[dim]not-valid-json");
  });
});

describe("buildContextDisplay edge cases", () => {
  it("shows ?/N when tokens is null and percent is null", () => {
    // getContextUsage returns tokens=null, percent=null but has contextWindow
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: null,
        contextWindow: 128000,
        percent: null,
      }),
      model: undefined,
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("?/128k");
  });

  it("shows tokens/contextWindow without percent when percent is null", () => {
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 50000,
        contextWindow: 128000,
        percent: null,
      }),
      model: undefined,
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("50k/128k");
    // Should NOT contain a percentage
    expect(stripped).not.toMatch(/\d+\.\d+%/);
  });
});

describe("buildModelDisplay edge cases", () => {
  it("shows thinking level bullet when model has reasoning and thinking level is set", () => {
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 1000,
        contextWindow: 128000,
        percent: 0.8,
      }),
      model: {
        id: "sonnet-4",
        provider: "anthropic",
        contextWindow: 128000,
        reasoning: true,
      },
      modelRegistry: {
        getProviderDisplayName: () => "Anthropic",
      },
    };
    (state as Record<string, unknown>).api = {
      getThinkingLevel: () => "high",
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    // Should contain the bullet separator and thinking level
    expect(result[0]).toContain("\u2022");
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("high");
  });
});

describe("buildLine1 truncation edge cases", () => {
  it("truncates left side when left is too wide even without right", () => {
    // Set a very long cwd to force left truncation
    (state as Record<string, unknown>).currentCwd =
      "/home/testuser/this/is/a/very/long/path/to/force/truncation/of/left/side";
    const result = renderFooterLine(10, mockTheme);

    expect(result.length).toBe(1);
    // Should be truncated to width
    expect(stripTags(result[0]!).length).toBeLessThanOrEqual(10);
  });
});

describe("buildLine2 center truncation", () => {
  it("truncates center part when it exceeds width", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lens",
            JSON.stringify({ prettier: "clean", linters: "issues", lsp: "clean", tsc: "skipped" }),
          ],
        ]),
    };

    // Use a very narrow width to force truncation of the center content
    const result = renderFooterLine(30, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]!);
    // Should be truncated to width
    expect(line2Stripped.length).toBeLessThanOrEqual(30);
  });
});

describe("collectFooterContext stale accessor isolation", () => {
  it("keeps model, provider, and usage data when modelRegistry is stale", () => {
    (state as Record<string, unknown>).currentCtx = {
      get modelRegistry() {
        throw new Error("model registry is stale");
      },
      model: {
        id: "replacement-model",
        provider: "replacement-provider",
        contextWindow: 200000,
        reasoning: false,
      },
      getContextUsage: () => ({
        tokens: 50000,
        contextWindow: 200000,
        percent: 25,
      }),
    };

    const result = renderFooterLine(160, mockTheme);
    const stripped = stripTags(result[0]!);

    expect(stripped).toContain("50k/200k");
    expect(stripped).toContain("25.0%");
    expect(stripped).toContain("(replacement-provider)");
    expect(stripped).toContain("replacement-model");
    expect(stripped).not.toContain("?/0");
    expect(stripped).not.toContain("no-model");
  });

  it("keeps context usage when the model getter is stale", () => {
    (state as Record<string, unknown>).currentCtx = {
      modelRegistry: {
        getProviderDisplayName: () => "Replacement Provider",
      },
      get model() {
        throw new Error("model is stale");
      },
      getContextUsage: () => ({
        tokens: 64000,
        contextWindow: 256000,
        percent: 25,
      }),
    };

    const result = renderFooterLine(160, mockTheme);
    const stripped = stripTags(result[0]!);

    expect(stripped).toContain("64k/256k");
    expect(stripped).toContain("25.0%");
    expect(stripped).not.toContain("?/0");
  });

  it("keeps model context-window and provider data when context usage is stale", () => {
    (state as Record<string, unknown>).currentCtx = {
      modelRegistry: {
        getProviderDisplayName: () => "Replacement Provider",
      },
      model: {
        id: "replacement-model",
        provider: "replacement-provider",
        contextWindow: 200000,
        reasoning: false,
      },
      getContextUsage: () => {
        throw new Error("context usage is stale");
      },
    };

    const result = renderFooterLine(160, mockTheme);
    const stripped = stripTags(result[0]!);

    expect(stripped).toContain("?/200k");
    expect(stripped).toContain("(Replacement Provider)");
    expect(stripped).toContain("replacement-model");
    expect(stripped).not.toContain("?/0");
    expect(stripped).not.toContain("no-model");
  });

  it("retains explicit footer error handling for a non-stale modelRegistry failure", () => {
    (state as Record<string, unknown>).currentCtx = {
      get modelRegistry() {
        throw new Error("registry unavailable");
      },
      model: {
        id: "replacement-model",
        provider: "replacement-provider",
        contextWindow: 200000,
      },
      getContextUsage: () => ({
        tokens: 50000,
        contextWindow: 200000,
        percent: 25,
      }),
    };

    expect(renderFooterLine(160, mockTheme)).toEqual(["[powerline error]"]);
  });

  it("retains explicit footer error handling for a non-stale model failure", () => {
    (state as Record<string, unknown>).currentCtx = {
      modelRegistry: {
        getProviderDisplayName: () => "Replacement Provider",
      },
      get model() {
        throw new Error("model unavailable");
      },
      getContextUsage: () => ({
        tokens: 50000,
        contextWindow: 200000,
        percent: 25,
      }),
    };

    expect(renderFooterLine(160, mockTheme)).toEqual(["[powerline error]"]);
  });

  it("retains explicit footer error handling for a non-stale context usage failure", () => {
    (state as Record<string, unknown>).currentCtx = {
      modelRegistry: {
        getProviderDisplayName: () => "Replacement Provider",
      },
      model: {
        id: "replacement-model",
        provider: "replacement-provider",
        contextWindow: 200000,
      },
      getContextUsage: () => {
        throw new Error("context usage unavailable");
      },
    };

    expect(renderFooterLine(160, mockTheme)).toEqual(["[powerline error]"]);
  });
});

describe("instance-scoped footer context", () => {
  it("reads updated usage from the active replacement context on every render", () => {
    let tokens = 0;
    const activeCtx = {
      modelRegistry: {
        getProviderDisplayName: () => "Replacement Provider",
      },
      model: {
        id: "replacement-model",
        provider: "replacement-provider",
        contextWindow: 200000,
        reasoning: false,
      },
      getContextUsage: () => ({
        tokens,
        contextWindow: 200000,
        percent: (tokens / 200000) * 100,
      }),
    } as never;
    const extensionApi = { getThinkingLevel: () => "medium" } as never;

    const initial = stripTags(renderFooterLine(160, mockTheme, activeCtx, extensionApi)[0]!);
    expect(initial).toContain("0/200k 0.0%");

    tokens = 50000;
    const updated = stripTags(renderFooterLine(160, mockTheme, activeCtx, extensionApi)[0]!);
    expect(updated).toContain("50k/200k 25.0%");
    expect(updated).toContain("replacement-model");
  });
});

describe("collectFooterContext with api thinking level", () => {
  it("includes thinking level from api when set", () => {
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 1000,
        contextWindow: 128000,
        percent: 0.8,
      }),
      model: {
        id: "sonnet-4",
        provider: "anthropic",
        contextWindow: 128000,
        reasoning: false,
      },
      modelRegistry: {
        getProviderDisplayName: () => "Anthropic",
      },
    };
    (state as Record<string, unknown>).api = {
      getThinkingLevel: () => "medium",
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    // Should include thinking level when model has reasoning=true (this model has reasoning=false,
    // so thinking level should NOT be displayed as bullet)
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("sonnet-4");
  });
});

describe("buildModelDisplay: provider without modelRegistry", () => {
  it("shows raw provider name when modelRegistry is absent", () => {
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 1000,
        contextWindow: 128000,
        percent: 0.8,
      }),
      model: {
        id: "sonnet-4",
        provider: "anthropic",
        contextWindow: 128000,
      },
      // No modelRegistry → hits the else branch: providerName = provider
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("(anthropic)");
  });
});

describe("buildLine1: left truncation when right is wide", () => {
  it("truncates left to width when both left and right are too wide", () => {
    // Use a model with a very long provider name to make the right side wide
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 999999,
        contextWindow: 1280000,
        percent: 78.2,
      }),
      model: {
        id: "very-long-model-name-that-takes-up-space",
        provider: "extremely-long-provider-name",
        contextWindow: 1280000,
      },
      modelRegistry: {
        getProviderDisplayName: () => "Extremely Long Provider Display Name",
      },
    };
    // Also set a long cwd
    (state as Record<string, unknown>).currentCwd =
      "/home/testuser/very/deeply/nested/directory/structure/with/many/components";

    // Very narrow width to force left truncation path
    const result = renderFooterLine(15, mockTheme);

    expect(result.length).toBe(1);
    // Should be truncated to fit width
    expect(stripTags(result[0]!).length).toBeLessThanOrEqual(15);
  });

  it("truncates only left when percentage overlay cannot fit at all", () => {
    // percent > 70 triggers warning path but width is so narrow
    // that even the minimum right side (percentage) can't fit
    (state as Record<string, unknown>).currentCtx = {
      getContextUsage: () => ({
        tokens: 90000,
        contextWindow: 128000,
        percent: 75.0,
      }),
      model: {
        id: "model",
        provider: "provider",
        contextWindow: 128000,
      },
    };
    (state as Record<string, unknown>).currentCwd = "/home/testuser/some/deeply/nested/path";

    // percent > 70 triggers the warning overlay path when width allows it
    // At width=20, minRightW (visibleWidth of "[warning]75%" = 12) + 2 <= 20
    // so the buggy code enters the overlay and shows only "75%"
    // The fixed code uses alignLeftRight which truncates the right side at this width
    const result = renderFooterLine(20, mockTheme);

    expect(result.length).toBe(1);
    // Output respects terminal width constraint — normal alignLeftRight truncation
    expect(visibleWidth(result[0]!)).toBeLessThanOrEqual(20);
    // At this width, alignLeftRight truncates the right side entirely
    // The output should not contain the percentage overlay
    const stripped = stripTags(result[0]!);
    expect(stripped).not.toContain("75%");
  });
});

describe("renderFooterLine error handling", () => {
  it("returns [powerline error] when an exception is thrown", () => {
    // Force an error by making getGitBranch throw
    (state as Record<string, unknown>).currentCwd = "/home/testuser/project";
    (state as Record<string, unknown>).footerDataProvider = {
      get getGitBranch() {
        throw new Error("test error");
      },
      getExtensionStatuses: () => new Map(),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result).toEqual(["[powerline error]"]);
  });
});

// ─── ZAI Usage Progress Bar ──────────────────────────────────────

describe("parseZaiUsageStatus", () => {
  it("returns parsed payload for valid JSON with percentage and resetTimeMs", () => {
    const input = JSON.stringify({ percentage: 45.7, resetTimeMs: 1700000000000 });
    expect(parseZaiUsageStatus(input)).toEqual({
      percentage: 45.7,
      resetTimeMs: 1700000000000,
    });
  });

  it("returns parsed payload for valid JSON with only percentage", () => {
    const input = JSON.stringify({ percentage: 80 });
    expect(parseZaiUsageStatus(input)).toEqual({
      percentage: 80,
      resetTimeMs: undefined,
    });
  });

  it("returns null for undefined input", () => {
    expect(parseZaiUsageStatus(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseZaiUsageStatus("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseZaiUsageStatus("not-json")).toBeNull();
  });

  it("returns null when percentage field is missing", () => {
    const input = JSON.stringify({ resetTimeMs: 1700000000000 });
    expect(parseZaiUsageStatus(input)).toBeNull();
  });

  it("returns null when percentage is NaN", () => {
    const input = JSON.stringify({ percentage: NaN });
    expect(parseZaiUsageStatus(input)).toBeNull();
  });

  it("returns null when percentage is Infinity", () => {
    const input = JSON.stringify({ percentage: Infinity });
    expect(parseZaiUsageStatus(input)).toBeNull();
  });

  it("returns payload for percentage > 100 (over-quota)", () => {
    const input = JSON.stringify({ percentage: 120 });
    expect(parseZaiUsageStatus(input)).toEqual({
      percentage: 120,
      resetTimeMs: undefined,
    });
  });

  it("returns null for negative percentage", () => {
    const input = JSON.stringify({ percentage: -5 });
    expect(parseZaiUsageStatus(input)).toBeNull();
  });
});

describe("formatPercentage", () => {
  it('formats whole number 80 as "80%"', () => {
    expect(formatPercentage(80)).toBe("80%");
  });

  it('formats decimal 45.7 as "45.7%"', () => {
    expect(formatPercentage(45.7)).toBe("45.7%");
  });

  it('formats 0 as "0%"', () => {
    expect(formatPercentage(0)).toBe("0%");
  });

  it('formats 100 as "100%"', () => {
    expect(formatPercentage(100)).toBe("100%");
  });

  it('formats 33.33 as "33.3%" (one decimal place)', () => {
    expect(formatPercentage(33.33)).toBe("33.3%");
  });
});

describe("formatResetTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats 2 hours 15 minutes from now as "2h 15m"', () => {
    const resetTimeMs = 1_000_000 + (2 * 3600 + 15 * 60) * 1000;
    expect(formatResetTime(resetTimeMs)).toBe("2h 15m");
  });

  it('formats 45 minutes from now as "45m"', () => {
    const resetTimeMs = 1_000_000 + 45 * 60 * 1000;
    expect(formatResetTime(resetTimeMs)).toBe("45m");
  });

  it('formats 30 seconds from now as "<1m"', () => {
    const resetTimeMs = 1_000_000 + 30 * 1000;
    expect(formatResetTime(resetTimeMs)).toBe("<1m");
  });

  it('formats 15 minutes 30 seconds from now as "15m"', () => {
    const resetTimeMs = 1_000_000 + (15 * 60 + 30) * 1000;
    expect(formatResetTime(resetTimeMs)).toBe("15m");
  });

  it("returns empty string for past time (0 remaining)", () => {
    const resetTimeMs = 1_000_000 - 1000;
    expect(formatResetTime(resetTimeMs)).toBe("");
  });

  it('formats 59 seconds from now as "<1m"', () => {
    const resetTimeMs = 1_000_000 + 59 * 1000;
    expect(formatResetTime(resetTimeMs)).toBe("<1m");
  });

  it('formats exactly 60 seconds from now as "1m"', () => {
    const resetTimeMs = 1_000_000 + 60 * 1000;
    expect(formatResetTime(resetTimeMs)).toBe("1m");
  });

  it('formats 500ms from now as "<1m"', () => {
    const resetTimeMs = 1_000_000 + 500;
    expect(formatResetTime(resetTimeMs)).toBe("<1m");
  });
});

describe("buildZaiUsageBar", () => {
  it("renders empty bar with 0% — bar muted, percent muted", () => {
    const result = buildZaiUsageBar(0, undefined, mockTheme);
    // Bar is always muted
    expect(result).toContain("[muted]" + "\u2500".repeat(12)); // [muted]────────────
    // Percent is muted for 0%
    expect(result).toContain("[muted]0%");
    expect(result).toContain("0%");
  });

  it("renders half-filled bar with 50% — bar muted, percent muted", () => {
    const result = buildZaiUsageBar(50, undefined, mockTheme);
    expect(result).toContain("[muted]" + "\u2501".repeat(5) + "\u2578" + "\u2500".repeat(6));
    // Percent is muted for 50% (≤ 70)
    expect(result).toContain("[muted]50%");
    expect(result).toContain("50%");
  });

  it("renders mostly-filled bar with 80% — bar muted, percent warning", () => {
    const result = buildZaiUsageBar(80, undefined, mockTheme);
    expect(result).toContain("[muted]" + "\u2501".repeat(9) + "\u2578" + "\u2500".repeat(2));
    // Percent is warning for 80% (> 70, ≤ 90)
    expect(result).toContain("[warning]80%");
    expect(result).toContain("80%");
  });

  it("renders fully-filled bar with 100% — bar muted, percent error", () => {
    const result = buildZaiUsageBar(100, undefined, mockTheme);
    expect(result).toContain("[muted]" + "\u2501".repeat(12));
    // Percent is error for 100% (> 90)
    expect(result).toContain("[error]100%");
  });

  it("renders decimal percentage 45.7% correctly — bar muted, percent muted", () => {
    const result = buildZaiUsageBar(45.7, undefined, mockTheme);
    // Percent is muted for 45.7% (≤ 70)
    expect(result).toContain("[muted]45.7%");
    expect(result).toContain("45.7%");
  });

  it("includes formatted reset time wrapped in muted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const resetTimeMs = 1_000_000 + 45 * 60 * 1000; // 45 minutes from now
    const result = buildZaiUsageBar(60, resetTimeMs, mockTheme);
    // Reset time is always muted
    expect(result).toContain("[muted]45m");
    // Bar is muted
    expect(result).toContain("[muted]");
    // Percent is muted for 60% (≤ 70)
    expect(result).toContain("[muted]60%");
    vi.useRealTimers();
  });

  it("does not include time suffix when resetTimeMs is undefined", () => {
    const result = buildZaiUsageBar(60, undefined, mockTheme);
    const stripped = stripTags(result);
    // Should end right after the percentage
    expect(stripped).toMatch(/60%$/);
  });

  it("renders fully-filled bar for over-quota 120% — bar muted, percent error", () => {
    const result = buildZaiUsageBar(120, undefined, mockTheme);
    expect(result).toContain("[muted]" + "\u2501".repeat(12)); // bar muted, fully filled
    // Percent is error for 120% (> 90)
    expect(result).toContain("[error]120%");
  });

  it("uses muted color for percentage 30% (low usage)", () => {
    const result = buildZaiUsageBar(30, undefined, mockTheme);
    expect(result).toContain("[muted]");
    expect(result).toContain("[muted]30%");
  });

  it("uses muted color for percentage 65% (still ≤ 70)", () => {
    const result = buildZaiUsageBar(65, undefined, mockTheme);
    expect(result).toContain("[muted]");
    expect(result).toContain("[muted]65%");
  });

  it("uses warning color for percentage 90% — exactly 90 → warning (strict > 90)", () => {
    const result = buildZaiUsageBar(90, undefined, mockTheme);
    // Percent is warning for exactly 90% (threshold is strict > 90)
    expect(result).toContain("[warning]90%");
  });

  it("visible content (via stripTags) contains bar and percentage", () => {
    const result = buildZaiUsageBar(50, undefined, mockTheme);
    const stripped = stripTags(result);
    expect(stripped).toContain("\u2501".repeat(5) + "\u2578" + "\u2500".repeat(6));
    expect(stripped).toContain("50%");
  });

  // ── Edge-case tests ─────────────────────────────────────────

  it("exactly 70% → percent is [muted]70% (threshold is strict > 70)", () => {
    const result = buildZaiUsageBar(70, undefined, mockTheme);
    expect(result).toContain("[muted]70%");
    // Bar is always muted
    expect(result).toContain("[muted]");
  });

  it("exactly 90% → percent is [warning]90% (threshold is strict > 90)", () => {
    const result = buildZaiUsageBar(90, undefined, mockTheme);
    expect(result).toContain("[warning]90%");
    // Bar is always muted
    expect(result).toContain("[muted]");
  });

  it("75% → percent is [warning]75% (> 70 and ≤ 90)", () => {
    const result = buildZaiUsageBar(75, undefined, mockTheme);
    expect(result).toContain("[warning]75%");
    // Bar is always muted
    expect(result).toContain("[muted]");
  });

  it("renders single partial marker for tiny percentage (3%, filled=0 edge case)", () => {
    const result = buildZaiUsageBar(3, undefined, mockTheme);
    // filled = Math.round(3/100 * 12) = 0, so the filled===0 branch triggers
    expect(result).toContain("[muted]" + "\u2578" + "\u2500".repeat(11));
    expect(result).toContain("[muted]3%");
  });

  it("renders single partial marker for negative percentage (clamped to 0 filled)", () => {
    // parseZaiUsageStatus rejects negatives, but buildZaiUsageBar is a public function
    // that could receive any input. Verify it doesn't crash.
    const result = buildZaiUsageBar(-5, undefined, mockTheme);
    // filled clamped to 0, hits the filled===0 branch
    expect(result).toContain("\u2578");
    expect(result).toContain("-5%");
  });
});

// ─── buildLine2 with ZAI Usage (3-zone layout) ────────────────────

describe("buildLine2 with ZAI usage (3-zone layout)", () => {
  const zaiUsage = (percentage: number, resetTimeMs?: number) =>
    JSON.stringify({ percentage, resetTimeMs });

  const lensClean = () =>
    JSON.stringify({ prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" });

  // ── All 3 zones ──────────────────────────────────────────────

  it("renders all 3 zones (processes + lens + zai-usage) at width 120", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          ["pi-lens", lensClean()],
          ["zai-usage", zaiUsage(80, Date.now() + 7200000)],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    const line2Stripped = stripTags(line2);

    // Left zone: processes text
    expect(line2Stripped).toContain("3 processes");
    // Center zone: lens check icons
    expect(line2).toContain("[success]\u2713[text]prettier");
    // Right zone: ZAI bar with 80% (warning range: >70, ≤90)
    expect(line2).toContain("[warning]");
    expect(line2Stripped).toContain("80%");

    // Width invariant
    expect(visibleWidth(line2)).toBe(120);

    // ZAI bar is right-aligned (appears after the last lens check text)
    const tscIdx = line2Stripped.indexOf("tsc");
    const barIdx = line2Stripped.indexOf("\u2501");
    expect(barIdx).toBeGreaterThan(tscIdx);
  });

  // ── 2 zones: lens + zai-usage (no processes) ────────────────

  it("renders 2 zones (lens + zai-usage, no processes) at width 120", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-lens", lensClean()],
          ["zai-usage", zaiUsage(60)],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    const line2Stripped = stripTags(line2);

    // Center: lens icons
    expect(line2).toContain("[success]\u2713[text]prettier");
    // Right: ZAI bar
    expect(line2Stripped).toContain("60%");
    // Width
    expect(visibleWidth(line2)).toBe(120);
  });

  // ── 2 zones: processes + zai-usage (no lens) ────────────────

  it("renders 2 zones (processes + zai-usage, no lens) at width 120", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          ["zai-usage", zaiUsage(45)],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    const line2Stripped = stripTags(line2);

    // Left: processes
    expect(line2Stripped).toContain("3 processes");
    // Right: ZAI bar
    expect(line2Stripped).toContain("45%");
    // Width
    expect(visibleWidth(line2)).toBe(120);
  });

  // ── 1 zone: zai-usage only ─────────────────────────────────

  it("renders zai-usage bar right-aligned when it is the only status (no processes or lens)", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () => new Map<string, string>([["zai-usage", zaiUsage(80)]]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const strippedLine2 = stripTags(result[1]!);
    expect(strippedLine2).toContain("80%");
    expect(visibleWidth(result[1]!)).toBe(120);
    // Right-aligned: line 2 should have leading whitespace before the bar content
    expect(strippedLine2).toMatch(/^\s+/);
  });

  it("zai-usage only: bar respects width for narrow terminal (width 30)", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () => new Map<string, string>([["zai-usage", zaiUsage(80)]]),
    };

    const result = renderFooterLine(30, mockTheme);

    expect(result.length).toBe(2);
    // Use stripTags().length because mockTheme produces [color] tags that
    // visibleWidth counts as visible chars (see test-utils.ts).
    expect(stripTags(result[1]!).length).toBeLessThanOrEqual(30);
    expect(stripTags(result[1]!)).toContain("80%");
  });

  // ── Backward compatibility (no zai-usage) ────────────────────

  it("backward compat: only pi-processes → left-aligned, no zai bar", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () => new Map<string, string>([["pi-processes", "3 processes"]]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]!);
    expect(line2Stripped.indexOf("3 processes")).toBe(0);
    expect(visibleWidth(result[1]!)).toBe(120);
  });

  it("backward compat: only pi-lens → centered, no zai bar", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () => new Map<string, string>([["pi-lens", lensClean()]]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]!);
    // Centered: does not start at position 0
    expect(line2Stripped.indexOf("\u2713")).toBeGreaterThan(0);
    expect(visibleWidth(result[1]!)).toBe(120);
  });

  it("backward compat: processes + lens → left+center, no zai bar", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          ["pi-lens", lensClean()],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]!);
    expect(line2Stripped.indexOf("3 processes")).toBe(0);
    expect(result[1]).toContain("[text]prettier");
    expect(visibleWidth(result[1]!)).toBe(120);
  });

  it("backward compat: no statuses → single line, null line 2", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () => new Map<string, string>(),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
  });

  // ── Narrow terminal ─────────────────────────────────────────

  it("width invariant holds at narrow width 30 with all 3 zones", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          ["pi-lens", lensClean()],
          ["zai-usage", zaiUsage(80)],
        ]),
    };

    const result = renderFooterLine(30, mockTheme);

    expect(result.length).toBe(2);
    // Use stripTags because mockTheme produces [color] tags that visibleWidth
    // doesn't fully strip when multiple tags are present. Verify content
    // correctness and that stripped content fits within the allotted width.
    const strippedLine2 = stripTags(result[1]!);
    expect(strippedLine2.length).toBeLessThanOrEqual(30);
    expect(strippedLine2).toContain("80%");
  });

  it("width invariant holds at width 80 with all 3 zones", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          ["pi-lens", lensClean()],
          ["zai-usage", zaiUsage(80)],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    expect(visibleWidth(result[1]!)).toBe(80);
  });
});

// ─── Codex Usage (5h / 7d consumed-quota bars) ───────────────────

describe("parseCodexUsageStatus", () => {
  it("returns parsed payload for valid JSON with both windows and resetTimeMs", () => {
    const input = JSON.stringify({
      fiveHour: { percentage: 45.7, resetTimeMs: 1700000000000 },
      weekly: { percentage: 62, resetTimeMs: 1700000100000 },
    });
    expect(parseCodexUsageStatus(input)).toEqual({
      fiveHour: { percentage: 45.7, resetTimeMs: 1700000000000 },
      weekly: { percentage: 62, resetTimeMs: 1700000100000 },
    });
  });

  it("returns parsed payload when windows omit resetTimeMs", () => {
    const input = JSON.stringify({
      fiveHour: { percentage: 80 },
      weekly: { percentage: 30 },
    });
    expect(parseCodexUsageStatus(input)).toEqual({
      fiveHour: { percentage: 80, resetTimeMs: undefined },
      weekly: { percentage: 30, resetTimeMs: undefined },
    });
  });

  it("returns null for undefined input", () => {
    expect(parseCodexUsageStatus(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCodexUsageStatus("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseCodexUsageStatus("not-json")).toBeNull();
  });

  it("returns null when fiveHour window is missing", () => {
    const input = JSON.stringify({ weekly: { percentage: 50 } });
    expect(parseCodexUsageStatus(input)).toBeNull();
  });

  it("returns null when weekly window is missing", () => {
    const input = JSON.stringify({ fiveHour: { percentage: 50 } });
    expect(parseCodexUsageStatus(input)).toBeNull();
  });

  it("returns null when a window percentage is missing", () => {
    const input = JSON.stringify({
      fiveHour: { resetTimeMs: 1000 },
      weekly: { percentage: 50 },
    });
    expect(parseCodexUsageStatus(input)).toBeNull();
  });

  it("returns null when a window percentage is NaN", () => {
    const input = JSON.stringify({
      fiveHour: { percentage: NaN },
      weekly: { percentage: 50 },
    });
    expect(parseCodexUsageStatus(input)).toBeNull();
  });

  it("returns null when a window percentage is Infinity", () => {
    const input = JSON.stringify({
      fiveHour: { percentage: Infinity },
      weekly: { percentage: 50 },
    });
    expect(parseCodexUsageStatus(input)).toBeNull();
  });

  it("returns null for negative percentage", () => {
    const input = JSON.stringify({
      fiveHour: { percentage: -5 },
      weekly: { percentage: 50 },
    });
    expect(parseCodexUsageStatus(input)).toBeNull();
  });

  it("returns null when resetTimeMs is not a number", () => {
    const input = JSON.stringify({
      fiveHour: { percentage: 50, resetTimeMs: "soon" },
      weekly: { percentage: 50 },
    });
    expect(parseCodexUsageStatus(input)).toBeNull();
  });

  it("returns payload for over-quota percentages (> 100)", () => {
    const input = JSON.stringify({
      fiveHour: { percentage: 120 },
      weekly: { percentage: 200 },
    });
    expect(parseCodexUsageStatus(input)).toEqual({
      fiveHour: { percentage: 120, resetTimeMs: undefined },
      weekly: { percentage: 200, resetTimeMs: undefined },
    });
  });

  it("returns null when root is not an object", () => {
    expect(parseCodexUsageStatus(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it("returns null when a window is not an object", () => {
    const input = JSON.stringify({ fiveHour: 50, weekly: { percentage: 50 } });
    expect(parseCodexUsageStatus(input)).toBeNull();
  });
});

describe("buildCodexUsageBar", () => {
  it("renders both 5h and 7d windows with labels, bars, and percentages at wide width", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const result = buildCodexUsageBar(
      { percentage: 50, resetTimeMs: 1_000_000 + 45 * 60 * 1000 },
      { percentage: 60, resetTimeMs: 1_000_000 + (2 * 3600 + 15 * 60) * 1000 },
      mockTheme,
      120,
    );
    const stripped = stripTags(result);
    // Both labels present
    expect(stripped).toContain("5h");
    expect(stripped).toContain("7d");
    // Both percentages
    expect(stripped).toContain("50%");
    expect(stripped).toContain("60%");
    // Both reset countdowns are retained at wide width
    expect(stripped).toContain("45m");
    expect(stripped).toContain("2h 15m");
    // Two distinct windows separated by two spaces
    expect(stripped).toContain("  ");
    vi.useRealTimers();
  });

  it("consumed bar fills left-to-right: higher percentage fills more from the left", () => {
    const low = stripTags(
      buildCodexUsageBar({ percentage: 20 }, { percentage: 20 }, mockTheme, 120),
    );
    const high = stripTags(
      buildCodexUsageBar({ percentage: 80 }, { percentage: 80 }, mockTheme, 120),
    );
    // 20% at barWidth 8: filled=2 → "━╸──────"
    expect(low).toContain("\u2501\u2578" + "\u2500".repeat(6));
    // 80% at barWidth 8: filled=6 → "━━━━━╸──"
    expect(high).toContain("\u2501".repeat(5) + "\u2578" + "\u2500".repeat(2));
    // Heavy fill grows with percentage (consumed-quota direction)
    const lowHeavy = (low.match(/\u2501/g) || []).length;
    const highHeavy = (high.match(/\u2501/g) || []).length;
    expect(highHeavy).toBeGreaterThan(lowHeavy);
  });

  it("uses muted color for percentages ≤ 70 (both windows)", () => {
    const result = buildCodexUsageBar({ percentage: 50 }, { percentage: 70 }, mockTheme, 120);
    expect(result).toContain("[muted]50%");
    expect(result).toContain("[muted]70%");
  });

  it("uses warning color for percentages > 70 and ≤ 90", () => {
    const result = buildCodexUsageBar({ percentage: 75 }, { percentage: 90 }, mockTheme, 120);
    expect(result).toContain("[warning]75%");
    expect(result).toContain("[warning]90%");
  });

  it("uses error color for percentages > 90", () => {
    const result = buildCodexUsageBar({ percentage: 91 }, { percentage: 100 }, mockTheme, 120);
    expect(result).toContain("[error]91%");
    expect(result).toContain("[error]100%");
  });

  it("applies independent threshold colors per window", () => {
    // 5h warning, 7d error
    const result = buildCodexUsageBar({ percentage: 80 }, { percentage: 95 }, mockTheme, 120);
    expect(result).toContain("[warning]80%");
    expect(result).toContain("[error]95%");
  });

  it("bar is always muted regardless of percentage color", () => {
    const result = buildCodexUsageBar({ percentage: 95 }, { percentage: 95 }, mockTheme, 120);
    expect(result).toContain("[muted]");
    expect(result).toContain("[error]95%");
  });

  it("includes formatted reset countdowns when resetTimeMs is set (wide width)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const result = buildCodexUsageBar(
      { percentage: 60, resetTimeMs: 1_000_000 + 45 * 60 * 1000 },
      { percentage: 60, resetTimeMs: 1_000_000 + 30 * 1000 },
      mockTheme,
      120,
    );
    const stripped = stripTags(result);
    expect(stripped).toContain("45m");
    expect(stripped).toContain("<1m");
    vi.useRealTimers();
  });

  it("omits reset suffix when resetTimeMs is undefined", () => {
    const result = buildCodexUsageBar({ percentage: 60 }, { percentage: 60 }, mockTheme, 120);
    const stripped = stripTags(result);
    expect(stripped).not.toContain("m");
    expect(stripped).toContain("60%");
  });

  it("omits reset suffix when resetTimeMs is in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const result = buildCodexUsageBar(
      { percentage: 60, resetTimeMs: 1_000_000 - 5000 },
      { percentage: 60, resetTimeMs: 1_000_000 - 5000 },
      mockTheme,
      120,
    );
    const stripped = stripTags(result);
    expect(stripped).not.toMatch(/\d+m/);
    expect(stripped).toContain("60%");
    vi.useRealTimers();
  });

  it("renders full-width bars (barWidth 8) at wide width", () => {
    const result = buildCodexUsageBar({ percentage: 50 }, { percentage: 60 }, mockTheme, 120);
    const stripped = stripTags(result);
    // 50% barWidth 8: filled=4 → "━━━╸────"
    expect(stripped).toContain("\u2501".repeat(3) + "\u2578" + "\u2500".repeat(4));
    // 60% barWidth 8: filled=5 → "━━━━╸───"
    expect(stripped).toContain("\u2501".repeat(4) + "\u2578" + "\u2500".repeat(3));
    expect(stripped.length).toBeLessThanOrEqual(120);
  });

  it("shrinks bar width as maxWidth decreases (barWidth 4)", () => {
    const result = buildCodexUsageBar({ percentage: 50 }, { percentage: 60 }, mockTheme, 24);
    const stripped = stripTags(result);
    // barWidth 4: 50% → "━╸──", total analytic width = 24
    expect(stripped).toContain("\u2501\u2578\u2500\u2500");
    expect(stripped.length).toBe(24);
    expect(stripped).toContain("5h");
    expect(stripped).toContain("7d");
  });

  it("drops bars entirely at narrow width, keeping labels + percentages", () => {
    const result = buildCodexUsageBar({ percentage: 50 }, { percentage: 60 }, mockTheme, 14);
    const stripped = stripTags(result);
    // minimal: "5h 50%  7d 60%" = 14 chars
    expect(stripped.length).toBe(14);
    expect(stripped).toContain("5h 50%");
    expect(stripped).toContain("7d 60%");
    expect(stripped).not.toContain("\u2501");
    expect(stripped).not.toContain("\u2500");
  });

  it("drops reset countdowns before bars when maxWidth is constrained", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const result = buildCodexUsageBar(
      { percentage: 50, resetTimeMs: 1_000_000 + 45 * 60 * 1000 },
      { percentage: 60, resetTimeMs: 1_000_000 + 45 * 60 * 1000 },
      mockTheme,
      24,
    );
    const stripped = stripTags(result);
    // Resets dropped, bars retained, fits within budget
    expect(stripped).not.toContain("45m");
    expect(stripped).toContain("50%");
    expect(stripped).toContain("60%");
    expect(stripped).toContain("\u2501");
    expect(stripped.length).toBe(24);
    vi.useRealTimers();
  });

  it("returns empty string at maxWidth 0", () => {
    expect(buildCodexUsageBar({ percentage: 50 }, { percentage: 60 }, mockTheme, 0)).toBe("");
  });

  it("does not throw at extremely narrow width (fallback branch)", () => {
    expect(() =>
      buildCodexUsageBar({ percentage: 50 }, { percentage: 60 }, mockTheme, 5),
    ).not.toThrow();
    const result = buildCodexUsageBar({ percentage: 50 }, { percentage: 60 }, mockTheme, 5);
    expect(typeof result).toBe("string");
  });
});

// ─── buildLine2 with Codex usage (3-zone layout) ─────────────────

describe("buildLine2 with codex-usage (3-zone layout)", () => {
  const codexUsage = (
    fiveHourPct: number,
    weeklyPct: number,
    fiveHourReset?: number,
    weeklyReset?: number,
  ) =>
    JSON.stringify({
      fiveHour: { percentage: fiveHourPct, resetTimeMs: fiveHourReset },
      weekly: { percentage: weeklyPct, resetTimeMs: weeklyReset },
    });

  const lensClean = () =>
    JSON.stringify({ prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" });

  it("renders all 3 zones (processes + lens + codex-usage) at width 120", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          ["pi-lens", lensClean()],
          ["codex-usage", codexUsage(80, 30)],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1]!;
    const line2Stripped = stripTags(line2);

    // Left zone: processes text (may compress since the dual codex bar is
    // wider than a single ZAI bar, leaving less room for the left zone)
    expect(line2Stripped).toContain("3 proc");
    // Center zone: lens check icons
    expect(line2).toContain("[success]\u2713[text]prettier");
    // Right zone: codex 5h / 7d bars
    expect(line2Stripped).toContain("5h");
    expect(line2Stripped).toContain("7d");
    expect(line2Stripped).toContain("80%");
    expect(line2Stripped).toContain("30%");
    // Width invariant
    expect(visibleWidth(line2)).toBe(120);
  });

  it("renders codex-usage bar right-aligned when it is the only status (no processes or lens)", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () => new Map<string, string>([["codex-usage", codexUsage(80, 30)]]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const strippedLine2 = stripTags(result[1]!);
    expect(strippedLine2).toContain("5h");
    expect(strippedLine2).toContain("80%");
    expect(visibleWidth(result[1]!)).toBe(120);
    // Right-aligned: leading whitespace before the bar content
    expect(strippedLine2).toMatch(/^\s+/);
  });

  it("codex-usage respects width for narrow terminal (width 30)", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () => new Map<string, string>([["codex-usage", codexUsage(80, 30)]]),
    };

    const result = renderFooterLine(30, mockTheme);

    expect(result.length).toBe(2);
    // Use stripTags().length because mockTheme produces [color] tags that
    // visibleWidth counts as visible chars (see test-utils.ts).
    expect(stripTags(result[1]!).length).toBeLessThanOrEqual(30);
    expect(stripTags(result[1]!)).toContain("80%");
  });

  it("codex-usage precedence: zai-usage wins when both are present", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["zai-usage", JSON.stringify({ percentage: 80 })],
          ["codex-usage", codexUsage(80, 30)],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const stripped = stripTags(result[1]!);
    // ZAI bar renders (quota label)
    expect(stripped).toContain("quota");
    expect(stripped).toContain("80%");
    // Codex 7d label is NOT rendered
    expect(stripped).not.toContain("7d");
  });

  it("backward compat: no usage statuses → original 2-zone behavior, no bars", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      onBranchChange: () => () => {},
      getAvailableProviderCount: () => 0,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          ["pi-lens", lensClean()],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const stripped = stripTags(result[1]!);
    expect(stripped).toContain("3 processes");
    expect(stripped).not.toContain("5h");
    expect(stripped).not.toContain("7d");
    expect(stripped).not.toContain("quota");
    expect(visibleWidth(result[1]!)).toBe(120);
  });
});

// ─── parseCwdStatus ──────────────────────────────────────────────

describe("parseCwdStatus", () => {
  it('returns { cwd } for valid JSON {"cwd":"~/projects/foo"}', () => {
    const input = JSON.stringify({ cwd: "~/projects/foo" });
    expect(parseCwdStatus(input)).toEqual({ cwd: "~/projects/foo" });
  });

  it("returns null for undefined", () => {
    expect(parseCwdStatus(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCwdStatus("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseCwdStatus("not-json")).toBeNull();
  });

  it("returns null for JSON without cwd key", () => {
    const input = JSON.stringify({ path: "/something" });
    expect(parseCwdStatus(input)).toBeNull();
  });

  it("returns null when cwd is not a string", () => {
    const input = JSON.stringify({ cwd: 123 });
    expect(parseCwdStatus(input)).toBeNull();
  });

  it("returns { cwd } for full absolute path", () => {
    const input = JSON.stringify({ cwd: "/home/user/projects" });
    expect(parseCwdStatus(input)).toEqual({ cwd: "/home/user/projects" });
  });
});

// ─── Pi-CWD Effective CWD Integration ────────────────────────────

describe("renderFooterLine with pi-cwd effective CWD", () => {
  it("uses pi-cwd effective CWD when status is present", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([["cwd", JSON.stringify({ cwd: "~/different/path" })]]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("~/different/path");
    // Should NOT contain the default currentCwd value
    expect(stripped).not.toContain("~/project");
  });

  it("falls back to currentCwd when pi-cwd status absent", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>(),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // currentCwd is /home/testuser/project → shortened to ~/project
    expect(stripped).toContain("~/project");
  });

  it("falls back to currentCwd when pi-cwd status is malformed", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>([["cwd", "not-json"]]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("~/project");
  });

  it("falls back to currentCwd when pi-cwd status cwd field is not a string", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>([["cwd", JSON.stringify({ cwd: 42 })]]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("~/project");
  });
});

// ─── Path Compression Integration ────────────────────────────────

describe("renderFooterLine with path compression", () => {
  it("long CWD path is compressed at narrow width", () => {
    (state as Record<string, unknown>).currentCwd =
      "/home/testuser/very/deeply/nested/directory/structure/path";
    mockCompressPathToWidth = (_path: string, _maxWidth: number): string => "~/v/d/n/d/s/path";

    const result = renderFooterLine(40, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("~/v/d/n/d/s/path");
  });

  it("short CWD path is not compressed", () => {
    // currentCwd is ~/project which is short enough for any reasonable width
    // mockCompressPathToWidth is identity by default
    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    expect(stripped).toContain("~/project");
  });

  it("compression not applied when pi-git status present", () => {
    const piGitJson = JSON.stringify({
      cwd: "~/project",
      branch: "main",
      insertions: 5,
      deletions: 2,
      addedCount: 0,
      modifiedCount: 1,
      deletedCount: 0,
    });
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map<string, string>([["pi-git", piGitJson]]),
    };
    // If compressPathToWidth is called, it would throw
    mockCompressPathToWidth = (): string => {
      throw new Error("compressPathToWidth should not be called when pi-git is present");
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // pi-git display is used (with bullet separators)
    expect(stripped).toContain("~/project");
    expect(stripped).toContain("(main)");
    expect(stripped).toContain("+5");
    expect(stripped).toContain("-2");
  });

  it("pi-cwd + pi-git coexistence: pi-cwd effective cwd overrides pi-git cwd", () => {
    const piGitJson = JSON.stringify({
      cwd: "~/original-project",
      branch: "feature",
      insertions: 10,
      deletions: 5,
      addedCount: 1,
      modifiedCount: 2,
      deletedCount: 0,
    });
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["cwd", JSON.stringify({ cwd: "~/other-project" })],
          ["pi-git", piGitJson],
        ]),
    };
    mockCompressPathToWidth = (): string => {
      throw new Error("compressPathToWidth should not be called when pi-git is present");
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // pi-cwd effective cwd overrides pi-git's cwd
    expect(stripped).toContain("~/other-project");
    // pi-git branch and diff info are still shown
    expect(stripped).toContain("(feature)");
    expect(stripped).toContain("+10");
    expect(stripped).toContain("-5");
    expect(stripped).toContain("1 new");
    expect(stripped).toContain("2 changed");
    // NOT the pi-git original cwd
    expect(stripped).not.toContain("~/original-project");
  });

  it("pi-git without pi-cwd status uses pi-git's own cwd", () => {
    const piGitJson = JSON.stringify({
      cwd: "~/project",
      branch: "feature",
      insertions: 0,
      deletions: 0,
      addedCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
    });
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map<string, string>([["pi-git", piGitJson]]),
    };
    mockCompressPathToWidth = (): string => {
      throw new Error("compressPathToWidth should not be called when pi-git is present");
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // pi-git's own cwd is used when no pi-cwd status present
    expect(stripped).toContain("~/project");
    expect(stripped).toContain("(feature)");
    expect(stripped).toContain("1 new");
  });

  it("pi-git with malformed pi-cwd status falls back to pi-git's own cwd", () => {
    const piGitJson = JSON.stringify({
      cwd: "~/project",
      branch: "feature",
      insertions: 5,
      deletions: 2,
      addedCount: 0,
      modifiedCount: 1,
      deletedCount: 0,
    });
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => "main",
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["cwd", "not-json"],
          ["pi-git", piGitJson],
        ]),
    };
    mockCompressPathToWidth = (): string => {
      throw new Error("compressPathToWidth should not be called when pi-git is present");
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]!);
    // Falls back to pi-git's cwd when pi-cwd status is malformed
    expect(stripped).toContain("~/project");
    expect(stripped).toContain("(feature)");
    expect(stripped).toContain("+5");
    expect(stripped).toContain("-2");
  });
});

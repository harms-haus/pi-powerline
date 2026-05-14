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
    if (count < 1000000) return Math.round(count / 1000) + "k";
    if (count < 10000000) return (count / 1000000).toFixed(1) + "M";
    return Math.round(count / 1000000) + "M";
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

import * as state from "../state";
import * as git from "../git";
import { renderFooterLine } from "../footer";

// Mock theme that wraps text with color tags for test assertions
const mockTheme = {
  fg: (color: string, text: string) => `[${color}]${text}`,
} as unknown as Theme;

// Helper to strip mock theme tags for content assertions
function stripTags(str: string): string {
  return str.replace(/\[(dim|accent|error|warning|success|muted)\]/g, "");
}

describe("renderFooterLine", () => {
  beforeEach(() => {
    // Reset all module-level state via mock
    (state as Record<string, unknown>).currentCwd = "/home/testuser/project";
    (state as Record<string, unknown>).currentCtx = undefined;
    (state as Record<string, unknown>).api = undefined;
    (state as Record<string, unknown>).footerDataProvider = undefined;
    (git as Record<string, unknown>).gitChanges = null;
  });

  afterEach(() => {
    // Full cleanup
    (state as Record<string, unknown>).currentCwd = undefined;
    (state as Record<string, unknown>).currentCtx = undefined;
    (state as Record<string, unknown>).api = undefined;
    (state as Record<string, unknown>).footerDataProvider = undefined;
    (git as Record<string, unknown>).gitChanges = null;
  });

  it("shows cwd with no branch, no git changes", () => {
    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]);
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
    } as unknown as ReadonlyFooterDataProvider;
    (git as Record<string, unknown>).gitChanges = { insertions: 10, deletions: 5 };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]);
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
    } as unknown as ExtensionContext;

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(1);
    const stripped = stripTags(result[0]);
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
    } as unknown as ExtensionContext;

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    // The line should contain error-colored percentage
    expect(result[0]).toContain("[error]");
    const stripped = stripTags(result[0]);
    expect(stripped).toContain("96%");
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
    } as unknown as ExtensionContext;

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(1);
    // The line should contain warning-colored percentage
    expect(result[0]).toContain("[warning]");
    const stripped = stripTags(result[0]);
    expect(stripped).toContain("75%");
  });

  it("truncates output when width is very narrow", () => {
    const result = renderFooterLine(10, mockTheme);

    expect(result.length).toBe(1);
    // With width=10, the output should be truncated to fit
    const visibleWidth = stripTags(result[0]).length;
    expect(visibleWidth).toBeLessThanOrEqual(10);
  });

  it("returns two lines when LSP/lint statuses are present", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-lsp", "0 errors"],
          ["pi-lint", "2 warnings"],
        ]),
    } as unknown as ReadonlyFooterDataProvider;

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]);
    expect(line2Stripped).toContain("LSP");
    expect(line2Stripped).toContain("Linter");
    expect(line2Stripped).toContain("0 errors");
    expect(line2Stripped).toContain("2 warnings");
  });
});

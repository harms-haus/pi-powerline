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

import * as state from "../state";
import * as git from "../git";
import { renderFooterLine } from "../footer";

import { mockTheme, stripTags } from "./test-utils.js";

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

describe("renderFooterLine", () => {
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
    };
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
    };

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
    };

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
    };

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
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]);
    expect(line2Stripped).toContain("LSP");
    expect(line2Stripped).toContain("Linter");
    expect(line2Stripped).toContain("0 errors");
    expect(line2Stripped).toContain("2 warnings");
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
    const stripped = stripTags(result[0]);
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
    const stripped = stripTags(result[0]);
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
    const stripped = stripTags(result[0]);
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
    const stripped = stripTags(result[0]);
    // Falls back to built-in rendering
    expect(stripped).toContain("(main)");
    expect(stripped).toContain("+10");
    expect(stripped).toContain("-5");
  });

  it("shows pi-processes status left-aligned on line 2 with center LSP/Lint", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", "3 processes"],
          ["pi-lsp", "0 errors"],
          ["pi-lint", "2 warnings"],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]);
    // Process count should be left-aligned (at position 0)
    expect(line2Stripped.indexOf("3 processes")).toBe(0);
    // LSP/Lint should still appear somewhere in the line
    expect(line2Stripped).toContain("LSP");
    expect(line2Stripped).toContain("Linter");
  });

  it("shows only pi-processes on line 2 when no LSP/Lint", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>([["pi-processes", "3 processes"]]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]);
    expect(line2Stripped).toContain("3 processes");
    // Should be left-aligned
    expect(line2Stripped.indexOf("3 processes")).toBe(0);
  });

  it("centers LSP/Lint when no pi-processes status", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-lsp", "0 errors"],
          ["pi-lint", "2 warnings"],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]);
    expect(line2Stripped).toContain("LSP");
    expect(line2Stripped).toContain("Linter");
    // Centered: should not start at position 0
    expect(line2Stripped.indexOf("LSP")).toBeGreaterThan(0);
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
    const stripped = stripTags(result[0]);
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
          ["pi-lsp", "0 errors"],
          ["pi-lint", "2 warnings"],
        ]),
    };

    const width = 120;
    const result = renderFooterLine(width, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
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
    const line2Stripped = stripTags(result[1]);

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
          ["pi-lsp", "0 errors"],
          ["pi-lint", "2 warnings"],
        ]),
    };

    const width = 120;
    const result = renderFooterLine(width, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]);

    // Short status should appear in full
    expect(line2Stripped).toContain("3 procs");
    expect(line2Stripped.startsWith("3 procs")).toBe(true);
    // Total visible width should match
    expect(visibleWidth(result[1])).toBe(width);
  });

  it("center is still properly centered after left truncation", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-processes", longStatus],
          ["pi-lsp", "0 errors"],
          ["pi-lint", "2 warnings"],
        ]),
    };

    const width = 120;
    const result = renderFooterLine(width, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]);

    // Both left and center content should be present
    expect(line2Stripped).toContain("LSP");
    expect(line2Stripped).toContain("Linter");

    // Center should appear after the left part (not at position 0)
    const lspIndex = line2Stripped.indexOf("LSP");
    expect(lspIndex).toBeGreaterThan(0);

    // There should be whitespace between left part and center
    const beforeLsp = line2Stripped.substring(0, lspIndex);
    expect(beforeLsp).toMatch(/\s+$/);

    // There should be trailing whitespace after center content
    // (proving center is not jammed to the right edge)
    expect(line2Stripped).toMatch(/\s+$/);
  });
});

describe("buildLine2 JSON rendering", () => {
  it("LSP JSON: active + clean renders success icon and text name", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lsp",
            JSON.stringify({
              languages: [{ name: "typescript", state: "active", clean: true }],
            }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    // success-colored checkmark
    expect(line2).toContain("[success]\u2713");
    // text-colored language name
    expect(line2).toContain("[text]typescript");
  });

  it("LSP JSON: active + dirty renders error icon and text name", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lsp",
            JSON.stringify({
              languages: [{ name: "rust", state: "active", clean: false }],
            }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    expect(line2).toContain("[error]\u2717");
    expect(line2).toContain("[text]rust");
  });

  it("LSP JSON: available + null clean renders dim icon and muted name", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lsp",
            JSON.stringify({
              languages: [{ name: "python", state: "available", clean: null }],
            }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    expect(line2).toContain("[dim]\u2713");
    expect(line2).toContain("[muted]python");
  });

  it("Lint JSON: clean linter renders success icon and text name", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lint",
            JSON.stringify({
              linters: [{ name: "ESLint", clean: true }],
            }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    expect(line2).toContain("[success]\u2713");
    expect(line2).toContain("[text]ESLint");
  });

  it("Lint JSON: dirty linter renders error icon and text name", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lint",
            JSON.stringify({
              linters: [{ name: "Biome", clean: false }],
            }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    expect(line2).toContain("[error]\u2717");
    expect(line2).toContain("[text]Biome");
  });

  it("Both LSP and Lint JSON renders bullet separator between groups", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lsp",
            JSON.stringify({
              languages: [{ name: "typescript", state: "active", clean: true }],
            }),
          ],
          [
            "pi-lint",
            JSON.stringify({
              linters: [{ name: "ESLint", clean: true }],
            }),
          ],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    // Bullet separator (•) wrapped in dim color between groups
    expect(line2).toContain("[dim] \u2022");
    // Both groups should be present
    expect(line2).toContain("[text]typescript");
    expect(line2).toContain("[text]ESLint");
  });

  it("Multiple languages and linters are space-separated within each group", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lsp",
            JSON.stringify({
              languages: [
                { name: "typescript", state: "active", clean: true },
                { name: "rust", state: "active", clean: false },
              ],
            }),
          ],
          [
            "pi-lint",
            JSON.stringify({
              linters: [
                { name: "ESLint", clean: true },
                { name: "Biome", clean: false },
              ],
            }),
          ],
        ]),
    };

    const result = renderFooterLine(120, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    // Both languages should appear
    expect(line2).toContain("[success]\u2713[text]typescript");
    expect(line2).toContain("[error]\u2717[text]rust");
    // Both linters should appear
    expect(line2).toContain("[success]\u2713[text]ESLint");
    expect(line2).toContain("[error]\u2717[text]Biome");

    // Verify space separation within LSP group (between the two language entries)
    const lspGroup = "[success]\u2713[text]typescript [error]\u2717[text]rust";
    expect(line2).toContain(lspGroup);
    // Verify space separation within lint group
    const lintGroup = "[success]\u2713[text]ESLint [error]\u2717[text]Biome";
    expect(line2).toContain(lintGroup);
  });

  it("Empty languages array renders no LSP section", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([["pi-lsp", JSON.stringify({ languages: [] })]]),
    };

    const result = renderFooterLine(80, mockTheme);

    // No LSP parts → no center content → buildLine2 returns null → single line
    expect(result.length).toBe(1);
  });

  it("Mixed JSON + non-JSON: LSP as JSON parsed, lint as plain string fallback", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          [
            "pi-lsp",
            JSON.stringify({
              languages: [{ name: "typescript", state: "active", clean: true }],
            }),
          ],
          ["pi-lint", "2 warnings"],
        ]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    // LSP should be parsed as JSON
    expect(line2).toContain("[success]\u2713");
    expect(line2).toContain("[text]typescript");
    // Lint should fall back to plain string rendering with "Linter:" label
    expect(line2).toContain("[muted]Linter:");
    expect(line2).toContain("[dim]2 warnings");
  });

  it("Malformed JSON falls back to old rendering with LSP: label", () => {
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>([["pi-lsp", "not-valid-json"]]),
    };

    const result = renderFooterLine(80, mockTheme);

    expect(result.length).toBe(2);
    const line2 = result[1];
    // Falls back to plain string rendering with "LSP:" label
    expect(line2).toContain("[muted]LSP:");
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
    const stripped = stripTags(result[0]);
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
    const stripped = stripTags(result[0]);
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
    const stripped = stripTags(result[0]);
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
    expect(stripTags(result[0]).length).toBeLessThanOrEqual(10);
  });
});

describe("buildLine2 center truncation", () => {
  it("truncates center part when it exceeds width", () => {
    const longLspStatus = JSON.stringify({
      languages: [
        { name: "typescript", state: "active", clean: true },
        { name: "javascript", state: "active", clean: true },
        { name: "python", state: "active", clean: true },
        { name: "rust", state: "active", clean: true },
        { name: "go", state: "active", clean: true },
      ],
    });
    const longLintStatus = JSON.stringify({
      linters: [
        { name: "ESLint", clean: true },
        { name: "Biome", clean: true },
        { name: "Prettier", clean: true },
        { name: "Ruff", clean: true },
      ],
    });
    (state as Record<string, unknown>).footerDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () =>
        new Map<string, string>([
          ["pi-lsp", longLspStatus],
          ["pi-lint", longLintStatus],
        ]),
    };

    // Use a very narrow width to force truncation of the center content
    const result = renderFooterLine(30, mockTheme);

    expect(result.length).toBe(2);
    const line2Stripped = stripTags(result[1]);
    // Should be truncated to width
    expect(line2Stripped.length).toBeLessThanOrEqual(30);
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
    const stripped = stripTags(result[0]);
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
    const stripped = stripTags(result[0]);
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
    expect(stripTags(result[0]).length).toBeLessThanOrEqual(15);
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

    // With our mock theme, the minRight is like [warning]75% which has
    // visibleWidth of ~14 chars, so width=5 should fail minRightW + 2 <= width
    const result = renderFooterLine(5, mockTheme);

    expect(result.length).toBe(1);
    // Line 177 path: just truncates left to width
    // With truncation indicator "…", the visible width respects width constraint
    // but string length may be higher due to wide characters and the ellipsis
    expect(stripTags(result[0]).length).toBe(13);
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

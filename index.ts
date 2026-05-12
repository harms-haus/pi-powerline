/**
 * Powerline Extension — Unified status bar for pi-coding-agent
 *
 * Replaces the built-in footer and individual extension status displays
 * with a centralized, purpose-designed layout.
 *
 * Above composer: todo count + active items (left), rpir phase (right)
 * Below composer: cwd + git branch + git changes (left), context + model (right)
 */

// ─── Imports ───────────────────────────────────────────────────────
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { isBashToolResult, isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ─── Closure State ─────────────────────────────────────────────────
let piRef: ExtensionAPI;
let currentCtx: ExtensionContext | undefined;
let tuiRef: TUI | undefined;
let footerDataProvider: ReadonlyFooterDataProvider | undefined;
let gitChanges: string = "";
let gitDiffTimer: ReturnType<typeof setTimeout> | undefined;
let gitDiffInFlight = false;

// ─── Helpers ───────────────────────────────────────────────────────
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return (count / 1000).toFixed(1) + "k";
  if (count < 1000000) return Math.round(count / 1000) + "k";
  if (count < 10000000) return (count / 1000000).toFixed(1) + "M";
  return Math.round(count / 1000000) + "M";
}

function shortenPath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function parseGitShortstat(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return "";

  const insertionMatch = trimmed.match(/(\d+) insertion/);
  const deletionMatch = trimmed.match(/(\d+) deletion/);

  const insertions = insertionMatch ? parseInt(insertionMatch[1], 10) : 0;
  const deletions = deletionMatch ? parseInt(deletionMatch[1], 10) : 0;

  if (insertions > 0 && deletions > 0) {
    return `+${insertions} -${deletions}`;
  } else if (insertions > 0) {
    return `+${insertions}`;
  } else if (deletions > 0) {
    return `-${deletions}`;
  }

  return "";
}

/**
 * Apply green/red coloring to git shortstat output like "+388 -245".
 * Each numeric portion is colored individually.
 */
function colorCodeGitChanges(changes: string, theme: Theme): string {
  const insertionMatch = changes.match(/^[+](\d+)/);
  const deletionMatch = changes.match(/-(\d+)$/);

  if (insertionMatch && deletionMatch) {
    // "+388 -245"
    return theme.fg("success", `+${insertionMatch[1]}`) + " " + theme.fg("error", `-${deletionMatch[1]}`);
  } else if (insertionMatch) {
    // "+388" only
    return theme.fg("success", changes);
  } else if (deletionMatch) {
    // "-245" only
    return theme.fg("error", changes);
  }
  // Fallback
  return theme.fg("dim", changes);
}

// ─── Git Diff ──────────────────────────────────────────────────────
async function refreshGitDiff(): Promise<void> {
  const cwd = currentCtx?.cwd;
  if (!cwd || gitDiffInFlight) return;
  gitDiffInFlight = true;

  try {
    const result = await piRef.exec("git", ["diff", "--shortstat", "HEAD"], {
      cwd,
      timeout: 5000,
    });

    if (result.code === 0) {
      gitChanges = parseGitShortstat(result.stdout || "");
    } else {
      gitChanges = "";
    }
  } catch {
    gitChanges = "";
  } finally {
    gitDiffInFlight = false;
  }

  requestRefresh();
}

function debouncedRefreshGitDiff(): void {
  if (gitDiffTimer) clearTimeout(gitDiffTimer);
  gitDiffTimer = setTimeout(() => {
    gitDiffTimer = undefined;
    refreshGitDiff();
  }, 500);
}

// ─── Refresh ───────────────────────────────────────────────────────
function requestRefresh(): void {
  tuiRef?.requestRender();
}

// ─── Footer Renderer ───────────────────────────────────────────────
function buildLspLintLine(
  width: number,
  theme: Theme,
  statuses: ReadonlyMap<string, string> | undefined,
): string | null {
  if (!statuses) return null;

  const lspStatus = statuses.get("pi-lsp");
  const lintStatus = statuses.get("pi-lint");

  const parts: string[] = [];
  if (lspStatus) {
    parts.push(theme.fg("muted", "LSP:") + " " + theme.fg("dim", lspStatus));
  }
  if (lintStatus) {
    parts.push(theme.fg("muted", "Linter:") + " " + theme.fg("dim", lintStatus));
  }

  if (parts.length === 0) return null;

  const str = parts.join(theme.fg("dim", " \u2022 "));
  const strW = visibleWidth(str);
  if (strW <= width) {
    const pad = Math.max(0, Math.floor((width - strW) / 2));
    return " ".repeat(pad) + str;
  }
  return truncateToWidth(str, width, "");
}

function renderFooterLine(width: number, theme: Theme): string[] {
  // Left side: cwd + branch + git changes
  const cwdDisplay = shortenPath(currentCtx?.cwd || "");
  const branch = footerDataProvider?.getGitBranch?.() ?? null;
  const leftParts: string[] = [];
  leftParts.push(theme.fg("dim", cwdDisplay));
  if (branch) {
    leftParts.push(theme.fg("accent", `(${branch})`));
  }
  if (gitChanges) {
    leftParts.push(colorCodeGitChanges(gitChanges, theme));
  }
  const left = leftParts.join(" ");

  // Right side: context usage + model
  const usage = currentCtx?.getContextUsage?.();
  const tokens = usage?.tokens ?? null;
  const contextWindow = usage?.contextWindow ?? currentCtx?.model?.contextWindow ?? 0;
  const percent = usage?.percent ?? null;

  let contextDisplay = "";
  if (tokens !== null && percent !== null) {
    contextDisplay = `${formatTokens(tokens)}/${formatTokens(contextWindow)} ${percent.toFixed(1)}%`;
  } else if (tokens !== null) {
    contextDisplay = `${formatTokens(tokens)}/${formatTokens(contextWindow)}`;
  } else if (tokens === null) {
    contextDisplay = `?/${formatTokens(contextWindow)}`;
  }

  let contextStr = contextDisplay;
  if (percent !== null) {
    if (percent > 90) {
      contextStr = theme.fg("error", contextDisplay);
    } else if (percent > 70) {
      contextStr = theme.fg("warning", contextDisplay);
    }
  }

  const isContextWarning = percent !== null && percent > 70;

  const model = currentCtx?.model;
  const modelDisplay = model?.id ?? "no-model";
  const provider = model?.provider;
  const modelRegistry = currentCtx?.modelRegistry;
  let providerName = "";
  if (provider) {
    if (modelRegistry) {
      providerName = modelRegistry.getProviderDisplayName(provider);
    } else {
      providerName = provider;
    }
  }

  const thinkingLevel = piRef?.getThinkingLevel?.();
  let modelStr = "";
  if (providerName) {
    modelStr = theme.fg("muted", `(${providerName}) `);
  }
  modelStr += theme.fg("dim", modelDisplay);
  if (model?.reasoning && thinkingLevel) {
    modelStr += theme.fg("dim", ` \u2022 ${thinkingLevel}`);
  }

  const right = contextStr + " " + modelStr;

  // Compose line 1 with left/right alignment
  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);

  let line1: string;
  if (leftW + 2 + rightW <= width) {
    const pad = " ".repeat(width - leftW - rightW);
    line1 = left + pad + right;
  } else if (width - leftW - 2 > 0) {
    const availableForRight = width - leftW - 2;
    const truncatedRight = truncateToWidth(right, availableForRight, "");
    const actualRightW = visibleWidth(truncatedRight);
    const pad = " ".repeat(width - leftW - actualRightW);
    line1 = left + pad + truncatedRight;
  } else if (isContextWarning) {
    const minRight = percent! > 90
      ? theme.fg("error", `${percent.toFixed(0)}%`)
      : theme.fg("warning", `${percent.toFixed(0)}%`);
    const minRightW = visibleWidth(minRight);
    if (minRightW + 2 <= width) {
      const truncatedLeft = truncateToWidth(left, width - minRightW - 2, "");
      const truncatedLeftW = visibleWidth(truncatedLeft);
      line1 = truncatedLeft + " ".repeat(width - truncatedLeftW - minRightW) + minRight;
    } else {
      line1 = truncateToWidth(left, width, "");
    }
  } else {
    line1 = truncateToWidth(left, width, "");
  }

  // Line 2 (optional): LSP and Lint status, centered
  const statuses = footerDataProvider?.getExtensionStatuses?.();
  const line2 = buildLspLintLine(width, theme, statuses);

  return line2 ? [line1, line2] : [line1];
}

// ─── Above-Editor Widget Renderer ─────────────────────────────────
function renderAboveWidget(width: number, theme: Theme): string[] {
  const statuses = footerDataProvider?.getExtensionStatuses?.();
  if (!statuses) return [];

  const tillDoneStatus = statuses.get("till-done");
  const tillDoneActiveRaw = statuses.get("till-done-active");
  const workflowStatus = statuses.get("workflow");
  const rpirStatus = statuses.get("rpir-workflow");

  const hasTodoStatus = tillDoneStatus !== undefined;
  const hasActiveItems = tillDoneActiveRaw !== undefined && tillDoneActiveRaw.length > 0;
  const hasWorkflow = workflowStatus !== undefined;
  const hasRpir = rpirStatus !== undefined;

  if (!hasTodoStatus && !hasActiveItems && !hasWorkflow && !hasRpir) return [];

  const lines: string[] = [];

  // ── Section 1: Active todo items (top) ──
  if (hasActiveItems) {
    const activeItems = tillDoneActiveRaw!.split("\n");
    for (const item of activeItems) {
      const themed = theme.fg("warning", "\u25cf ") + theme.fg("accent", item);
      lines.push(truncateToWidth(themed, width, ""));
    }
  }

  // ── Section 2: Progress line (bottom, closest to composer) ──
  // Left: todo progress (till-done status, e.g., "📋 5/11")
  // Right: workflow status (pi-workflows or rpir-workflow)
  const leftRaw = hasTodoStatus ? stripAnsi(tillDoneStatus) : "";
  const leftStyled = hasTodoStatus ? tillDoneStatus : "";

  // Prefer pi-workflows status for right side; fall back to rpir-workflow
  const rightRaw = hasWorkflow ? stripAnsi(workflowStatus)
    : hasRpir ? stripAnsi(rpirStatus)
    : "";
  const rightStyled = hasWorkflow ? workflowStatus
    : hasRpir ? rpirStatus
    : "";

  if (leftRaw || rightRaw) {
    if (leftRaw && rightRaw) {
      const leftW = visibleWidth(leftRaw);
      const rightW = visibleWidth(rightRaw);
      if (leftW + 2 + rightW <= width) {
        lines.push(leftStyled + " ".repeat(width - leftW - rightW) + rightStyled);
      } else if (leftW + 3 <= width) {
        const sep = theme.fg("dim", " │ ");
        lines.push(leftStyled + sep + truncateToWidth(rightStyled, width - leftW - 3, ""));
      } else {
        lines.push(truncateToWidth(leftStyled + " " + rightStyled, width, ""));
      }
    } else if (leftRaw) {
      lines.push(leftStyled);
    } else if (rightRaw) {
      lines.push(" ".repeat(Math.max(0, width - visibleWidth(rightRaw))) + rightStyled);
    }
  }

  return lines;
}

// ─── UI Setup & Cleanup ────────────────────────────────────────────
function setupUI(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  // Custom footer
  ctx.ui.setFooter((tui, theme, footerData) => {
    tuiRef = tui;
    footerDataProvider = footerData;
    const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose() {
        unsubBranch();
        if (gitDiffTimer) {
          clearTimeout(gitDiffTimer);
          gitDiffTimer = undefined;
        }
      },
      invalidate() {},
      render(w: number): string[] {
        return renderFooterLine(w, theme);
      },
    };
  });

  // Above-editor widget
  ctx.ui.setWidget("powerline-above", (tui, theme) => ({
    dispose() {},
    invalidate() {},
    render(w: number): string[] {
      return renderAboveWidget(w, theme);
    },
  }), { placement: "aboveEditor" });
}

function cleanup(): void {
  if (gitDiffTimer) {
    clearTimeout(gitDiffTimer);
    gitDiffTimer = undefined;
  }
  gitChanges = "";
  currentCtx = undefined;
  tuiRef = undefined;
  footerDataProvider = undefined;
}

// ─── Extension Entry Point ─────────────────────────────────────────
export default function (pi: ExtensionAPI): void {
  piRef = pi;

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    if (gitDiffTimer) {
      clearTimeout(gitDiffTimer);
      gitDiffTimer = undefined;
    }
    setupUI(ctx);
    refreshGitDiff();
  });

  pi.on("session_tree", async (_event, ctx) => {
    currentCtx = ctx;
    if (gitDiffTimer) {
      clearTimeout(gitDiffTimer);
      gitDiffTimer = undefined;
    }
    refreshGitDiff();
  });

  pi.on("session_shutdown", async () => {
    cleanup();
  });

  pi.on("turn_end", async (_event, ctx) => {
    currentCtx = ctx;
    refreshGitDiff();
  });

  pi.on("model_select", async (_event, ctx) => {
    currentCtx = ctx;
    requestRefresh();
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    currentCtx = ctx;
    requestRefresh();
  });

  pi.on("tool_result", async (event, ctx) => {
    currentCtx = ctx;
    if (isWriteToolResult(event) || isEditToolResult(event) || isBashToolResult(event)) {
      debouncedRefreshGitDiff();
      // debouncedRefreshGitDiff calls requestRefresh() after completing, so skip here
    }
  });

  pi.on("message_end", async (_event, ctx) => {
    currentCtx = ctx;
    requestRefresh();
  });
}

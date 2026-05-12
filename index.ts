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
    leftParts.push(theme.fg("dim", gitChanges));
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
  const thinkingLevel = piRef?.getThinkingLevel?.();
  let modelStr = modelDisplay;
  if (model?.reasoning && thinkingLevel) {
    modelStr += ` \u2022 ${thinkingLevel}`;
  }
  modelStr = theme.fg("dim", modelStr);

  const right = contextStr + " " + modelStr;

  // Compose line with left/right alignment
  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);

  if (leftW + 2 + rightW <= width) {
    const pad = " ".repeat(width - leftW - rightW);
    return [left + pad + right];
  } else if (width - leftW - 2 > 0) {
    const availableForRight = width - leftW - 2;
    const truncatedRight = truncateToWidth(right, availableForRight, "");
    const actualRightW = visibleWidth(truncatedRight);
    const pad = " ".repeat(width - leftW - actualRightW);
    return [left + pad + truncatedRight];
  } else if (isContextWarning) {
    // Preserve context warning even when left side must be truncated
    const minRight = percent! > 90
      ? theme.fg("error", `${percent.toFixed(0)}%`)
      : theme.fg("warning", `${percent.toFixed(0)}%`);
    const minRightW = visibleWidth(minRight);
    if (minRightW + 2 <= width) {
      const truncatedLeft = truncateToWidth(left, width - minRightW - 2, "");
      const truncatedLeftW = visibleWidth(truncatedLeft);
      return [truncatedLeft + " ".repeat(width - truncatedLeftW - minRightW) + minRight];
    }
    return [truncateToWidth(left, width, "")];
  } else {
    return [truncateToWidth(left, width, "")];
  }
}

// ─── Above-Editor Widget Renderer ─────────────────────────────────
function renderAboveWidget(width: number, theme: Theme): string[] {
  const statuses = footerDataProvider?.getExtensionStatuses?.();
  if (!statuses) return [];

  const tillDoneStatus = statuses.get("till-done");
  const tillDoneActiveRaw = statuses.get("till-done-active");
  const rpirStatus = statuses.get("rpir-workflow");

  const hasTodoStatus = tillDoneStatus !== undefined;
  const hasActiveItems = tillDoneActiveRaw !== undefined && tillDoneActiveRaw.length > 0;
  const hasRpirStatus = rpirStatus !== undefined;

  if (!hasTodoStatus && !hasActiveItems && !hasRpirStatus) return [];

  const lines: string[] = [];

  // Line 1: todo count (left) + rpir phase (right)
  const leftRaw = hasTodoStatus ? stripAnsi(tillDoneStatus) : "";
  const right = hasRpirStatus ? stripAnsi(rpirStatus) : "";

  if (leftRaw && right) {
    const leftW = visibleWidth(leftRaw);
    const rightW = visibleWidth(right);
    if (leftW + 2 + rightW <= width) {
      lines.push(leftRaw + " ".repeat(width - leftW - rightW) + right);
    } else if (leftW + 3 <= width) {
      const sep = theme.fg("dim", " │ ");
      lines.push(leftRaw + sep + truncateToWidth(right, width - leftW - 3, ""));
    } else {
      lines.push(truncateToWidth(leftRaw + " " + right, width, ""));
    }
  } else if (leftRaw) {
    lines.push(leftRaw);
  } else if (right) {
    lines.push(" ".repeat(Math.max(0, width - visibleWidth(right))) + right);
  }

  // Active item lines
  if (hasActiveItems) {
    const activeItems = tillDoneActiveRaw!.split("\n");
    for (const item of activeItems) {
      const themed = theme.fg("warning", "\u25cf ") + theme.fg("accent", item);
      lines.push(truncateToWidth(themed, width, ""));
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

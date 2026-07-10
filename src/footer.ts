import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { currentCwd, currentCtx, api, footerDataProvider } from "./state";
import { gitChanges, colorCodeGitChanges } from "./git";
import type { GitDiffStat } from "./git";
import { alignLeftRight, formatTokens, shortenPath } from "./helpers";
import { compressPathToWidth } from "./path-compression.js";

type CheckStatus = "pending" | "running" | "clean" | "issues" | "error" | "skipped";

interface LensStatusPayload {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
}

interface ZaiUsagePayload {
  percentage: number;
  resetTimeMs?: number;
}

interface CodexUsageWindow {
  percentage: number;
  resetTimeMs?: number;
}

interface CodexUsagePayload {
  fiveHour: CodexUsageWindow;
  weekly: CodexUsageWindow;
}

const CONTEXT_WARNING_THRESHOLD = 70;
const CONTEXT_CRITICAL_THRESHOLD = 90;

// ─── Pi-Git Status Types & Parsing ──────────────────────────────

interface PiGitStatus {
  cwd: string;
  branch: string;
  insertions: number;
  deletions: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
}

function optNum(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function parsePiGitStatus(raw: string): PiGitStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.cwd !== "string" || typeof obj.branch !== "string") return null;
  return {
    cwd: obj.cwd,
    branch: obj.branch,
    insertions: optNum(obj.insertions),
    deletions: optNum(obj.deletions),
    addedCount: optNum(obj.addedCount),
    modifiedCount: optNum(obj.modifiedCount),
    deletedCount: optNum(obj.deletedCount),
  };
}

// ─── Cwd Status Parsing ──────────────────────────────────────────

export function parseCwdStatus(raw: string | undefined): { cwd: string } | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.cwd !== "string") return null;
  return { cwd: obj.cwd };
}

// ─── Left Side Builders ──────────────────────────────────────────

function buildFallbackLeftSide(
  cwdDisplay: string,
  branch: string | null,
  changes: GitDiffStat | null,
  theme: Theme,
): string {
  const parts: string[] = [];
  parts.push(theme.fg("dim", cwdDisplay));
  if (branch) parts.push(theme.fg("accent", `(${branch})`));
  if (changes) parts.push(colorCodeGitChanges(changes, theme));
  return parts.join(" ");
}

/**
 * Build the left side string with CWD path compression.
 * Resolves base CWD from pi-cwd status or currentCwd,
 * computes available width, compresses if needed, and
 * builds the full left-side string directly.
 */
function buildCompressedLeftSide(
  cwdStatus: { cwd: string } | null,
  branch: string | null,
  changes: GitDiffStat | null,
  contextStr: string,
  modelStr: string,
  width: number,
  theme: Theme,
): string {
  const baseCwd = cwdStatus?.cwd ?? shortenPath(currentCwd || "");

  const rightStr = contextStr + " " + modelStr;
  const rightWidth = visibleWidth(rightStr);

  const nonCwdParts: string[] = [];
  if (branch) nonCwdParts.push(theme.fg("accent", `(${branch})`));
  if (changes) nonCwdParts.push(colorCodeGitChanges(changes, theme));
  const nonCwdStr = nonCwdParts.join(" ");
  const nonCwdWidth = nonCwdParts.length > 0 ? visibleWidth(nonCwdStr) + 1 : 0;

  const maxCwdWidth = Math.max(0, width - rightWidth - 2 - nonCwdWidth);
  const cwdDisplay = compressPathToWidth(baseCwd, maxCwdWidth);

  return buildFallbackLeftSide(cwdDisplay, branch, changes, theme);
}

function buildPiGitLeftSide(status: PiGitStatus, theme: Theme): string {
  const locationParts: string[] = [];
  locationParts.push(theme.fg("dim", status.cwd));
  locationParts.push(theme.fg("accent", `(${status.branch})`));
  const location = locationParts.join(" ");

  const groups: string[] = [location];

  const diffParts: string[] = [];
  if (status.insertions > 0) diffParts.push(theme.fg("success", `+${status.insertions}`));
  if (status.deletions > 0) diffParts.push(theme.fg("error", `-${status.deletions}`));
  if (diffParts.length > 0) groups.push(diffParts.join(" "));

  const countParts: string[] = [];
  if (status.addedCount > 0) countParts.push(theme.fg("success", `${status.addedCount} new`));
  if (status.modifiedCount > 0)
    countParts.push(theme.fg("warning", `${status.modifiedCount} changed`));
  if (status.deletedCount > 0) countParts.push(theme.fg("error", `${status.deletedCount} deleted`));
  if (countParts.length > 0) groups.push(countParts.join(theme.fg("dim", ", ")));

  return groups.join(theme.fg("dim", " \u2022 "));
}

// ─── Right Side Builders ─────────────────────────────────────────

function buildContextDisplay(
  tokens: number | null,
  contextWindow: number,
  percent: number | null,
  theme: Theme,
): string {
  // Build the token/window portion (never colored)
  let tokenPart: string;
  if (tokens !== null) {
    tokenPart = `${formatTokens(tokens)}/${formatTokens(contextWindow)}`;
  } else {
    tokenPart = `?/${formatTokens(contextWindow)}`;
  }

  if (percent === null) {
    return tokenPart;
  }

  // Build the percentage portion (conditionally colored)
  const percentStr = percent.toFixed(1) + "%";
  let coloredPercent: string;
  if (percent > CONTEXT_CRITICAL_THRESHOLD) {
    coloredPercent = theme.fg("error", percentStr);
  } else if (percent > CONTEXT_WARNING_THRESHOLD) {
    coloredPercent = theme.fg("warning", percentStr);
  } else {
    coloredPercent = percentStr;
  }

  return tokenPart + " " + coloredPercent;
}

function buildModelDisplay(
  modelId: string | undefined,
  provider: string | undefined,
  hasReasoning: boolean | undefined,
  modelRegistry: { getProviderDisplayName(provider: string): string } | undefined,
  thinkingLevel: string | undefined,
  theme: Theme,
): string {
  const modelDisplay = modelId ?? "no-model";
  let providerName = "";
  if (provider) {
    if (modelRegistry) {
      providerName = modelRegistry.getProviderDisplayName(provider);
    } else {
      providerName = provider;
    }
  }

  let modelStr = "";
  if (providerName) {
    modelStr = theme.fg("muted", `(${providerName}) `);
  }
  modelStr += theme.fg("dim", modelDisplay);
  if (hasReasoning && thinkingLevel) {
    modelStr += theme.fg("dim", ` \u2022 ${thinkingLevel}`);
  }
  return modelStr;
}

// ─── Line 1 Composition ─────────────────────────────────────────

function buildLine1(left: string, contextStr: string, modelStr: string, width: number): string {
  const right = contextStr + " " + modelStr;
  return alignLeftRight(left, right, width);
}

// ─── ZAI Usage Bar ──────────────────────────────────────────────

export function parseZaiUsageStatus(raw: string | undefined): ZaiUsagePayload | null {
  if (raw === undefined || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.percentage !== "number" || !isFinite(obj.percentage)) return null;
  if (obj.percentage < 0) return null;
  const percentage = obj.percentage;
  let resetTimeMs: number | undefined;
  if (obj.resetTimeMs !== undefined) {
    if (typeof obj.resetTimeMs !== "number") return null;
    resetTimeMs = obj.resetTimeMs;
  }
  return { percentage, resetTimeMs };
}

export function formatResetTime(resetTimeMs: number): string {
  const remaining = Math.max(0, resetTimeMs - Date.now());
  if (remaining === 0) return "";
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours >= 1) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes >= 1) {
    return `${minutes}m`;
  }
  return "<1m";
}

export function formatPercentage(pct: number): string {
  if (pct === Math.floor(pct)) {
    return pct.toFixed(0) + "%";
  }
  return pct.toFixed(1) + "%";
}

/**
 * Build the raw progress-bar characters for a consumed-quota percentage.
 * The bar fills left-to-right as the consumed percentage grows. Width is
 * parameterized so both the single ZAI bar (width 12) and the dual Codex
 * bars can share identical fill logic.
 */
function buildProgressBarChars(percentage: number, barWidth: number): string {
  const filled = Math.max(0, Math.min(barWidth, Math.round((percentage / 100) * barWidth)));
  if (percentage === 0) {
    return "\u2500".repeat(barWidth);
  }
  if (percentage >= 100) {
    return "\u2501".repeat(barWidth);
  }
  if (filled === 0) {
    return "\u2578" + "\u2500".repeat(barWidth - 1);
  }
  return "\u2501".repeat(filled - 1) + "\u2578" + "\u2500".repeat(barWidth - filled);
}

/**
 * Shared consumed-quota color thresholds used by both ZAI and Codex bars:
 * > 90 → error, > 70 → warning, otherwise muted.
 */
function quotaPercentColor(percentage: number): "error" | "warning" | "muted" {
  return percentage > 90 ? "error" : percentage > 70 ? "warning" : "muted";
}

export function buildZaiUsageBar(
  percentage: number,
  resetTimeMs: number | undefined,
  theme: Theme,
): string {
  const BAR_WIDTH = 12;
  const bar = buildProgressBarChars(percentage, BAR_WIDTH);
  const percentColor = quotaPercentColor(percentage);
  let result =
    theme.fg("muted", "quota ") +
    theme.fg("muted", bar) +
    " " +
    theme.fg(percentColor, formatPercentage(percentage));
  if (resetTimeMs !== undefined && resetTimeMs > 0) {
    result += " " + theme.fg("muted", formatResetTime(resetTimeMs));
  }
  return result;
}

// ─── Codex Usage (5h / 7d consumed-quota bars) ──────────────────

export function parseCodexUsageStatus(raw: string | undefined): CodexUsagePayload | null {
  if (raw === undefined || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const fiveHour = parseCodexUsageWindow(obj.fiveHour);
  const weekly = parseCodexUsageWindow(obj.weekly);
  if (!fiveHour || !weekly) return null;
  return { fiveHour, weekly };
}

function parseCodexUsageWindow(value: unknown): CodexUsageWindow | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.percentage !== "number" || !isFinite(obj.percentage)) return null;
  if (obj.percentage < 0) return null;
  const percentage = obj.percentage;
  let resetTimeMs: number | undefined;
  if (obj.resetTimeMs !== undefined) {
    if (typeof obj.resetTimeMs !== "number") return null;
    resetTimeMs = obj.resetTimeMs;
  }
  return { percentage, resetTimeMs };
}

/**
 * A single labeled consumed-quota segment (e.g. "5h \u2501\u2501\u2578\u2500 24% 1h 30m").
 * Returns both the themed string and its exact visible (tag-stripped) width so
 * the caller can lay out two windows within a width budget without relying on
 * the ANSI-aware visibleWidth() (which over-counts mock theme tags in tests).
 */
function buildCodexWindowSegment(
  window: CodexUsageWindow,
  label: string,
  barWidth: number,
  showReset: boolean,
  theme: Theme,
): { text: string; width: number } {
  const pctStr = formatPercentage(window.percentage);
  const color = quotaPercentColor(window.percentage);

  let text: string;
  let width: number;
  if (barWidth > 0) {
    const bar = buildProgressBarChars(window.percentage, barWidth);
    text = theme.fg("muted", label + " ") + theme.fg("muted", bar) + " " + theme.fg(color, pctStr);
    width = label.length + 1 + barWidth + 1 + pctStr.length;
  } else {
    text = theme.fg("muted", label + " ") + theme.fg(color, pctStr);
    width = label.length + 1 + pctStr.length;
  }

  if (showReset && window.resetTimeMs !== undefined && window.resetTimeMs > 0) {
    const resetStr = formatResetTime(window.resetTimeMs);
    if (resetStr !== "") {
      text += " " + theme.fg("muted", resetStr);
      width += 1 + resetStr.length;
    }
  }
  return { text, width };
}

/**
 * Build a width-safe dual consumed-quota bar for the Codex 5-hour and weekly
 * (7-day) windows. The two windows are separated by two spaces. Rendering
 * degrades gracefully as `maxWidth` shrinks: first reset times are dropped,
 * then the bar width is reduced toward 0, and finally the bars are omitted
 * entirely (labels + percentages only). The returned visible width never
 * exceeds `maxWidth`.
 */
export function buildCodexUsageBar(
  fiveHour: CodexUsageWindow,
  weekly: CodexUsageWindow,
  theme: Theme,
  maxWidth: number,
): string {
  const MAX_BAR_WIDTH = 8;
  const SEP = "  ";
  const budget = Math.max(0, maxWidth);

  const join = (a: { text: string; width: number }, b: { text: string; width: number }): string =>
    a.text + SEP + b.text;

  // 1. Full: bars + percentages + reset countdowns, shrinking bar width.
  for (let barWidth = MAX_BAR_WIDTH; barWidth >= 1; barWidth--) {
    const a = buildCodexWindowSegment(fiveHour, "5h", barWidth, true, theme);
    const b = buildCodexWindowSegment(weekly, "7d", barWidth, true, theme);
    if (a.width + SEP.length + b.width <= budget) return join(a, b);
  }

  // 2. Drop reset countdowns, keep shrinking bars.
  for (let barWidth = MAX_BAR_WIDTH; barWidth >= 1; barWidth--) {
    const a = buildCodexWindowSegment(fiveHour, "5h", barWidth, false, theme);
    const b = buildCodexWindowSegment(weekly, "7d", barWidth, false, theme);
    if (a.width + SEP.length + b.width <= budget) return join(a, b);
  }

  // 3. No bars: labels + percentages (with reset if it fits).
  const aReset = buildCodexWindowSegment(fiveHour, "5h", 0, true, theme);
  const bReset = buildCodexWindowSegment(weekly, "7d", 0, true, theme);
  if (aReset.width + SEP.length + bReset.width <= budget) return join(aReset, bReset);

  // 4. No bars, no reset: labels + percentages only.
  const aMin = buildCodexWindowSegment(fiveHour, "5h", 0, false, theme);
  const bMin = buildCodexWindowSegment(weekly, "7d", 0, false, theme);
  const minimal = join(aMin, bMin);
  if (aMin.width + SEP.length + bMin.width <= budget) return minimal;

  // 5. Last resort: truncate to the budget. truncateToWidth is ANSI-aware in
  // production; this branch is only reachable at extremely narrow widths.
  return truncateToWidth(minimal, budget, "");
}

// ─── Line 2 Builders ─────────────────────────────────────────────

function checkStatusIcon(status: CheckStatus): {
  icon: string;
  color: "success" | "error" | "warning" | "dim";
} {
  switch (status) {
    case "clean":
      return { icon: "\u2713", color: "success" };
    case "issues":
      return { icon: "\u2717", color: "error" };
    case "error":
      return { icon: "\u26A0", color: "error" };
    case "running":
      return { icon: "\u27F3", color: "warning" };
    case "pending":
      return { icon: "\u25CB", color: "dim" };
    case "skipped":
      return { icon: "\u2014", color: "dim" };
    default:
      return { icon: "?", color: "dim" };
  }
}

function parseLensStatus(raw: string, theme: Theme): string[] {
  const parts: string[] = [];
  try {
    const payload = JSON.parse(raw) as LensStatusPayload;
    const checks: [string, CheckStatus][] = [
      ["prettier", payload.prettier],
      ["linters", payload.linters],
      ["lsp", payload.lsp],
      ["tsc", payload.tsc],
    ];
    for (const [label, status] of checks) {
      const { icon, color } = checkStatusIcon(status);
      parts.push(theme.fg(color, icon) + theme.fg("text", label));
    }
  } catch (error: unknown) {
    console.error("[pi-powerline] Lens parse error:", error);
    parts.push(theme.fg("muted", "Lens:") + " " + theme.fg("dim", raw));
  }
  return parts;
}

function buildCenteredLine(centerPart: string, width: number): string {
  const strW = visibleWidth(centerPart);
  if (strW <= width) {
    const pad = Math.max(0, Math.floor((width - strW) / 2));
    return " ".repeat(pad) + centerPart + " ".repeat(width - pad - strW);
  }
  const truncated = truncateToWidth(centerPart, width, "…");
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export function buildThreeZoneLine(
  leftPart: string,
  centerPart: string,
  rightPart: string,
  width: number,
): string {
  const rightW = visibleWidth(rightPart);
  const gap = 2;
  const availableWidth = Math.max(0, width - rightW - gap);

  let leftCenterContent: string;
  if (!leftPart && !centerPart) {
    leftCenterContent = " ".repeat(availableWidth);
  } else if (!leftPart) {
    leftCenterContent = buildCenteredLine(centerPart, availableWidth);
  } else if (!centerPart) {
    leftCenterContent = leftPart + " ".repeat(Math.max(0, availableWidth - visibleWidth(leftPart)));
  } else {
    const maxLeftW = Math.floor(availableWidth / 3);
    let leftW = visibleWidth(leftPart);
    let adjustedLeft = leftPart;
    if (leftW > maxLeftW) {
      adjustedLeft = truncateToWidth(leftPart, maxLeftW, "…");
      leftW = visibleWidth(adjustedLeft);
    }
    const centerW = visibleWidth(centerPart);
    const remainingWidth = availableWidth - leftW;
    if (centerW <= remainingWidth) {
      const centerPad = Math.max(0, Math.floor((remainingWidth - centerW) / 2));
      const rightPad = Math.max(0, availableWidth - leftW - centerPad - centerW);
      leftCenterContent = adjustedLeft + " ".repeat(centerPad) + centerPart + " ".repeat(rightPad);
    } else {
      const truncated = truncateToWidth(centerPart, remainingWidth, "…");
      const rightPad = Math.max(0, availableWidth - leftW - visibleWidth(truncated));
      leftCenterContent = adjustedLeft + truncated + " ".repeat(rightPad);
    }
  }

  // Ensure leftCenterContent is exactly availableWidth visible chars
  const lcW = visibleWidth(leftCenterContent);
  const line =
    leftCenterContent + " ".repeat(Math.max(0, availableWidth - lcW)) + " ".repeat(gap) + rightPart;
  // Pad to exact width
  const lineW = visibleWidth(line);
  if (lineW < width) {
    return line + " ".repeat(width - lineW);
  }
  return line;
}

function buildLine2(
  width: number,
  theme: Theme,
  statuses: ReadonlyMap<string, string> | undefined,
): string | null {
  if (!statuses) return null;

  const processStatus = statuses.get("pi-processes");
  const lensStatusRaw = statuses.get("pi-lens");

  const leftPart = processStatus ? theme.fg("muted", processStatus) : "";
  const lensParts = lensStatusRaw ? parseLensStatus(lensStatusRaw, theme) : [];

  const centerPart = lensParts.length > 0 ? lensParts.join(" ") : "";

  // Check for ZAI usage status
  const zaiPayload = parseZaiUsageStatus(statuses.get("zai-usage"));
  if (zaiPayload) {
    const rightPart = buildZaiUsageBar(zaiPayload.percentage, zaiPayload.resetTimeMs, theme);
    return buildThreeZoneLine(leftPart, centerPart, rightPart, width);
  }

  // Check for Codex usage status (5h / 7d consumed-quota bars)
  const codexPayload = parseCodexUsageStatus(statuses.get("codex-usage"));
  if (codexPayload) {
    // Reserve the 2-char gap so the right zone never overflows the line.
    const rightPart = buildCodexUsageBar(
      codexPayload.fiveHour,
      codexPayload.weekly,
      theme,
      Math.max(0, width - 2),
    );
    return buildThreeZoneLine(leftPart, centerPart, rightPart, width);
  }

  // Original 2-zone behavior (unchanged)
  if (!leftPart && !centerPart) return null;

  if (!leftPart) return buildCenteredLine(centerPart, width);

  if (!centerPart) {
    return leftPart + " ".repeat(Math.max(0, width - visibleWidth(leftPart)));
  }

  // Both: left-aligned process count + center-aligned LSP/Lint
  const maxLeftW = Math.floor(width / 3);
  let leftW = visibleWidth(leftPart);
  let adjustedLeft = leftPart;
  if (leftW > maxLeftW) {
    adjustedLeft = truncateToWidth(leftPart, maxLeftW, "…");
    leftW = visibleWidth(adjustedLeft);
  }
  const centerW = visibleWidth(centerPart);
  const remainingWidth = width - leftW;
  if (centerW <= remainingWidth) {
    const centerPad = Math.max(0, Math.floor((remainingWidth - centerW) / 2));
    const rightPad = Math.max(0, width - leftW - centerPad - centerW);
    return adjustedLeft + " ".repeat(centerPad) + centerPart + " ".repeat(rightPad);
  }
  const truncated = truncateToWidth(centerPart, remainingWidth, "…");
  const rightPad = Math.max(0, width - leftW - visibleWidth(truncated));
  return adjustedLeft + truncated + " ".repeat(rightPad);
}

// ─── Context Data Collection ─────────────────────────────────────

interface FooterContextData {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  modelId: string | undefined;
  provider: string | undefined;
  hasReasoning: boolean | undefined;
  modelRegistry: { getProviderDisplayName(provider: string): string } | undefined;
  thinkingLevel: string | undefined;
}

function isStaleError(e: unknown): boolean {
  return e instanceof Error && e.message.includes("stale");
}

function collectFooterContext(): FooterContextData {
  const result: FooterContextData = {
    tokens: null,
    contextWindow: 0,
    percent: null,
    modelId: undefined,
    provider: undefined,
    hasReasoning: undefined,
    modelRegistry: undefined,
    thinkingLevel: undefined,
  };

  if (!currentCtx) return result;

  // ctx (and its getters like modelRegistry / model / getContextUsage) can throw
  // a "stale" error during/after session replacement (e.g. `/new`). Degrade
  // gracefully instead of surfacing an error in the footer.
  try {
    result.modelRegistry = currentCtx.modelRegistry;

    const model = currentCtx.model;
    if (model) {
      result.contextWindow = model.contextWindow;
      result.modelId = model.id;
      result.provider = model.provider;
      result.hasReasoning = model.reasoning;
    }

    const usage = currentCtx.getContextUsage();
    if (usage) {
      result.tokens = usage.tokens;
      result.contextWindow = usage.contextWindow;
      result.percent = usage.percent;
    }
  } catch (e) {
    if (isStaleError(e)) return result;
    throw e;
  }

  if (api) {
    try {
      result.thinkingLevel = api.getThinkingLevel();
    } catch (e) {
      if (!isStaleError(e)) throw e;
    }
  }

  return result;
}

// ─── Main Render ─────────────────────────────────────────────────

export function renderFooterLine(width: number, theme: Theme): string[] {
  try {
    const branch = footerDataProvider?.getGitBranch() ?? null;
    const statuses = footerDataProvider?.getExtensionStatuses();

    const piGitStatusRaw = statuses?.get("pi-git");
    const piGitStatus = piGitStatusRaw ? parsePiGitStatus(piGitStatusRaw) : null;

    // Collect context data early (needed for width computation in fallback path)
    const ctx = collectFooterContext();
    const contextStr = buildContextDisplay(ctx.tokens, ctx.contextWindow, ctx.percent, theme);
    const modelStr = buildModelDisplay(
      ctx.modelId,
      ctx.provider,
      ctx.hasReasoning,
      ctx.modelRegistry,
      ctx.thinkingLevel,
      theme,
    );

    let left: string;
    const cwdStatus = parseCwdStatus(statuses?.get("cwd"));

    if (piGitStatus) {
      const effectivePiGit = cwdStatus ? { ...piGitStatus, cwd: cwdStatus.cwd } : piGitStatus;
      left = buildPiGitLeftSide(effectivePiGit, theme);
    } else {
      left = buildCompressedLeftSide(
        cwdStatus,
        branch,
        gitChanges,
        contextStr,
        modelStr,
        width,
        theme,
      );
    }

    const line1 = buildLine1(left, contextStr, modelStr, width);
    const line2 = buildLine2(width, theme, statuses);

    return line2 ? [line1, line2] : [line1];
  } catch (error: unknown) {
    console.error("[pi-powerline] renderFooterLine error:", error);
    return ["[powerline error]"];
  }
}

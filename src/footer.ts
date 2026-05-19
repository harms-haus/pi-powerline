import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { currentCwd, currentCtx, api, footerDataProvider } from "./state";
import { gitChanges, colorCodeGitChanges } from "./git";
import type { GitDiffStat } from "./git";
import { alignLeftRight, formatTokens, shortenPath } from "./helpers";

type CheckStatus = "pending" | "running" | "clean" | "issues" | "error" | "skipped";

interface LensStatusPayload {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
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
  let contextDisplay: string;
  if (tokens !== null && percent !== null) {
    contextDisplay = `${formatTokens(tokens)}/${formatTokens(contextWindow)} ${percent.toFixed(1)}%`;
  } else if (tokens !== null) {
    contextDisplay = `${formatTokens(tokens)}/${formatTokens(contextWindow)}`;
  } else {
    contextDisplay = `?/${formatTokens(contextWindow)}`;
  }

  if (percent !== null) {
    if (percent > CONTEXT_CRITICAL_THRESHOLD) {
      return theme.fg("error", contextDisplay);
    }
    if (percent > CONTEXT_WARNING_THRESHOLD) {
      return theme.fg("warning", contextDisplay);
    }
  }
  return contextDisplay;
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

function buildLine1(
  left: string,
  contextStr: string,
  modelStr: string,
  percent: number | null,
  width: number,
  theme: Theme,
): string {
  const right = contextStr + " " + modelStr;

  if (percent !== null && percent > CONTEXT_WARNING_THRESHOLD) {
    const pct = percent;
    const minRight =
      pct > CONTEXT_CRITICAL_THRESHOLD
        ? theme.fg("error", `${pct.toFixed(0)}%`)
        : theme.fg("warning", `${pct.toFixed(0)}%`);
    const minRightW = visibleWidth(minRight);
    if (minRightW + 2 <= width) {
      const truncatedLeft = truncateToWidth(left, width - minRightW - 2, "…");
      const truncatedLeftW = visibleWidth(truncatedLeft);
      return truncatedLeft + " ".repeat(width - truncatedLeftW - minRightW) + minRight;
    }
    return truncateToWidth(left, width, "…");
  }
  return alignLeftRight(left, right, width);
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

  if (api) {
    result.thinkingLevel = api.getThinkingLevel();
  }

  return result;
}

// ─── Main Render ─────────────────────────────────────────────────

export function renderFooterLine(width: number, theme: Theme): string[] {
  try {
    const cwdDisplay = shortenPath(currentCwd || "");
    const branch = footerDataProvider?.getGitBranch() ?? null;
    const statuses = footerDataProvider?.getExtensionStatuses();

    const piGitStatusRaw = statuses?.get("pi-git");
    const piGitStatus = piGitStatusRaw ? parsePiGitStatus(piGitStatusRaw) : null;

    let left: string;
    if (piGitStatus) {
      left = buildPiGitLeftSide(piGitStatus, theme);
    } else {
      left = buildFallbackLeftSide(cwdDisplay, branch, gitChanges, theme);
    }

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

    const line1 = buildLine1(left, contextStr, modelStr, ctx.percent, width, theme);
    const line2 = buildLine2(width, theme, statuses);

    return line2 ? [line1, line2] : [line1];
  } catch (error: unknown) {
    console.error("[pi-powerline] renderFooterLine error:", error);
    return ["[powerline error]"];
  }
}

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { currentCwd, currentCtx, api, footerDataProvider } from "./state";
import { gitChanges, colorCodeGitChanges } from "./git";
import { alignLeftRight, formatTokens, shortenPath } from "./helpers";

const CONTEXT_WARNING_THRESHOLD = 70;
const CONTEXT_CRITICAL_THRESHOLD = 90;

/** Build footer line 2 with optional left-aligned process count and center-aligned LSP/Lint status */
function buildLine2(
  width: number,
  theme: Theme,
  statuses: ReadonlyMap<string, string> | undefined,
): string | null {
  if (!statuses) return null;

  const processStatus = statuses.get("pi-processes");
  const lspStatus = statuses.get("pi-lsp");
  const lintStatus = statuses.get("pi-lint");

  // Build left part (process count)
  const leftPart = processStatus ? theme.fg("muted", processStatus) : "";

  // Build center part (LSP/Lint)
  const centerParts: string[] = [];
  if (lspStatus) {
    centerParts.push(theme.fg("muted", "LSP:") + " " + theme.fg("dim", lspStatus));
  }
  if (lintStatus) {
    centerParts.push(theme.fg("muted", "Linter:") + " " + theme.fg("dim", lintStatus));
  }
  const centerPart =
    centerParts.length > 0
      ? centerParts.join(theme.fg("dim", " \u2022 "))
      : "";

  if (!leftPart && !centerPart) return null;

  if (!leftPart) {
    // No process status — just center the LSP/Lint (original behavior)
    const strW = visibleWidth(centerPart);
    if (strW <= width) {
      const pad = Math.max(0, Math.floor((width - strW) / 2));
      return " ".repeat(pad) + centerPart;
    }
    return truncateToWidth(centerPart, width, "");
  }

  if (!centerPart) {
    // No LSP/Lint — just show process count left-aligned
    return leftPart + " ".repeat(Math.max(0, width - visibleWidth(leftPart)));
  }

  // Both: left-aligned process count + center-aligned LSP/Lint in remaining space
  const leftW = visibleWidth(leftPart);
  const centerW = visibleWidth(centerPart);
  const remainingWidth = width - leftW;
  if (centerW <= remainingWidth) {
    const centerPad = Math.max(0, Math.floor((remainingWidth - centerW) / 2));
    const rightPad = Math.max(
      0,
      width - leftW - centerPad - centerW,
    );
    return leftPart + " ".repeat(centerPad) + centerPart + " ".repeat(rightPad);
  }
  // Center part doesn't fit in remaining space — truncate it
  const truncated = truncateToWidth(centerPart, remainingWidth, "");
  const rightPad = Math.max(0, width - leftW - visibleWidth(truncated));
  return leftPart + truncated + " ".repeat(rightPad);
}

export function renderFooterLine(width: number, theme: Theme): string[] {
  try {
    // Left side: cwd + branch + git changes
    const cwdDisplay = shortenPath(currentCwd || "");
    const branch = footerDataProvider?.getGitBranch?.() ?? null;
    const statuses = footerDataProvider?.getExtensionStatuses?.();

    // Check for pi-git enriched status
    const piGitStatusRaw = statuses?.get("pi-git");

    let left: string;
    if (piGitStatusRaw) {
      try {
        const piGit = JSON.parse(piGitStatusRaw) as {
          cwd: string;
          branch: string;
          insertions: number;
          deletions: number;
          addedCount: number;
          modifiedCount: number;
          deletedCount: number;
        };
        if (typeof piGit.cwd !== "string" || typeof piGit.branch !== "string") {
          throw new Error("Invalid pi-git status");
        }

        // Location group: cwd (branch)
        const locationParts: string[] = [];
        locationParts.push(theme.fg("dim", piGit.cwd));
        locationParts.push(theme.fg("accent", `(${piGit.branch})`));
        const location = locationParts.join(" ");

        const groups: string[] = [location];

        // Diff stats group: +N -M
        const diffParts: string[] = [];
        if (piGit.insertions > 0) diffParts.push(theme.fg("success", `+${piGit.insertions}`));
        if (piGit.deletions > 0) diffParts.push(theme.fg("error", `-${piGit.deletions}`));
        if (diffParts.length > 0) groups.push(diffParts.join(" "));

        // File counts group: n new, o changed, p deleted (per-type colors)
        const countParts: string[] = [];
        if (piGit.addedCount > 0) countParts.push(theme.fg("success", `${piGit.addedCount} new`));
        if (piGit.modifiedCount > 0) countParts.push(theme.fg("warning", `${piGit.modifiedCount} changed`));
        if (piGit.deletedCount > 0) countParts.push(theme.fg("error", `${piGit.deletedCount} deleted`));
        if (countParts.length > 0) groups.push(countParts.join(theme.fg("dim", ", ")));

        left = groups.join(theme.fg("dim", " \u2022 "));
      } catch {
        // JSON parse failed — fall back to built-in rendering
        const leftParts: string[] = [];
        leftParts.push(theme.fg("dim", cwdDisplay));
        if (branch) {
          leftParts.push(theme.fg("accent", `(${branch})`));
        }
        if (gitChanges) {
          leftParts.push(colorCodeGitChanges(gitChanges, theme));
        }
        left = leftParts.join(" ");
      }
    } else {
      // No pi-git status — use built-in rendering
      const leftParts: string[] = [];
      leftParts.push(theme.fg("dim", cwdDisplay));
      if (branch) {
        leftParts.push(theme.fg("accent", `(${branch})`));
      }
      if (gitChanges) {
        leftParts.push(colorCodeGitChanges(gitChanges, theme));
      }
      left = leftParts.join(" ");
    }

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
      if (percent > CONTEXT_CRITICAL_THRESHOLD) {
        contextStr = theme.fg("error", contextDisplay);
      } else if (percent > CONTEXT_WARNING_THRESHOLD) {
        contextStr = theme.fg("warning", contextDisplay);
      }
    }

    const isContextWarning = percent !== null && percent > CONTEXT_WARNING_THRESHOLD;

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

    const thinkingLevel = api?.getThinkingLevel?.();
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
    let line1: string;
    if (isContextWarning) {
      const pct = percent!; /* safe: guarded by isContextWarning */
      const minRight =
        pct > CONTEXT_CRITICAL_THRESHOLD
          ? theme.fg("error", `${pct.toFixed(0)}%`)
          : theme.fg("warning", `${pct.toFixed(0)}%`);
      const minRightW = visibleWidth(minRight);
      if (minRightW + 2 <= width) {
        const truncatedLeft = truncateToWidth(left, width - minRightW - 2, "");
        const truncatedLeftW = visibleWidth(truncatedLeft);
        line1 = truncatedLeft + " ".repeat(width - truncatedLeftW - minRightW) + minRight;
      } else {
        line1 = truncateToWidth(left, width, "");
      }
    } else {
      line1 = alignLeftRight(left, right, width);
    }

    // Line 2 (optional): process count (left) + LSP/Lint status (center)
    const line2 = buildLine2(width, theme, statuses);

    return line2 ? [line1, line2] : [line1];
  } catch {
    return ["[powerline error]"];
  }
}

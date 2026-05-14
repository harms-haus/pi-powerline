import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { currentCwd, currentCtx, api, footerDataProvider } from "./state";
import { gitChanges, colorCodeGitChanges } from "./git";
import { alignLeftRight, formatTokens, shortenPath } from "./helpers";

const CONTEXT_WARNING_THRESHOLD = 70;
const CONTEXT_CRITICAL_THRESHOLD = 90;

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

export function renderFooterLine(width: number, theme: Theme): string[] {
  try {
    // Left side: cwd + branch + git changes
    const cwdDisplay = shortenPath(currentCwd || "");
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

    // Line 2 (optional): LSP and Lint status, centered
    const statuses = footerDataProvider?.getExtensionStatuses?.();
    const line2 = buildLspLintLine(width, theme, statuses);

    return line2 ? [line1, line2] : [line1];
  } catch {
    return ["[powerline error]"];
  }
}

/**
 * Powerline Extension — Entry point
 *
 * Registers footer and above-editor widget, wires up event handlers.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  isBashToolResult,
  isEditToolResult,
  isWriteToolResult,
} from "@earendil-works/pi-coding-agent";
import {
  requestRefresh,
  safeUpdateCtx,
  setApi,
  setTuiRef,
  setFooterDataProvider,
  resetState,
} from "./state";
import { refreshGitDiff, debouncedRefreshGitDiff, clearGitTimer } from "./git";
import { invalidateCompressionCache } from "./path-compression.js";
import { renderFooterLine } from "./footer";
import { renderAboveWidget } from "./above-widget";

function setupUI(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  ctx.ui.setFooter((_tui, theme, footerData) => {
    setTuiRef(_tui);
    setFooterDataProvider(footerData);
    const unsubBranch = footerData.onBranchChange(() => {
      _tui.requestRender();
    });

    return {
      dispose() {
        unsubBranch();
        clearGitTimer();
        invalidateCompressionCache();
      },
      invalidate() {},
      render(w: number): string[] {
        return renderFooterLine(w, theme);
      },
    };
  });

  ctx.ui.setWidget(
    "powerline-above",
    (_tui, theme) => ({
      dispose() {},
      invalidate() {},
      render(w: number): string[] {
        return renderAboveWidget(w, theme);
      },
    }),
    { placement: "aboveEditor" },
  );
}

let unsubCwdChange: (() => void) | undefined;

function cleanup(): void {
  clearGitTimer();
  unsubCwdChange?.();
  unsubCwdChange = undefined;
  resetState();
}

export default function (pi: ExtensionAPI): void {
  setApi(pi);

  pi.on("session_start", (_event, ctx) => {
    if (!safeUpdateCtx(ctx)) return;
    clearGitTimer();
    invalidateCompressionCache();
    setupUI(ctx);
    void refreshGitDiff();
    unsubCwdChange?.();
    unsubCwdChange = pi.events.on("cwd-change", () => {
      requestRefresh();
    });
    requestRefresh();
  });

  pi.on("session_tree", (_event, ctx) => {
    if (!safeUpdateCtx(ctx)) return;
    clearGitTimer();
    void refreshGitDiff();
  });

  pi.on("session_shutdown", () => {
    cleanup();
  });

  pi.on("turn_end", (_event, ctx) => {
    if (!safeUpdateCtx(ctx)) return;
    debouncedRefreshGitDiff();
  });

  pi.on("model_select", (_event, ctx) => {
    if (!safeUpdateCtx(ctx)) return;
    requestRefresh();
  });

  pi.on("thinking_level_select", (_event, ctx) => {
    if (!safeUpdateCtx(ctx)) return;
    requestRefresh();
  });

  // Fire-and-forget: refreshGitDiff is async but we don't await it here
  // to avoid blocking the event handler while git diff runs.
  pi.on("tool_result", (event, ctx) => {
    if (!safeUpdateCtx(ctx)) return;
    if (isWriteToolResult(event) || isEditToolResult(event) || isBashToolResult(event)) {
      debouncedRefreshGitDiff();
    }
  });

  pi.on("message_end", (_event, ctx) => {
    if (!safeUpdateCtx(ctx)) return;
    requestRefresh();
  });
}

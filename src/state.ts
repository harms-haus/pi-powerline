import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export let api: ExtensionAPI;
export let currentCtx: ExtensionContext | undefined;
export let currentCwd: string | undefined;
export let tuiRef: TUI | undefined;
export let footerDataProvider: ReadonlyFooterDataProvider | undefined;

export function requestRefresh(): void {
  tuiRef?.requestRender();
}

export function isStaleError(e: unknown): boolean {
  return e instanceof Error && e.message.includes("stale");
}

export function safeUpdateCtx(ctx: ExtensionContext): boolean {
  try {
    currentCtx = ctx;
    currentCwd = ctx.cwd;
    return true;
  } catch (e) {
    if (isStaleError(e)) return false;
    throw e;
  }
}

export function setApi(pi: ExtensionAPI): void {
  api = pi;
}

export function setTuiRef(tui: TUI | undefined): void {
  tuiRef = tui;
}

export function setFooterDataProvider(provider: ReadonlyFooterDataProvider | undefined): void {
  footerDataProvider = provider;
}

export function resetState(): void {
  currentCtx = undefined;
  currentCwd = undefined;
  tuiRef = undefined;
  footerDataProvider = undefined;
}

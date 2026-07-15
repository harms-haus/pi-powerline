import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export interface FooterContextSnapshot {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  modelId: string | undefined;
  provider: string | undefined;
  providerName: string | undefined;
  hasReasoning: boolean | undefined;
  thinkingLevel: string | undefined;
}

export let api: ExtensionAPI | undefined;
export let currentCtx: ExtensionContext | undefined;
export let currentCwd: string | undefined;
export let footerContextSnapshot: FooterContextSnapshot | undefined;
export let tuiRef: TUI | undefined;
export let footerDataProvider: ReadonlyFooterDataProvider | undefined;

export function requestRefresh(): void {
  tuiRef?.requestRender();
}

function isStaleError(e: unknown): boolean {
  return e instanceof Error && e.message.includes("stale");
}

function getThinkingLevelSnapshot(): string | undefined {
  if (!api) return footerContextSnapshot?.thinkingLevel;
  try {
    return api.getThinkingLevel();
  } catch (e) {
    if (isStaleError(e)) return footerContextSnapshot?.thinkingLevel;
    throw e;
  }
}

function captureFooterContext(ctx: ExtensionContext): FooterContextSnapshot {
  const model = ctx.model;
  const usage = ctx.getContextUsage();
  const providerName = model ? ctx.modelRegistry.getProviderDisplayName(model.provider) : undefined;

  if (usage) {
    return {
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      modelId: model?.id,
      provider: model?.provider,
      providerName,
      hasReasoning: model?.reasoning,
      thinkingLevel: getThinkingLevelSnapshot(),
    };
  }

  return {
    tokens: null,
    contextWindow: model?.contextWindow ?? 0,
    percent: null,
    modelId: model?.id,
    provider: model?.provider,
    providerName,
    hasReasoning: model?.reasoning,
    thinkingLevel: getThinkingLevelSnapshot(),
  };
}

export function safeUpdateCtx(ctx: ExtensionContext): boolean {
  try {
    // Extension contexts are invalidated after a session replacement in some pi
    // runtimes. Capture render data while the event context is still active.
    const cwd = ctx.cwd;
    const snapshot = captureFooterContext(ctx);

    currentCtx = ctx;
    currentCwd = cwd;
    footerContextSnapshot = snapshot;
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
  footerContextSnapshot = undefined;
  tuiRef = undefined;
  footerDataProvider = undefined;
}

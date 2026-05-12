# Research: Pi Coding Agent Footer & Powerline APIs

## 1. DEPENDENCY MAPPING

### Core Packages

| Package | Version | Role | Import Path |
|---------|---------|------|-------------|
| `@earendil-works/pi-coding-agent` | installed globally at `~/.npm-global/lib/node_modules/` | Extension host; provides `ExtensionAPI`, `ExtensionContext`, types, `CustomEditor`, `DynamicBorder`, `BorderedLoader`, utility re-exports | `import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"` |
| `@earendil-works/pi-tui` | nested inside pi-coding-agent's node_modules | TUI component system; provides `Component`, `Container`, `Text`, `Box`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`, `SelectList`, `SettingsList`, `matchesKey`, `Key` | `import { truncateToWidth, visibleWidth, Text, Container } from "@earendil-works/pi-tui"` |
| `@earendil-works/pi-ai` | nested inside pi-coding-agent's node_modules | AI types: `AssistantMessage`, `Model`, `Usage`, `Context` | `import type { AssistantMessage } from "@earendil-works/pi-ai"` |
| `@earendil-works/pi-agent-core` | nested inside pi-coding-agent's node_modules | Agent types: `ThinkingLevel` (`"off" | "minimal" | "low" | "medium" | "high" | "xhigh"`) | Re-exported through pi-coding-agent |
| `typebox` | available at runtime | Schema definitions for tool parameters | `import { Type } from "typebox"` |

**Key note:** `@earendil-works/pi-tui` is NOT a top-level npm install — it's a nested dependency of `pi-coding-agent`. Extensions resolve it through pi's module resolution. No separate install needed.

---

## 2. API SURFACES & CONTRACTS

### 2.1 `ctx.ui.setFooter()` — Complete Signature

```typescript
// Set a custom footer (replaces built-in footer entirely)
ctx.ui.setFooter(
  factory: ((
    tui: TUI,
    theme: Theme,
    footerData: ReadonlyFooterDataProvider
  ) => Component & { dispose?(): void }) | undefined
): void;
```

- Pass `undefined` to **restore the built-in footer**.
- The factory is called once when `setFooter()` is invoked.
- The returned object must implement `Component` (i.e., have `render(width: number): string[]` and `invalidate(): void`).
- Optionally implement `dispose?()` for cleanup (called when footer is replaced or restored).
- The factory receives three parameters:
  - `tui`: TUI instance — call `tui.requestRender()` to trigger re-renders
  - `theme`: `Theme` object for styling (see section 2.5)
  - `footerData`: `ReadonlyFooterDataProvider` — provides git branch, extension statuses, provider count

### 2.2 `ReadonlyFooterDataProvider` — Footer-Exclusive Data

```typescript
type ReadonlyFooterDataProvider = Pick<
  FooterDataProvider,
  "getGitBranch" | "getExtensionStatuses" | "getAvailableProviderCount" | "onBranchChange"
>;
```

**Methods:**

| Method | Signature | Return | Description |
|--------|-----------|--------|-------------|
| `getGitBranch()` | `() => string \| null` | Branch name, `null` if not in a repo, `"detached"` if detached HEAD | Current git branch |
| `getExtensionStatuses()` | `() => ReadonlyMap<string, string>` | Map of key→text set via `ctx.ui.setStatus()` | All extension status texts |
| `getAvailableProviderCount()` | `() => number` | Count of providers with available models | Used to decide whether to show provider name |
| `onBranchChange()` | `(callback: () => void) => () => void` | Returns unsubscribe function | Subscribe to git branch changes for reactive re-rendering |

### 2.3 `ctx.ui.setStatus()` — Extension Status in Footer

```typescript
ctx.ui.setStatus(key: string, text: string | undefined): void;
```

- `key`: Unique identifier for the extension/status
- `text`: Styled string to display, or `undefined` to clear
- Status texts appear in the built-in footer on a third line, sorted alphabetically by key
- Retrieved via `footerData.getExtensionStatuses()` in custom footers

### 2.4 `ctx.getContextUsage()` — Context Window Stats

```typescript
interface ContextUsage {
  /** Estimated context tokens, or null if unknown (e.g., right after compaction) */
  tokens: number | null;
  /** The model's context window size in tokens */
  contextWindow: number;
  /** Context usage as percentage of context window, or null if tokens is unknown */
  percent: number | null;
}

ctx.getContextUsage(): ContextUsage | undefined;
```

- Returns `undefined` if no model is set
- After compaction, `tokens` and `percent` may be `null` until the next LLM response
- `contextWindow` comes from `ctx.model.contextWindow`

### 2.5 `Theme` — Styling API

```typescript
class Theme {
  // Foreground colors
  fg(color: ThemeColor, text: string): string;
  // Background colors
  bg(color: ThemeBg, text: string): string;
  // Text styles
  bold(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  strikethrough(text: string): string;
  inverse(text: string): string;
}
```

**ThemeColor values:**
`"text"` | `"accent"` | `"muted"` | `"dim"` | `"success"` | `"error"` | `"warning"` | `"border"` | `"borderAccent"` | `"borderMuted"` | `"userMessageText"` | `"customMessageText"` | `"customMessageLabel"` | `"toolTitle"` | `"toolOutput"` | `"toolDiffAdded"` | `"toolDiffRemoved"` | `"toolDiffContext"` | `"mdHeading"` | `"mdLink"` | `"mdLinkUrl"` | `"mdCode"` | `"mdCodeBlock"` | `"mdCodeBlockBorder"` | `"mdQuote"` | `"mdQuoteBorder"` | `"mdHr"` | `"mdListBullet"` | `"syntaxComment"` | `"syntaxKeyword"` | `"syntaxFunction"` | `"syntaxVariable"` | `"syntaxString"` | `"syntaxNumber"` | `"syntaxType"` | `"syntaxOperator"` | `"syntaxPunctuation"` | `"thinkingOff"` | `"thinkingMinimal"` | `"thinkingLow"` | `"thinkingMedium"` | `"thinkingHigh"` | `"thinkingXhigh"` | `"thinkingText"` | `"bashMode"`

**ThemeBg values:**
`"selectedBg"` | `"userMessageBg"` | `"customMessageBg"` | `"toolPendingBg"` | `"toolSuccessBg"` | `"toolErrorBg"`

**Thinking level border colors:**
```typescript
theme.getThinkingBorderColor(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): (str: string) => string;
```

### 2.6 `ctx.model` — Current Model Info

```typescript
interface Model<TApi extends Api> {
  id: string;          // e.g., "claude-sonnet-4-20250514"
  name: string;        // Display name
  provider: Provider;  // e.g., "anthropic", "openai"
  api: TApi;           // API type
  reasoning: boolean;  // Supports extended thinking
  contextWindow: number;
  maxTokens: number;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; };
  // ... more fields
}

ctx.model: Model<any> | undefined;  // undefined if no model selected
```

### 2.7 `pi.getThinkingLevel()` / `pi.setThinkingLevel()`

```typescript
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

pi.getThinkingLevel(): ThinkingLevel;
pi.setThinkingLevel(level: ThinkingLevel): void;  // Clamped to model capabilities
```

### 2.8 `ctx.ui.theme` — Direct Theme Access

```typescript
ctx.ui.theme: Theme;  // Access current theme outside of render callbacks
```

Available in any extension handler, not just inside `setFooter` factory.

### 2.9 Token Stats via `ctx.sessionManager`

```typescript
// Iterate all session entries to compute token stats
for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "message" && entry.message.role === "assistant") {
    const m = entry.message as AssistantMessage;
    // m.usage.input: number
    // m.usage.output: number
    // m.usage.cacheRead: number
    // m.usage.cacheWrite: number
    // m.usage.cost.total: number
    // m.usage.cost.input: number
    // m.usage.cost.output: number
    // m.usage.cost.cacheRead: number
    // m.usage.cost.cacheWrite: number
  }
}

// Or iterate ALL entries (not just current branch):
for (const entry of ctx.sessionManager.getEntries()) { ... }
```

### 2.10 `ctx.ui.setWorkingIndicator()` — Custom Spinner

```typescript
interface WorkingIndicatorOptions {
  frames?: string[];     // Animation frames. Empty array = hidden.
  intervalMs?: number;   // Frame interval (default animation speed)
}

ctx.ui.setWorkingIndicator(options?: WorkingIndicatorOptions): void;
```

- No argument → restore default spinner
- `frames: [theme.fg("accent", "●")]` → static dot
- `frames: []` → hide entirely
- Custom frames rendered verbatim — must include your own color codes

### 2.11 `ctx.ui.setWidget()` — Widgets Above/Below Editor

```typescript
// String array form
ctx.ui.setWidget(key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;

// Component factory form
ctx.ui.setWidget(key: string, content: ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
```

### 2.12 Utility Functions from `@earendil-works/pi-tui`

```typescript
// Get visible display width (ignoring ANSI codes, counting wide chars correctly)
visibleWidth(str: string): number;

// Truncate string to fit within maxWidth visible columns
// ellipsis defaults to "...", pass "" to disable
// pad: if true, pad result to exactly maxWidth
truncateToWidth(text: string, maxWidth: number, ellipsis?: string, pad?: boolean): string;

// Word-wrap text preserving ANSI codes
wrapTextWithAnsi(text: string, width: number): string[];

// Apply background color to line, padding to full width
applyBackgroundToLine(line: string, width: number, bgFn: (text: string) => string): string;
```

### 2.13 Events Relevant to Footer Updates

| Event | When | Data | Use for Footer |
|-------|------|------|----------------|
| `model_select` | Model changes | `{ model, previousModel, source }` | Update model name, context window |
| `thinking_level_select` | Thinking level changes | `{ level, previousLevel }` | Update thinking level display |
| `session_start` | Session loads/reloads | `{ reason, previousSessionFile }` | Re-initialize footer state |
| `turn_end` | Each turn completes | `{ turnIndex, message, toolResults }` | Update token counts |
| `message_end` | Message finalized | `{ message }` | Update token counts after each message |

---

## 3. DATA FLOWS & TRANSFORMATIONS

### 3.1 Built-in Footer Rendering (Default Behavior)

The built-in `FooterComponent.render(width)` produces **2-3 lines**:

**Line 1 — pwd/git/session line:**
```
~/projects/my-app (main) • Session Name
```
- CWD with `~` substitution for home directory
- Git branch in parentheses (via `footerData.getGitBranch()`)
- Session name after bullet (via `sessionManager.getSessionName()`)

**Line 2 — stats + model line (left-right aligned):**
```
↑12.5k ↓3.2k R8.1k W2.0k $0.042 45.2%/200k (auto)          claude-sonnet-4 • medium
```
- Left side: input tokens (↑), output tokens (↓), cache read (R), cache write (W), cost ($), context percentage
- Context percentage is colorized: >90% → error (red), >70% → warning (yellow), else plain
- Right side: model ID, thinking level if reasoning model, provider name in parentheses if multiple providers
- Auto-compaction indicator `(auto)` after context percentage

**Line 3 (optional) — extension statuses:**
```
● active ✓ Turn 3 complete
```
- Only shown if extensions have set statuses via `ctx.ui.setStatus()`
- Sorted alphabetically by key

### 3.2 Token Counting Flow

```
sessionManager.getBranch() or getEntries()
  → filter entries where type === "message" && message.role === "assistant"
    → cast to AssistantMessage
      → accumulate: usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.cost.total
```

**Important distinction:**
- `getBranch()` → current branch only (most common)
- `getEntries()` → ALL entries across all branches (used by built-in footer for lifetime totals)

### 3.3 Context Usage Flow

```
ctx.getContextUsage()
  → { tokens: number | null, contextWindow: number, percent: number | null }
```

Internally uses:
1. Last assistant usage tokens when available
2. Falls back to estimating tokens for trailing messages
3. Returns `null` for tokens/percent right after compaction (before next LLM response)

### 3.4 Left-Right Alignment Pattern (from built-in footer and custom-footer.ts)

```typescript
render(width: number): string[] {
  // Build left and right strings
  const left = theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`);
  const right = theme.fg("dim", `${ctx.model?.id || "no-model"}`);

  // Calculate padding between them
  const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

  // Combine and truncate to exact width
  return [truncateToWidth(left + pad + right, width)];
}
```

**Multi-line footer pattern:**
```typescript
render(width: number): string[] {
  const lines: string[] = [];

  // Line 1: Left-aligned content
  lines.push(truncateToWidth(line1Content, width));

  // Line 2: Left-right aligned
  const leftWidth = visibleWidth(leftPart);
  const rightWidth = visibleWidth(rightPart);
  const padding = " ".repeat(Math.max(1, width - leftWidth - rightWidth));
  lines.push(truncateToWidth(leftPart + padding + rightPart, width));

  // Line 3 (optional): extension statuses
  if (statuses.size > 0) {
    lines.push(truncateToWidth(statusLine, width));
  }

  return lines;
}
```

### 3.5 Reactive Re-rendering Pattern

The custom-footer.ts example demonstrates the correct pattern for reactive updates:

```typescript
ctx.ui.setFooter((tui, theme, footerData) => {
  // Subscribe to git branch changes → trigger re-render
  const unsub = footerData.onBranchChange(() => tui.requestRender());

  return {
    dispose: unsub,  // Cleanup on footer replacement
    invalidate() {}, // Clear caches on theme change
    render(width: number): string[] {
      // ... render logic
    },
  };
});
```

---

## 4. EXISTING PATTERNS IN THE STACK

### 4.1 Extension File Structure

Extensions live at:
- Global: `~/.pi/agent/extensions/*.ts` or `~/.pi/agent/extensions/*/index.ts`
- Project-local: `.pi/extensions/*.ts` or `.pi/extensions/*/index.ts`

The pi-powerline project will be placed at `~/.pi/agent/extensions/pi-powerline/index.ts` (or symlinked).

### 4.2 Extension Factory Pattern

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Setup code runs once at load time
  // Subscribe to events
  // Register commands, tools, etc.
}
```

### 4.3 Token Formatting Helper (from built-in footer)

```typescript
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}
```

### 4.4 Color-Coded Context Percentage (from built-in footer)

```typescript
if (contextPercentValue > 90) {
  contextPercentStr = theme.fg("error", contextPercentDisplay);
} else if (contextPercentValue > 70) {
  contextPercentStr = theme.fg("warning", contextPercentDisplay);
} else {
  contextPercentStr = contextPercentDisplay;  // No color
}
```

### 4.5 Thinking Level Display (from built-in footer)

```typescript
const thinkingLevel = state.thinkingLevel || "off";
// Shows: "model-id • thinking off" or "model-id • medium"
rightSide = thinkingLevel === "off"
  ? `${modelName} • thinking off`
  : `${modelName} • ${thinkingLevel}`;
```

The `ThemeColor` values for thinking levels are:
- `"thinkingOff"`, `"thinkingMinimal"`, `"thinkingLow"`, `"thinkingMedium"`, `"thinkingHigh"`, `"thinkingXhigh"`

### 4.6 Status Text Sanitization (from built-in footer)

```typescript
function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}
```

---

## 5. CONSTRAINTS & GOTCHAS

### 5.1 Width Constraints

- Every line returned from `render(width)` **MUST NOT exceed `width`** visible columns
- Always use `truncateToWidth(line, width)` before returning
- ANSI escape codes don't count toward width (handled by `visibleWidth`)
- Wide characters (CJK, emoji) count as 2 columns

### 5.2 Theme Colors in Cached Strings

- If you cache themed strings (e.g., `theme.fg("dim", text)`) and the theme changes, the cached ANSI codes are stale
- Implement `invalidate()` properly to clear caches
- The TUI calls `invalidate()` on all components when theme changes

### 5.3 `ctx.model` Availability

- `ctx.model` can be `undefined` if no model is selected
- `ctx.getContextUsage()` returns `undefined` if no model is set
- After compaction, `tokens` and `percent` may be `null`

### 5.4 `setFooter` vs Built-in Footer

- `setFooter()` **completely replaces** the built-in footer — no composition
- You lose the built-in footer's pwd line, extension statuses display, and auto-compaction indicator
- Must re-implement any desired built-in features in your custom footer
- Pass `undefined` to `setFooter()` to restore the built-in footer

### 5.5 Event-Based Updates

- The footer factory is called once. For reactive updates, you must:
  1. Subscribe to `footerData.onBranchChange()` for git changes
  2. Listen to `pi.on("turn_end", ...)` etc. for token count changes
  3. Call `tui.requestRender()` to trigger re-renders
- Without calling `tui.requestRender()`, the footer will NOT update

### 5.6 `dispose()` Cleanup

- The `dispose()` method on the returned component is called when:
  - The footer is replaced by another `setFooter()` call
  - The footer is restored to default (`setFooter(undefined)`)
  - The session shuts down
- **Always return `dispose` from `footerData.onBranchChange()`** to prevent memory leaks

### 5.7 ANSI Reset Behavior

- The TUI appends a full SGR reset and OSC 8 reset at the end of each rendered line
- Styles do **NOT** carry across lines
- If emitting multi-line styled text, reapply styles per line

### 5.8 Token Counting Across Compaction

- After compaction, older assistant messages are replaced by a compaction entry
- `getBranch()` only returns the current branch (post-compaction)
- `getEntries()` returns all entries but only the compaction entry + newer messages will be in the active branch
- The built-in footer iterates ALL entries (`getEntries()`) for lifetime totals

### 5.9 Custom Working Indicator

- `setWorkingIndicator()` frames are rendered **verbatim** — no automatic colors
- Must wrap frames with `theme.fg(...)` yourself
- Only affects the streaming indicator, not compaction/retry loaders

### 5.10 `ctx.ui.theme` vs Factory `theme` Parameter

- `ctx.ui.theme` is always available in any handler
- The `theme` parameter in `setFooter((tui, theme, footerData) => ...)` is the same object
- Use `ctx.ui.theme` when updating footer from event handlers outside the factory
- Both point to the current theme instance

### 5.11 Subscription Pattern for Dynamic Data

For a footer that updates with token counts and model changes:

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      // Subscribe to branch changes
      const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

      // Subscribe to turn/model events for data refresh
      pi.on("turn_end", () => tui.requestRender());
      pi.on("model_select", () => tui.requestRender());
      pi.on("thinking_level_select", () => tui.requestRender());

      return {
        dispose() { unsubBranch(); /* unsub others */ },
        invalidate() { /* clear caches */ },
        render(width: number): string[] {
          // Use ctx (captured from outer scope) for live data
          // Use footerData for git branch and statuses
          // Use pi.getThinkingLevel() for current thinking level
        },
      };
    });
  });
}
```

**CRITICAL GOTCHA:** The `ctx` captured in `session_start` is the session context. After session replacement (fork/new/resume), this `ctx` becomes stale. The `setFooter` factory runs fresh for the new session, so the closure captures the new `ctx`. However, if you subscribe to `pi.on("turn_end", ...)` inside the factory, you'll get multiple subscriptions across session replacements. Use `session_shutdown` to clean up, or subscribe at the `pi` level with a single listener that reads the current context.

### 5.12 Available Import Paths

All imports available to extensions without installation:
- `@earendil-works/pi-coding-agent` — main extension types and utilities
- `@earendil-works/pi-tui` — TUI components and utilities
- `@earendil-works/pi-ai` — AI types
- `typebox` — schema definitions
- Node.js builtins (`node:fs`, `node:path`, etc.)

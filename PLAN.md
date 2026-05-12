# pi-powerline Implementation Plan

## Overview

Build a centralized "powerline" extension that replaces the built-in footer and all individual extension footer/status bar contributions with a unified, purpose-designed layout.

---

## 1. SCOPE & BOUNDARIES

### Files Created

| File | Purpose |
|------|---------|
| `/home/blake/Documents/software/pi-extensions/pi-powerline/index.ts` | Single source file — all powerline logic |
| `/home/blake/Documents/software/pi-extensions/pi-powerline/package.json` | Extension metadata and dependencies |

### Files Modified

| File | Change |
|------|--------|
| `/home/blake/Documents/software/pi-extensions/pi-till-done/index.ts` | Remove `setFooter()` calls, remove `setWidget("till-done", ...)` calls, add `setStatus()` calls to publish todo state |

### Files OUT OF SCOPE (no changes needed)

- `pi-cwd/index.ts` — continues calling `setStatus("cwd", ...)` as-is; powerline reads it
- `pi-rpir-workflow/src/index.ts` — continues calling `setStatus("rpir-workflow", ...)` as-is; powerline reads it
- `pi-steer/index.ts` — continues calling `setWidget("pi-steer", ...)` as-is; powerline does not interfere

---

## 2. LAYOUT SPECIFICATION

### Above Composer — Widget "powerline-above"

Rendered using the **component factory** form of `setWidget` (for left/right alignment control on line 1).

```
📋 6/10                                    🔬 Implementing [2/5]
● [2] Fix the login bug
● [5] Add integration tests
```

- **Line 1, left-aligned:** Todo progress count from `setStatus("till-done", ...)` — format: `📋 {completed}/{total}`
- **Line 1, right-aligned:** RPIR workflow phase from `setStatus("rpir-workflow", ...)` — rendered as-is (already contains emoji + name + optional progress)
- **Lines 2+:** Active todo items from `setStatus("till-done-active", ...)` — one line per item, format: `● [{index}] {text}`

**Visibility rules:**
- If NO statuses exist for "till-done", "rpir-workflow", or "till-done-active": set widget to `undefined` (hidden)
- If ANY of these exist: render available content, omit missing sections

### Below Composer — Custom Footer (via `setFooter`)

Single-line footer:

```
~/projects/foo (main) +388 -124              15k/1.0M 1.5% (alibaba-cloud) qwen3.6-plus • medium
```

- **Left side:**
  - `{cwd}` — current working directory with `~` substitution for `$HOME`, colored `dim`
  - `({branch})` — git branch from `footerData.getGitBranch()`, colored `accent`, omitted if null
  - `{+N -N}` — git diff stats from async subprocess, colored `dim`, omitted if empty
- **Right side:**
  - `{tokens}/{contextWindow} {percent}%` — context usage from `ctx.getContextUsage()`, colored `dim` (<70%), `warning` (70-90%), `error` (>90%)
  - `({provider})` — model provider, colored `dim`, shown only if multiple providers available
  - `{model.id}` — model identifier, colored `dim`
  - `• {thinkingLevel}` — thinking level, colored `dim`, shown only if model supports reasoning

**Truncation rules:**
- If total content exceeds `width`, right side is truncated first (using `truncateToWidth` with empty ellipsis)
- If right side needs less than 2 chars after left side, omit right side entirely
- Minimum 2 spaces gap between left and right

---

## 3. DATA MODEL & STATE

### Closure State (module-level `let` variables in `index.ts`)

```typescript
let piRef: ExtensionAPI;                       // set once in export default
let currentCtx: ExtensionContext | undefined;   // updated on every event that provides ctx
let tuiRef: TUI | undefined;                    // set when footer factory is called
let footerDataProvider: ReadonlyFooterDataProvider | undefined; // set when footer factory is called
let gitChanges: string = "";                    // e.g. "+388 -124", updated async
let gitDiffTimer: ReturnType<typeof setTimeout> | undefined;     // debounce timer
let disposed: boolean = false;                  // cleanup flag
```

### No new types/interfaces required.

All data flows through existing API types: `ExtensionContext`, `ReadonlyFooterDataProvider`, `ContextUsage`, `Model`, `ThinkingLevel`.

---

## 4. ALGORITHM & LOGIC

### 4.1 Git Diff Stats

**Command:** `pi.exec("git", ["diff", "--shortstat", "HEAD"], { cwd, timeout: 5000 })`

**Output examples:**
- `" 3 files changed, 388 insertions(+), 124 deletions(-)\n"`
- `" 1 file changed, 5 insertions(+)\n"`
- `""` (no changes or not a git repo)
- Process exits with code 128 (not a git repo)

**Parsing logic:**
```
function parseGitShortstat(output: string): string
```
1. Trim output
2. If empty: return `""`
3. Regex match `(\d+) insertion[s(]+\)` → extract insertions count
4. Regex match `(\d+) deletion[s(]+\)` → extract deletions count
5. Build result:
   - If insertions > 0 AND deletions > 0: `"+" + insertions + " -" + deletions`
   - If only insertions: `"+" + insertions`
   - If only deletions: `"-" + deletions`
   - If neither: `""` (edge case: files changed but 0 insertions/deletions)

**Refresh strategy:**
- `refreshGitDiff()`: async function, runs the exec command, parses output, updates `gitChanges`, calls `tuiRef?.requestRender()`
- Called **immediately** on: `session_start`, `session_tree`, `turn_end`
- Called **debounced (500ms)** on: `tool_result` (only for write/edit/bash tool results — check `isWriteToolResult(e) || isEditToolResult(e) || isBashToolResult(e)`)
- Error handling: if `pi.exec` throws or returns code !== 0, set `gitChanges = ""` silently (no logging, no notification)

### 4.2 Token Formatting

```typescript
function formatTokens(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 10000) return (count / 1000).toFixed(1) + "k";
    if (count < 1000000) return Math.round(count / 1000) + "k";
    if (count < 10000000) return (count / 1000000).toFixed(1) + "M";
    return Math.round(count / 1000000) + "M";
}
```

### 4.3 Home Directory Substitution

```typescript
function shortenPath(path: string): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (home && path.startsWith(home)) {
        return "~" + path.slice(home.length);
    }
    return path;
}
```

### 4.4 ANSI Stripping

```typescript
function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
}
```

Used to extract plain text from extension statuses that may contain ANSI codes (e.g., pi-cwd's status).

### 4.5 Footer Render Logic

```
function renderFooterLine(width: number, theme: Theme): string[]
```

1. **Compute cwd display:**
   a. Read `currentCtx?.cwd` → `shortenPath()` → `cwdDisplay`
   
2. **Compute branch:**
   a. Read `footerDataProvider?.getGitBranch()` → `branch` (string | null)
   
3. **Build left side:**
   a. `leftParts: string[] = []`
   b. Push `theme.fg("dim", cwdDisplay)`
   c. If `branch` is not null: push `theme.fg("accent", "(" + branch + ")")`
   d. If `gitChanges` is not empty: push `theme.fg("dim", gitChanges)`
   e. Join with space: `left = leftParts.join(" ")`
   
4. **Compute context usage:**
   a. `const usage = currentCtx?.getContextUsage()`
   b. `tokens = usage?.tokens` (number | null)
   c. `contextWindow = usage?.contextWindow ?? currentCtx?.model?.contextWindow ?? 0`
   d. `percent = usage?.percent` (number | null)
   e. Build `contextDisplay`:
      - If `tokens !== null && percent !== null`: `formatTokens(tokens) + "/" + formatTokens(contextWindow) + " " + percent.toFixed(1) + "%"`
      - If `tokens === null`: `"?/" + formatTokens(contextWindow)`
   f. Color: `theme.fg("error", ...)` if percent > 90, `theme.fg("warning", ...)` if percent > 70, else plain text (no color wrap)

5. **Compute model display:**
   a. `const model = currentCtx?.model`
   b. `const modelDisplay = model?.id ?? "no-model"`
   c. `const thinkingLevel = piRef?.getThinkingLevel()` 
   d. If `model?.reasoning` is true: append `" • " + thinkingLevel` to modelDisplay
   e. Determine whether to show provider: `footerDataProvider?.getAvailableProviderCount() > 1 && model` → prepend `"(" + model.provider + ") "`
   f. `right = theme.fg("dim", providerPrefix + modelDisplay + thinkingSuffix)`

6. **Compose line:**
   a. `leftW = visibleWidth(left)`
   b. `rightW = visibleWidth(right)`
   c. If `leftW + 2 + rightW <= width`: `left + " ".repeat(width - leftW - rightW) + right`
   d. Else if `width - leftW - 2 > 0`: truncate right to fit, pad, concatenate
   e. Else: just use `truncateToWidth(left, width, "")`

7. **Return:** `[line]` (single-element array — footer is one line)

### 4.6 Above-Editor Widget Render Logic

```
function renderAboveWidget(width: number, theme: Theme): string[]
```

1. **Read extension statuses:**
   a. `const statuses = footerDataProvider?.getExtensionStatuses()`
   b. `const tillDoneStatus = statuses?.get("till-done")` → e.g. `"📋 6/10"` or undefined
   c. `const tillDoneActiveRaw = statuses?.get("till-done-active")` → e.g. `"● [2] Fix bug\n● [5] Add tests"` or undefined
   d. `const rpirStatus = statuses?.get("rpir-workflow")` → e.g. `"🔬 Implementing [2/5]"` or undefined

2. **If all three are undefined:** return `[]` (empty array — widget should be set to `undefined` externally, but return [] as safety)

3. **Build line 1 (count + phase):**
   a. `left = tillDoneStatus ? theme.fg("accent", tillDoneStatus) : ""`
   b. `right = rpirStatus ? rpirStatus : ""` (already contains emoji, no extra theming)
   c. If both left and right exist:
      - `leftW = visibleWidth(left)`, `rightW = visibleWidth(right)`
      - If `leftW + 2 + rightW <= width`: `left + " ".repeat(width - leftW - rightW) + right`
      - Else: `truncateToWidth(left + " " + right, width, "")`
   d. If only left: `[left]`
   e. If only right: right-align: `" ".repeat(Math.max(0, width - visibleWidth(right))) + right`

4. **Build active item lines:**
   a. If `tillDoneActiveRaw` exists: `activeLines = tillDoneActiveRaw.split("\n")`
   b. Each line is already formatted as `● [N] text` by pi-till-done
   c. Apply theme: `theme.fg("warning", "● ") + theme.fg("accent", "[" + index + "] ") + theme.fg("text", todoText)`
   
   Wait — the status text from till-done is plain text, not themed. Powerline should theme it when rendering.
   
   Actually, pi-till-done will emit plain-text active items (see section 6). The format will be: `"[2] Fix the login bug"` (index + space + text). Powerline will prepend the bullet and apply theme colors.
   
   Parsing: split by newline, each line is `"[{index}] {text}"`. Apply theme: `theme.fg("warning", "● ") + theme.fg("accent", line)`.

5. **Return:** `[line1, ...activeLines]`

### 4.7 Refresh Orchestration

A single function `requestRefresh()`:
```typescript
function requestRefresh(): void {
    tuiRef?.requestRender();
}
```

Called from event handlers after updating closure state.

The `refreshGitDiff()` function is separate because it's async.

---

## 5. INTEGRATION & CONTRACTS

### 5.1 Extension Factory Signature

```typescript
export default function (pi: ExtensionAPI): void {
    piRef = pi;
    // ... register event handlers
}
```

### 5.2 Event Subscriptions

| Event | Handler Signature | Actions |
|-------|-------------------|---------|
| `"session_start"` | `async (_event, ctx) => void` | Set `currentCtx = ctx`. Call `setupUI(ctx)`. Call `refreshGitDiff()`. Request refresh. |
| `"session_tree"` | `async (_event, ctx) => void` | Set `currentCtx = ctx`. Call `refreshGitDiff()`. Request refresh. |
| `"session_shutdown"` | `async (_event, ctx) => void` | Call `cleanup()`. |
| `"turn_end"` | `async (_event, ctx) => void` | Set `currentCtx = ctx`. Call `refreshGitDiff()`. Request refresh. |
| `"model_select"` | `async (_event, ctx) => void` | Set `currentCtx = ctx`. Request refresh. |
| `"thinking_level_select"` | `async (_event, ctx) => void` | Set `currentCtx = ctx`. Request refresh. |
| `"tool_result"` | `async (event, ctx) => void` | Set `currentCtx = ctx`. If event is write/edit/bash tool result: debounced `refreshGitDiff()`. Request refresh. |
| `"message_end"` | `async (_event, ctx) => void` | Set `currentCtx = ctx`. Request refresh. (Updates context usage after each message) |

### 5.3 setupUI Function

```typescript
function setupUI(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    
    // 1. Set custom footer
    ctx.ui.setFooter((tui, theme, footerData) => {
        tuiRef = tui;
        footerDataProvider = footerData;
        
        const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
        
        return {
            dispose: () => {
                unsubBranch();
                if (gitDiffTimer) clearTimeout(gitDiffTimer);
            },
            invalidate() {
                // No cached state to invalidate — render reads live data
            },
            render(width: number): string[] {
                return renderFooterLine(width, theme);
            },
        };
    });
    
    // 2. Set above-editor widget
    ctx.ui.setWidget("powerline-above", (tui, theme) => {
        return {
            dispose() {},
            render(width: number): string[] {
                return renderAboveWidget(width, theme);
            },
        };
    }, { placement: "aboveEditor" });
}
```

### 5.4 cleanup Function

```typescript
function cleanup(): void {
    disposed = true;
    if (gitDiffTimer) {
        clearTimeout(gitDiffTimer);
        gitDiffTimer = undefined;
    }
    gitChanges = "";
    currentCtx = undefined;
    tuiRef = undefined;
    footerDataProvider = undefined;
    // Footer and widget will be cleaned up by session shutdown
}
```

### 5.5 refreshGitDiff Function

```typescript
async function refreshGitDiff(): Promise<void> {
    const cwd = currentCtx?.cwd;
    if (!cwd) return;
    
    try {
        const result = await piRef.exec("git", ["diff", "--shortstat", "HEAD"], {
            cwd,
            timeout: 5000,
        });
        
        if (result.code === 0) {
            gitChanges = parseGitShortstat(result.stdout);
        } else {
            gitChanges = "";
        }
    } catch {
        gitChanges = "";
    }
    
    requestRefresh();
}
```

### 5.6 Debounced Git Diff

```typescript
function debouncedRefreshGitDiff(): void {
    if (gitDiffTimer) clearTimeout(gitDiffTimer);
    gitDiffTimer = setTimeout(() => {
        gitDiffTimer = undefined;
        refreshGitDiff();
    }, 500);
}
```

---

## 6. REFACTORING pi-till-done

### Changes to `/home/blake/Documents/software/pi-extensions/pi-till-done/index.ts`

#### 6.1 Modify `updateUI` function (currently at line 117)

**Current behavior:**
1. Builds active item lines → `setWidget("till-done", lines)`
2. If todos exist: `setFooter(...)` with cwd+branch left, progress right
3. If no todos: `setFooter(undefined)`

**New behavior:**
1. Compute `completed` count and `total` from todos array
2. If todos exist (`todos.length > 0`):
   a. `ctx.ui.setStatus("till-done", "📋 " + completed + "/" + total)`
   b. Build active items string: iterate todos, for each `status === "in_progress"`: push `"[{index}] {text}"`
   c. If active items exist: `ctx.ui.setStatus("till-done-active", activeLines.join("\n"))`
   d. If no active items: `ctx.ui.setStatus("till-done-active", undefined)`
3. If no todos (`todos.length === 0`):
   a. `ctx.ui.setStatus("till-done", undefined)`
   b. `ctx.ui.setStatus("till-done-active", undefined)`

**Exact replacement for the `updateUI` function body:**

Replace the entire `updateUI` function (lines 117–170 approximately) with:

```typescript
function updateUI(ctx: ExtensionContext, todos: TodoItem[]): void {
    if (!ctx.hasUI) return;

    if (todos.length > 0) {
        let completed = 0;
        for (let i = 0; i < todos.length; i++) {
            if (todos[i].status === "completed") completed++;
        }
        const total = todos.length;

        // Publish progress count via status
        ctx.ui.setStatus("till-done", "📋 " + completed + "/" + total);

        // Publish active items via status (newline-separated plain text)
        const activeLines: string[] = [];
        for (let i = 0; i < todos.length; i++) {
            if (todos[i].status !== "in_progress") continue;
            activeLines.push("[" + i + "] " + todos[i].text);
        }
        ctx.ui.setStatus("till-done-active", activeLines.length > 0 ? activeLines.join("\n") : undefined);
    } else {
        ctx.ui.setStatus("till-done", undefined);
        ctx.ui.setStatus("till-done-active", undefined);
    }
}
```

#### 6.2 Remove unused imports

After the refactor, `truncateToWidth` and `visibleWidth` are no longer used (they were only in the `setFooter` render function). Remove them from the import:

**Before:**
```typescript
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
```

**After:**
```typescript
import { Text } from "@earendil-works/pi-tui";
```

Note: Verify that `Text` is still used elsewhere in the file (in message renderers or tool definitions). If it's also unused, remove the entire import line. Check by searching for `Text` usage outside the import. If `Text` IS used elsewhere, keep just the `Text` import. If NOT used, remove the entire `import { Text, ... } from "@earendil-works/pi-tui";` line.

Similarly, check if `Theme` import is still needed. It was imported as:
```typescript
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
```
If `Theme` is no longer referenced in the file (it was used in the `setFooter` callback parameter type), remove it:
```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
```

---

## 7. FILE: package.json

```json
{
  "name": "pi-powerline",
  "version": "1.0.0",
  "description": "pi-coding-agent extension: unified powerline footer and status bar",
  "keywords": ["pi-package"],
  "main": "index.ts",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "license": "MIT"
}
```

---

## 8. FILE: index.ts — Complete Structure

```typescript
/**
 * Powerline Extension — Unified status bar for pi-coding-agent
 *
 * Replaces the built-in footer and individual extension status displays
 * with a centralized, purpose-designed layout.
 *
 * Above composer: todo count + active items (left), rpir phase (right)
 * Below composer: cwd + git branch + git changes (left), context + model (right)
 */

import type {
    ExtensionAPI,
    ExtensionContext,
    ReadonlyFooterDataProvider,
    Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
    isBashToolResult,
    isEditToolResult,
    isWriteToolResult,
} from "@earendil-works/pi-coding-agent";

// ─── Closure State ──────────────────────────────────────────────────────────────

let piRef: ExtensionAPI;
let currentCtx: ExtensionContext | undefined;
let tuiRef: TUI | undefined;
let footerDataProvider: ReadonlyFooterDataProvider | undefined;
let gitChanges: string = "";
let gitDiffTimer: ReturnType<typeof setTimeout> | undefined;

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatTokens(count: number): string { /* see 4.2 */ }
function shortenPath(path: string): string { /* see 4.3 */ }
function stripAnsi(str: string): string { /* see 4.4 */ }
function parseGitShortstat(output: string): string { /* see 4.1 */ }

// ─── Git Diff ───────────────────────────────────────────────────────────────────

async function refreshGitDiff(): Promise<void> { /* see 5.5 */ }
function debouncedRefreshGitDiff(): void { /* see 5.6 */ }

// ─── Renderers ──────────────────────────────────────────────────────────────────

function renderFooterLine(width: number, theme: Theme): string[] { /* see 4.5 */ }
function renderAboveWidget(width: number, theme: Theme): string[] { /* see 4.6 */ }

// ─── UI Setup & Cleanup ─────────────────────────────────────────────────────────

function setupUI(ctx: ExtensionContext): void { /* see 5.3 */ }
function cleanup(): void { /* see 5.4 */ }
function requestRefresh(): void { tuiRef?.requestRender(); }

// ─── Extension Entry Point ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
    piRef = pi;

    pi.on("session_start", async (_event, ctx) => {
        currentCtx = ctx;
        setupUI(ctx);
        refreshGitDiff();
    });

    pi.on("session_tree", async (_event, ctx) => {
        currentCtx = ctx;
        refreshGitDiff();
        requestRefresh();
    });

    pi.on("session_shutdown", async () => {
        cleanup();
    });

    pi.on("turn_end", async (_event, ctx) => {
        currentCtx = ctx;
        refreshGitDiff();
        requestRefresh();
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
        }
        requestRefresh();
    });

    pi.on("message_end", async (_event, ctx) => {
        currentCtx = ctx;
        requestRefresh();
    });
}
```

### Import Notes

- `isBashToolResult`, `isEditToolResult`, `isWriteToolResult` are exported from `@earendil-works/pi-coding-agent` (confirmed in the types file at line 670-674). These are type guard functions that check the tool name on a `ToolResultEvent`.
- `ReadonlyFooterDataProvider` is a type exported from `@earendil-works/pi-coding-agent` (re-exported from `footer-data-provider.js`).
- `TUI` is imported from `@earendil-works/pi-tui`.
- `Theme` is imported as a type from `@earendil-works/pi-coding-agent` (re-exported from `./modes/interactive/theme/theme.js`). The actual Theme instance is provided by the framework via the `setFooter`/`setWidget` factory callbacks — we only need the type annotation.
- `truncateToWidth` and `visibleWidth` are imported from `@earendil-works/pi-tui`.

---

## 9. TESTING STRATEGY

### 9.1 Manual Test Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Start pi with powerline + pi-cwd | Footer shows cwd (with ~ substitution), no branch if not in git repo, model name on right |
| Start pi in a git repo | Footer shows cwd + branch name in parens |
| Make file changes (edit tool) | Footer updates git changes after tool_result event (debounced 500ms) |
| Load pi-till-done + write_todos | Above-composer widget shows 📋 count, active items below it |
| Start rpir-workflow | Above-composer widget shows phase on right side of line 1 |
| Change model via /model | Footer updates model name and provider |
| Change thinking level | Footer updates thinking level display |
| Context grows past 70% | Context percentage turns warning color |
| Context grows past 90% | Context percentage turns error color |
| Narrow terminal (40 cols) | Footer truncates right side, then left side gracefully |
| Disable powerline, enable pi-till-done alone | pi-till-done no longer has a footer, but shows statuses in built-in footer status line |

### 9.2 Edge Cases to Verify

| Edge Case | Expected Behavior |
|-----------|-------------------|
| Not in a git repo | No branch shown, no git changes shown, `gitChanges = ""` |
| Git repo with no changes | `gitChanges = ""`, nothing shown |
| `ctx.model` is undefined | Model display shows `"no-model"`, no thinking level |
| `getContextUsage()` returns undefined | Context display shows `"?/{contextWindow}"` or omitted |
| `getContextUsage().tokens` is null (after compaction) | Context display shows `"?/{contextWindow}"` |
| pi-till-done not installed | No "till-done" or "till-done-active" status, above widget shows only rpir phase (if any) or is hidden |
| pi-rpir-workflow not installed | No "rpir-workflow" status, above widget shows only todo count (if any) or is hidden |
| Neither till-done nor rpir installed | Above widget is hidden (`undefined`) |
| Terminal width < 20 | Footer shows truncated left side only |
| `pi.exec` throws or times out | `gitChanges` remains "", no error shown |

### 9.3 Existing Tests

No existing automated tests were found for any of the extensions in scope. All testing is manual.

---

## 10. IMPLEMENTATION ORDER

Execute in this exact sequence:

### Step 1: Create `package.json`
Write the file at `/home/blake/Documents/software/pi-extensions/pi-powerline/package.json` with the content from section 7.

### Step 2: Create `index.ts` — Helpers
Write the file at `/home/blake/Documents/software/pi-extensions/pi-powerline/index.ts` starting with:
- File header comment
- All imports
- Closure state variables
- `formatTokens()`, `shortenPath()`, `stripAnsi()`, `parseGitShortstat()`

### Step 3: Create `index.ts` — Git Diff Logic
Add `refreshGitDiff()` and `debouncedRefreshGitDiff()`.

### Step 4: Create `index.ts` — Footer Renderer
Add `renderFooterLine()` implementing the logic from section 4.5.

### Step 5: Create `index.ts` — Widget Renderer
Add `renderAboveWidget()` implementing the logic from section 4.6.

### Step 6: Create `index.ts` — Setup, Cleanup, Entry Point
Add `setupUI()`, `cleanup()`, `requestRefresh()`, and the `export default function`.

### Step 7: Refactor pi-till-done — Remove setFooter and setWidget
Modify `/home/blake/Documents/software/pi-extensions/pi-till-done/index.ts`:
- Replace `updateUI` function body per section 6.1
- Clean up imports per section 6.2

### Step 8: Initialize git repo
```bash
cd /home/blake/Documents/software/pi-extensions/pi-powerline
git init
git add .
git commit -m "Initial commit: pi-powerline extension"
```

### Step 9: Manual verification
Test all scenarios from section 9.1 and edge cases from section 9.2.

---

## 11. RISKS & MITIGATIONS

| Risk | Mitigation |
|------|------------|
| Widget rendering order: "powerline-above" widget may not appear above "till-done" widget | Since till-done no longer calls setWidget, this is not an issue — powerline is the sole above-editor widget for todo/rpir content |
| `footerDataProvider` not set when widget render is called | Widget render returns `[]` if `footerDataProvider` is undefined |
| pi.exec git diff fails on Windows or unusual setups | Catch all errors, silently set `gitChanges = ""` |
| Status text from extensions contains ANSI codes (pi-cwd) | Use `stripAnsi()` when reading statuses for processing, but for rpir-workflow and till-done statuses, they will be plain text |
| Multiple rapid tool_result events cause git diff spam | Debounce with 500ms timer |
| Extension load order: pi-powerline may load before/after pi-till-done | `getExtensionStatuses()` is reactive — it always returns current statuses regardless of load order |

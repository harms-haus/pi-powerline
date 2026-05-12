# Powerline Extension — Research Findings

## 1. Extension UI Contributions Summary

### 1.1 pi-cwd (`/pi-cwd/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Method** | `ctx.ui.setStatus("cwd", text)` |
| **Key** | `"cwd"` |
| **Data Displayed** | Themed path with 📂 emoji: `ctx.ui.theme.fg("accent", "📂 ~/path")` — shown only when effective cwd differs from original cwd |
| **Clear Condition** | `ctx.ui.setStatus("cwd", undefined)` when cwd === originalCwd |
| **Update Events** | `session_start`, `session_tree`, `/cwd` command handler |

**Pattern**: Uses `updateFooterStatus()` helper that calls `ctx.ui.setStatus("cwd", ...)` with themed text or `undefined`.

### 1.2 pi-till-done (`/pi-till-done/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Methods** | `ctx.ui.setWidget("till-done", lines)` + `ctx.ui.setFooter(factory)` |
| **Widget Key** | `"till-done"` |
| **Footer Key** | N/A (full footer replacement via factory function) |
| **Widget Data** | In-progress todo items: `● [N] task text` |
| **Footer Data** | Left: `cwd (git-branch)`, Right: `📋 completed/total` |
| **Clear Conditions** | Widget: `setWidget("till-done", undefined)` when no in-progress items. Footer: `setFooter(undefined)` when no todos exist. |
| **Update Events** | `session_start`, `session_tree`, after every `write_todos`/`edit_todos` execution |

**Critical Footer Pattern**: The footer is a **factory function** receiving `(tui, theme, footerData)`:
```ts
ctx.ui.setFooter((tui, theme, footerData) => {
  let cachedWidth: number | undefined;
  let cachedLine: string | undefined;
  return {
    dispose: footerData.onBranchChange(() => tui.requestRender()),
    invalidate() { cachedWidth = undefined; cachedLine = undefined; },
    render(width: number): string[] {
      const branch = footerData.getGitBranch();
      const left = theme.fg("dim", branch ? `${cwd} (${branch})` : cwd);
      const right = theme.fg("accent", `📋 ${completed}/${total}`);
      // ... layout with padding ...
      return [cachedLine];
    },
  };
});
```
Uses `footerData.onBranchChange()` for reactive git updates, and `footerData.getGitBranch()` for current branch. Caches rendered line by width. Uses `truncateToWidth` and `visibleWidth` from `@earendil-works/pi-tui`.

### 1.3 pi-steer (`/pi-steer/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Method** | `ctx.ui.setWidget("pi-steer", lines)` |
| **Widget Key** | `"pi-steer"` |
| **Data Displayed** | Pending steering messages: `⚑ Steering: message` or `⚑ Steering (N queued):` with `• msg` bullets |
| **Clear Conditions** | Widget cleared on `session_start`, `session_shutdown`, `agent_end` |
| **Update Events** | `/steer` command handler (when agent not idle) |

**Pattern**: Purely widget-based. No footer interaction. Simple themed string array.

### 1.4 pi-rpir-workflow (`/pi-rpir-workflow/src/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Method** | `ctx.ui.setStatus("rpir-workflow", text)` |
| **Key** | `"rpir-workflow"` |
| **Data Displayed** | Phase emoji + name: `🔍 Research`, `🔨 Implementing [2/5]` |
| **Clear Condition** | `ctx.ui.setStatus("rpir-workflow", undefined)` when workflow inactive/done |
| **Update Events** | `session_start`, `session_tree`, `turn_end`, `/rpir-workflow` command, `workflow_step` tool execution |

**Pattern**: Uses `updateStatus()` helper. Phase-specific emojis: IDLE=⏸️, RESEARCH=🔍, PLANNING=📋, IMPLEMENTING=🔨, REVIEWING=👁️, DONE=✅.

### 1.5 pi-lsp (`/pi-lsp/src/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Methods** | None (no `setStatus`, `setWidget`, `setFooter`, or `setWorkingIndicator` calls) |
| **UI Interaction** | Only uses `ctx.ui.notify()` for status messages and `ctx.ui.confirm()` for install prompts |
| **Commands** | `/lsp-status` — shows running servers via `ctx.ui.notify()` |

**Conclusion**: pi-lsp does NOT contribute to footer/widget/status bar. No integration needed.

### 1.6 pi-lint (`/pi-lint/src/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Methods** | None (no `setStatus`, `setWidget`, `setFooter`, or `setWorkingIndicator` calls) |
| **UI Interaction** | Only uses `ctx.ui.notify()` for detection results and `/lint-status` command |
| **Commands** | `/lint-status` — shows detected linters via `ctx.ui.notify()` |

**Conclusion**: pi-lint does NOT contribute to footer/widget/status bar. No integration needed.

### 1.7 pi-subagents (`/pi-subagents/src/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Methods** | None directly — uses tool `renderResult` for inline TUI display, not `setWidget`/`setFooter`/`setStatus` |
| **Commands** | `/profile` — profile management, uses `ctx.ui.notify()`/`ctx.ui.confirm()`/`ctx.ui.input()` |

**Conclusion**: pi-subagents does NOT contribute to footer/widget/status bar. Subagent progress is rendered via tool result components, not via the footer/widget system. No integration needed.

### 1.8 pi-web-content (`/pi-web-content/src/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Methods** | None |
| **UI Interaction** | Registers tools only (`fetch-content`, `fetch-repo`) with no UI hooks |

**Conclusion**: pi-web-content does NOT contribute to footer/widget/status bar. No integration needed.

### 1.9 pi-acp (`/pi-acp/src/index.ts`)

| Aspect | Detail |
|---|---|
| **UI Methods** | None — pi-acp is a standalone ACP transport process (stdin/stdout JSON-RPC), not a pi extension |
| **Architecture** | Runs as a separate Node.js process, not loaded as an extension via `ExtensionAPI` |

**Conclusion**: pi-acp is NOT a pi extension. It's a transport layer for ACP protocol. No integration needed.

---

## 2. API Surface Analysis

### 2.1 `ctx.ui.setStatus(key, text)` — Status Bar Items

This is the **keyed status bar** API. Multiple extensions can coexist:
- `setExtensionStatus(key, text)` stores in a `Map<string, string>`
- `getExtensionStatuses()` returns `ReadonlyMap<string, string>`
- The built-in footer reads these via `footerData.getExtensionStatuses()`

**Current users**:
| Extension | Key | Format |
|---|---|---|
| pi-cwd | `"cwd"` | `theme.fg("accent", "📂 ~/path")` or `undefined` |
| pi-rpir-workflow | `"rpir-workflow"` | `🔍 Research`, `🔨 Implementing [2/5]`, or `undefined` |

### 2.2 `ctx.ui.setWidget(key, content)` — Above-Composer Widgets

Keyed widget API. Multiple extensions can coexist with different keys.

**Current users**:
| Extension | Key | Content |
|---|---|---|
| pi-till-done | `"till-done"` | In-progress todo items (string array) |
| pi-steer | `"pi-steer"` | Pending steering messages (string array) |

### 2.3 `ctx.ui.setFooter(factory)` — Full Footer Replacement

**Single-winner API**: Only ONE extension can own the footer at a time. The last `setFooter()` call wins.

**Current user**:
- **pi-till-done**: Sets a custom footer when todos exist, restores `undefined` when done.

**Built-in footer** (shown when no extension calls `setFooter`): Shows cwd, git branch, token stats, context usage, extension statuses.

### 2.4 `footerData` (ReadonlyFooterDataProvider)

Available inside `setFooter()` factory:
- `getGitBranch(): string | null` — current branch, null if not in repo, "detached" if detached HEAD
- `getExtensionStatuses(): ReadonlyMap<string, string>` — all `setStatus()` key-value pairs
- `getAvailableProviderCount(): number` — number of providers
- `onBranchChange(callback): () => void` — reactive subscription to git changes

---

## 3. Conflict Analysis

### 3.1 CRITICAL: Footer Ownership Conflict

**Problem**: `ctx.ui.setFooter()` is a single-winner API. Only one extension can own the footer.

**Current behavior**:
- When pi-till-done has active todos → it owns the footer
- When pi-till-done has no todos → it calls `setFooter(undefined)` → built-in footer restored
- If powerline calls `setFooter()` → it would conflict with pi-till-done's calls

**Resolution needed**: The powerline extension must be the **sole owner** of `setFooter()`. pi-till-done must stop calling `setFooter()` entirely. Instead:
- pi-till-done continues to use `setWidget("till-done", ...)` for in-progress items (or powerline could take this over)
- pi-till-done should use `setStatus("till-done-progress", ...)` to report progress to the powerline footer
- Powerline reads all statuses via `footerData.getExtensionStatuses()` and renders them in a unified footer

### 3.2 NO CONFLICT: setStatus Keys Are Independent

pi-cwd uses key `"cwd"` and pi-rpir-workflow uses key `"rpir-workflow"`. These coexist fine. The powerline footer will simply read them via `footerData.getExtensionStatuses()`.

### 3.3 NO CONFLICT: setWidget Keys Are Independent

pi-till-done uses `"till-done"` and pi-steer uses `"pi-steer"`. These coexist fine. Powerline does not need to take over widgets (though it could if desired).

---

## 4. Data Aggregation Requirements

### 4.1 Data Sources for Powerline Footer

The powerline footer must aggregate:

| Source | API | Data | Currently Provided By |
|---|---|---|---|
| CWD | `ctx.cwd` | Current working directory | pi-till-done (in its footer) |
| Git Branch | `footerData.getGitBranch()` | Branch name or null | pi-till-done (via footerData) |
| Extension Statuses | `footerData.getExtensionStatuses()` | Map of key→themed text | Built-in footer provider |
| CWD Override | `footerData.getExtensionStatuses().get("cwd")` | Custom CWD status | pi-cwd via `setStatus("cwd", ...)` |
| Workflow Phase | `footerData.getExtensionStatuses().get("rpir-workflow")` | Phase status | pi-rpir-workflow via `setStatus("rpir-workflow", ...)` |
| Todo Progress | Needs new `setStatus("till-done", ...)` | Progress like `📋 2/5` | Currently pi-till-done only puts this in its custom footer |
| Token/Context | `ctx.sessionManager` + `ctx.model` | Token usage stats | Built-in footer (pi-till-done does NOT show these) |
| Provider Count | `footerData.getAvailableProviderCount()` | Model provider count | Built-in footer |

### 4.2 Required Changes to Existing Extensions

**pi-till-done** (MUST change):
- Remove `ctx.ui.setFooter()` calls entirely
- Instead, use `ctx.ui.setStatus("till-done", theme.fg("accent", "📋 2/5"))` for progress
- Continue using `setWidget("till-done", ...)` for in-progress items above composer (or delegate to powerline)
- Clear status with `ctx.ui.setStatus("till-done", undefined)` when no todos

**pi-cwd** (No change needed):
- Already uses `setStatus("cwd", ...)` correctly
- Powerline reads this via `footerData.getExtensionStatuses()`

**pi-rpir-workflow** (No change needed):
- Already uses `setStatus("rpir-workflow", ...)` correctly
- Powerline reads this via `footerData.getExtensionStatuses()`

**pi-steer** (No change needed):
- Uses `setWidget("pi-steer", ...)` — no footer involvement

---

## 5. Footer Architecture Reference

### 5.1 Built-in Footer Pattern (from types)

The built-in `FooterComponent` renders:
- pwd/git branch on the left
- token stats and context usage
- extension statuses

It implements `Component` with `render(width: number): string[]`.

### 5.2 pi-till-done Footer Pattern (the pattern to replace)

```typescript
ctx.ui.setFooter((tui, theme, footerData) => {
  let cachedWidth: number | undefined;
  let cachedLine: string | undefined;
  return {
    dispose: footerData.onBranchChange(() => tui.requestRender()),
    invalidate() { cachedWidth = undefined; cachedLine = undefined; },
    render(width: number): string[] {
      // Build left (cwd+branch) and right (progress) strings
      // Pad with spaces to fill width
      // Cache by width for performance
      return [line];
    },
  };
});
```

Key behaviors to preserve:
- **Caching by width**: Re-renders only when width changes (for performance)
- **Branch reactivity**: Subscribes to `footerData.onBranchChange()` for git updates
- **Theming**: Uses `theme.fg()` for colored output
- **Layout**: Left-aligned content + right-aligned content with gap fill
- **Dispose pattern**: Returns cleanup function

### 5.3 Imports Required

From pi-till-done's footer implementation:
```typescript
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
```

These are essential for proper terminal width handling.

---

## 6. Powerline Design Recommendations

### 6.1 Segments (Left to Right)

A powerline-style footer should render these segments:

1. **CWD**: `ctx.cwd` (abbreviated with `~` for home)
2. **Git Branch**: `footerData.getGitBranch()` — show as `(branch)` or omit if null
3. **Extension Statuses**: Iterate `footerData.getExtensionStatuses()` — show cwd override, workflow phase, todo progress
4. **Right-aligned**: Token/context stats (from session)

### 6.2 Integration Approach

1. **Powerline calls `setFooter()` once** on `session_start` with a factory that reads all data reactively
2. **Subscribe to `footerData.onBranchChange()`** for git reactivity
3. **Subscribe to extension status changes** — need a mechanism; currently no `onStatusChange()` callback exists. Options:
   - Poll in `render()` (simple, since render is called on every TUI frame)
   - Or have each extension call `tui.requestRender()` after `setStatus()` — but extensions don't have `tui` access
   - **Best option**: Just read statuses fresh in each `render()` call since `getExtensionStatuses()` is synchronous and cheap
4. **Other extensions continue using `setStatus()`** for their data, and powerline picks it up

### 6.3 What Powerline Must NOT Do

- Must NOT call `setWidget()` for other extensions' data (that's still their responsibility)
- Must NOT interfere with pi-steer's `"pi-steer"` widget or pi-till-done's `"till-done"` widget
- Must NOT duplicate data that `setStatus()` already provides

---

## 7. Summary Table: All UI Contributions

| Extension | setStatus (key) | setWidget (key) | setFooter | Events for UI Update |
|---|---|---|---|---|
| **pi-cwd** | `"cwd"` (📂 path) | — | — | `session_start`, `session_tree`, `/cwd` cmd |
| **pi-till-done** | — (needs migration) | `"till-done"` (in-progress items) | **YES** (cwd + branch + progress) | `session_start`, `session_tree`, tool execution |
| **pi-steer** | — | `"pi-steer"` (queued messages) | — | `/steer` cmd, `agent_end`, `session_start` |
| **pi-rpir-workflow** | `"rpir-workflow"` (phase emoji) | — | — | `session_start`, `session_tree`, `turn_end`, cmd, tool |
| **pi-lsp** | — | — | — | — |
| **pi-lint** | — | — | — | — |
| **pi-subagents** | — | — | — | — |
| **pi-web-content** | — | — | — | — |
| **pi-acp** | — | — | — | (not an extension) |

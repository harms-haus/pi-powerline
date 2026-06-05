# pi-powerline

A centralized powerline status bar extension for [pi coding agent](https://pi.dev). Replaces the built-in footer and consolidates status displays from all your extensions into a unified, purpose-designed layout.

## Installation

```bash
pi install git:github.com/harms-haus/pi-powerline
```

Then restart pi or run `/reload`.

## Layout

### Above the Composer

Top to bottom rendering order:

1. Active todo/task items (one per line, from `pi-til-done`)
2. **Kanban claimed tasks** — one line per claimed task (from `pi-kanban`)
3. Progress line — todo/task count on the left, workflow phase on the right
4. **Kanban summary line** — `[done/total] N claimed, N ready, N blocked`

| Left                                  | Right                                         |
| ------------------------------------- | --------------------------------------------- |
| Todo/task count (`📋 6/10`)           | RPIR workflow phase (`🔬 Implementing [2/5]`) |
| Active todo/task items (one per line) |                                               |
| Kanban claimed tasks (phase icon, id, title) |                                        |
| Kanban summary (`[2/4] 2 claimed, 1 ready, 1 blocked`) |                          |

### Below the Composer (Footer)

**Line 1:**

| Left                                          | Right                                            |
| --------------------------------------------- | ------------------------------------------------ |
| Working directory (`~/project`)               | Context usage (`15k/1.0M 1.5%`)                  |
| Git branch (`(main)`)                         | Model & thinking level (`qwen3.6-plus • medium`) |
| Git changes (`+388 -124`)                     |                                                  |

The working directory display uses the `pi-cwd` effective CWD when available (falls back to `ctx.cwd`). When the terminal width is constrained, path compression is applied — preserving `~` and the final directory name while abbreviating intermediate directories to their shortest unique prefix. For example, `~/Documents/software/pi-extensions/pi-powerline` becomes `~/Doc/s/pi-e/pi-powerline` in a narrow terminal. Hidden directories (starting with `.`) are excluded from sibling enumeration. When the `pi-git` extension is active, pi-git manages its own CWD display and path compression is not applied.

**Line 2** (shown when LSP/lint data or ZAI usage is available):

| Left                                | Center                               | Right                               |
| ----------------------------------- | ------------------------------------ | ----------------------------------- |
| Process count (from `pi-processes`) | LSP and lint status (center-aligned) | ZAI usage bar (from `pi-zai-usage`) |

### ZAI Usage Bar

When using a Z.ai model, a thin progress bar appears on the right side of Line 2:

```
━━━━━━━━━╸─── 80% 2h 15m
```

- Uses box-drawing characters (`━╸─`) for a thin, terminal-native look
- Color-coded percentage: muted (≤70%), yellow (>70%), red (>90%); bar and timer always muted
- Shows percentage and time until quota reset
- Only visible when `pi-zai-usage` is installed and a ZAI model is active

## Code Health Status Display (pi-lens)

The footer's second line displays real-time code health status when data is provided by the `pi-lens` extension. All four checks are displayed together, center-aligned within the available width.

### Status Key

`"pi-lens"` — a single status key carrying all check results.

### Payload Format

```json
{
  "prettier": "clean",
  "linters": "issues",
  "lsp": "clean",
  "tsc": "skipped"
}
```

Each field is a `CheckStatus` string:

| Value        | Icon | Color    | Meaning                          |
| ------------ | ---- | -------- | -------------------------------- |
| `"pending"`  | `○`  | dim      | Not yet started                  |
| `"running"`  | `⟳`  | warning  | Currently executing              |
| `"clean"`    | `✓`  | success  | No problems found                |
| `"issues"`   | `✗`  | error    | Problems detected                |
| `"error"`    | `⚠`  | error    | Check failed to run              |
| `"skipped"`  | `—`  | dim      | Not applicable / skipped         |

### Example

```
✓prettier ✗linters ✓lsp —tsc
```

| Segment       | Meaning                            |
| ------------- | ---------------------------------- |
| `✓prettier`   | Prettier formatting: clean         |
| `✗linters`    | Linters: issues found              |
| `✓lsp`        | Language server: clean             |
| `—tsc`        | TypeScript compiler: skipped       |

The four checks are displayed in order: `prettier`, `linters`, `lsp`, `tsc`. Each check renders as `{icon}{label}` with the icon color-coded by status. The entire block is center-aligned within the available width.

### Data Source

- **pi-lens** — calls `ctx.ui.setStatus("pi-lens", JSON.stringify({ prettier, linters, lsp, tsc }))` where each field is a `CheckStatus` string
- If the payload is not valid JSON, the raw string is displayed as a muted fallback

### CWD Status

- **Key**: `"cwd"` (set by `@harms-haus/pi-cwd` extension)
- **Format**: `JSON.stringify({ cwd: displayPath })` where `displayPath` has `$HOME` replaced with `~`
- **Cleared** (set to `undefined`) when the effective CWD matches the original process CWD
- When present, pi-powerline uses this path instead of `ctx.cwd`

## Features

- **Smart path compression** — abbreviates intermediate directory names to their shortest unique prefix when the terminal width is constrained
- **Unified footer** — single footer replaces all individual extension footers
- **Git integration** — shows current branch (reactive) and diff stats (`+N -N`)
- **Context awareness** — displays token usage with color warnings (yellow >70%, red >90%)
- **Model info** — shows current provider, model, and thinking level
- **Extension consolidation** — reads statuses from other extensions via `ctx.ui.setStatus()`:
  - `pi-til-done` — todo progress and active items
  - `pi-tasks` — phased task progress and active tasks (shares the same slot as `pi-til-done`; latest update wins)
  - `pi-rpir-workflow` — current workflow phase
  - `pi-cwd` — changed working directory
  - `pi-lens` — code health checks (prettier, linters, LSP, TSC; each pending/running/clean/issues/error/skipped)
  - `pi-processes` — active process count
  - `pi-git` — enriched git status (branch, diff stats, file counts)
  - `kanban` — kanban board status from `pi-kanban` (JSON: `{ total, claimed, ready, blocked, done, claimedTasks: [{ id, title, phase }] }`)
  - `zai-usage` — Z.ai token quota usage (JSON: `{ percentage, resetTimeMs }`)
- **Smart truncation** — gracefully handles narrow terminals while preserving context warnings
- **Debounced git polling** — efficient `git diff` updates (debounced 500ms always)

### Kanban Rendering Example

When `pi-kanban` is installed and tasks are in progress:

```
⚙️ [kb-2] Implement endpoints
👁 [kb-4] Review PR
[2/4] 2 claimed, 1 ready, 1 blocked
```

- Claimed tasks show **phase icons**: 🧪 test, ⚙️ implement, 👁 review
- The summary line is color-coded: claimed = warning, ready = success, blocked = error
- Only non-zero counts are shown in the summary
- The kanban section is hidden when all tasks are done

## Path Compression

When the CWD path exceeds the available footer width, pi-powerline compresses path segments to make it fit.

### How It Works

Segments are compressed from the root outward, one at a time, until the rendered path fits within the available width. Each compression level shortens the next innermost intermediate directory.

### Algorithm

Each directory name is shortened to the minimum prefix that distinguishes it from its sibling directories. For example, `pi-powerline` among siblings `[pi-powerline, pi-processes]` compresses to `pi-po` — the prefix `pi-p` is insufficient because it also matches `pi-processes`.

### Exclusions

- The **root segment** (`~` or `/`) is never compressed
- The **leaf directory** (last segment) is never compressed
- **Hidden directories** (starting with `.`) are excluded from sibling enumeration, so they don't affect prefix calculations

### Caching

Compression results are cached per path and invalidated on session start and footer disposal.

### pi-git Override

When the `pi-git` extension is active, pi-git manages its own CWD display and path compression is not applied.

## Compatibility

Works alongside any extension that uses `ctx.ui.setStatus()`. Extensions that call `ctx.ui.setFooter()` will conflict — only one extension can own the footer at a time.

## Related Extensions

- [pi-til-done](https://github.com/harms-haus/pi-til-done) — Todo list with auto-continue
- [pi-tasks](https://github.com/harms-haus/pi-tasks) — Phased task workflow with dependency tracking
- [pi-rpir-workflow](https://github.com/harms-haus/pi-rpir-workflow) — 4-phase development workflow
- [pi-cwd](https://github.com/harms-haus/pi-cwd) — Working directory management

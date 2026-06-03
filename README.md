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

| Left                            | Right                                            |
| ------------------------------- | ------------------------------------------------ |
| Working directory (`~/project`) | Context usage (`15k/1.0M 1.5%`)                  |
| Git branch (`(main)`)           | Model & thinking level (`qwen3.6-plus • medium`) |
| Git changes (`+388 -124`)       |                                                  |

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

## LSP and Lint Status Display

The footer's second line displays real-time LSP server and linter status when data is provided by the `pi-lsp` and `pi-lint` extensions.

### LSP Status

- **Active** servers (currently running) are shown in normal text color
- **Available** servers (installed but not running) are shown in muted color
- Each language shows a status icon:
  - ✓ (green) — clean, no diagnostics
  - ✗ (red) — dirty, has diagnostics
  - ✓ (dim) — state unknown (e.g. available but not checked)

### Lint Status

- Shows only **configured** linters (those detected in the current project)
- Each linter shows a status icon:
  - ✓ (green) — clean, no issues
  - ✗ (red) — dirty, has issues
- All configured linters are displayed in normal text color

### Example

```
✓typescript ✗rust • ✓ESLint ✗Biome
```

| Segment       | Meaning                                   |
| ------------- | ----------------------------------------- |
| `✓typescript` | Active LSP server, clean                  |
| `✗rust`       | Available (not running) LSP server, dirty |
| `✓ESLint`     | Configured linter, clean                  |
| `✗Biome`      | Configured linter, dirty                  |

LSP and lint groups are separated by a dim `•` bullet. The entire status block is center-aligned within the available width.

### Data Source

- **LSP** — `pi-lsp` extension calls `ctx.ui.setStatus("pi-lsp", JSON.stringify({ languages: [{ name, state, clean }] }))` where `state` is `"active"` or another value, and `clean` is `true`, `false`, or `null`
- **Lint** — `pi-lint` extension calls `ctx.ui.setStatus("pi-lint", JSON.stringify({ linters: [{ name, clean }] }))` where `clean` is `true` or `false`

Both use structured JSON payloads. If the payload is not valid JSON, the raw string is displayed as a muted fallback.

## Features

- **Unified footer** — single footer replaces all individual extension footers
- **Git integration** — shows current branch (reactive) and diff stats (`+N -N`)
- **Context awareness** — displays token usage with color warnings (yellow >70%, red >90%)
- **Model info** — shows current provider, model, and thinking level
- **Extension consolidation** — reads statuses from other extensions via `ctx.ui.setStatus()`:
  - `pi-til-done` — todo progress and active items
  - `pi-tasks` — phased task progress and active tasks (shares the same slot as `pi-til-done`; latest update wins)
  - `pi-rpir-workflow` — current workflow phase
  - `pi-cwd` — changed working directory
  - `pi-lsp` — language server status (active/available, clean/dirty)
  - `pi-lint` — configured linter status (clean/dirty)
  - `pi-processes` — active process count
  - `pi-git` — enriched git status (branch, diff stats, file counts)
  - `kanban` — kanban board status from `pi-kanban` (JSON: `{ total, claimed, ready, blocked, done, claimedTasks: [{ id, title, phase }] }`)
  - `zai-usage` — Z.ai token quota usage (JSON: `{ percentage, resetTimeMs }`)
- **Smart truncation** — gracefully handles narrow terminals while preserving context warnings
- **Debounced git polling** — efficient `git diff` updates (debounced 500ms on file changes, immediate on turn end)

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

## Compatibility

Works alongside any extension that uses `ctx.ui.setStatus()`. Extensions that call `ctx.ui.setFooter()` will conflict — only one extension can own the footer at a time.

## Related Extensions

- [pi-til-done](https://github.com/harms-haus/pi-til-done) — Todo list with auto-continue
- [pi-tasks](https://github.com/harms-haus/pi-tasks) — Phased task workflow with dependency tracking
- [pi-rpir-workflow](https://github.com/harms-haus/pi-rpir-workflow) — 4-phase development workflow
- [pi-cwd](https://github.com/harms-haus/pi-cwd) — Working directory management

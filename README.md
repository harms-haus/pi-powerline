# pi-powerline

A centralized powerline status bar extension for [pi coding agent](https://pi.dev). Replaces the built-in footer and consolidates status displays from all your extensions into a unified, purpose-designed layout.

## Installation

```bash
pi install git:github.com/harms-haus/pi-powerline
```

Then restart pi or run `/reload`.

## Layout

### Above the Composer

| Left | Right |
|------|-------|
| Todo count (`📋 6/10`) | RPIR workflow phase (`🔬 Implementing [2/5]`) |
| Active todo items (one per line) | |

### Below the Composer (Footer)

| Left | Right |
|------|-------|
| Working directory (`~/project`) | Context usage (`15k/1.0M 1.5%`) |
| Git branch (`(main)`) | Model & thinking level (`qwen3.6-plus • medium`) |
| Git changes (`+388 -124`) | |

## Features

- **Unified footer** — single footer replaces all individual extension footers
- **Git integration** — shows current branch (reactive) and diff stats (`+N -N`)
- **Context awareness** — displays token usage with color warnings (yellow >70%, red >90%)
- **Model info** — shows current provider, model, and thinking level
- **Extension consolidation** — reads statuses from other extensions via `ctx.ui.setStatus()`:
  - `pi-til-done` — todo progress and active items
  - `pi-rpir-workflow` — current workflow phase
  - `pi-cwd` — changed working directory
- **Smart truncation** — gracefully handles narrow terminals while preserving context warnings
- **Debounced git polling** — efficient `git diff` updates (debounced 500ms on file changes, immediate on turn end)

## Compatibility

Works alongside any extension that uses `ctx.ui.setStatus()`. Extensions that call `ctx.ui.setFooter()` will conflict — only one extension can own the footer at a time.

## Related Extensions

- [pi-til-done](https://github.com/harms-haus/pi-til-done) — Todo list with auto-continue
- [pi-rpir-workflow](https://github.com/harms-haus/pi-rpir-workflow) — 4-phase development workflow
- [pi-cwd](https://github.com/harms-haus/pi-cwd) — Working directory management

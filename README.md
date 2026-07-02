# LoganTerminal

Cross-platform terminal built for AI coding agents (Claude Code, Codex, Aider, etc.) where dragging images and feeding visual context into the terminal is a first-class operation.

## Status

Phases 1–4 all in (Phase 3's OSC 133 prompt framing deliberately deferred). Daily-usable, still pre-1.0.

## Stack

- **Shell**: Tauri 2 (Rust backend, React 19 + TS + Vite + Tailwind 4 frontend)
- **Terminal**: `@xterm/xterm` v6 + fit / web-links addons
- **PTY**: `portable-pty` (cross-platform ConPTY / openpty)
- **State**: zustand

## What works today

- Multi-tab terminal sessions: each tab is an independent PTY, new tabs inherit the current tab's cwd, hidden tabs stay alive (scrollback + shell process preserved). Shortcuts: ⌘T new tab, ⌘⇧W close tab, ⌘⇧]/⌘⇧[ cycle, ⌘1-9 jump.
- Scrollback search (⌘F): find bar with match count, ↩/⇧↩ next/previous, warm-accent match highlighting, prefilled from the terminal selection. Plus a scroll-to-bottom pill whenever the viewport is scrolled up.
- Background-tab activity: a tab that produces output (or exits) while hidden gets an unread dot — glance at the tab strip to see which agent finished. Exited tabs show a struck-through label and an "exited" status instead of silently looking alive.
- Tab layout (count + each tab's last-known cwd) is remembered across app restarts via `localStorage`, up to 9 tabs. Not a full session reattach — each restored tab gets a fresh shell at its old directory, not its old scrollback/process.
- A brand-new tab with no directory to inherit starts in `~/Documents` instead of whatever the OS handed the process (falls back gracefully if that folder doesn't exist).
- xterm.js terminal wired to a real shell via `portable-pty` (macOS zsh / Windows PowerShell defaults, resize-synced)
- Drag any file(s) from Finder / Explorer into the window → paths are escaped for the active shell (POSIX quoting on macOS/Linux, PowerShell quoting on Windows) and inserted at the cursor. Drop overlay previews thumbnails for image files.
- Left FileTree that follows the shell's cwd via OSC 7 (an auto-generated zsh hook is injected via `ZDOTDIR`, chaining the user's own `~/.zshrc` first). Header buttons toggle dotfiles (persisted) and refresh the listing; path handling is separator-aware so it also behaves on Windows.
- Right AssetPanel that shows:
  - Clipboard history (last 20 text or image items, images thumbnailed and stored as PNG under `~/.logan-terminal/clipboard/`)
  - Recent screenshots picked up from macOS's screenshot location (respecting `defaults com.apple.screencapture location`) or Windows' `Pictures/Screenshots`
- Agent detection: polls each PTY session's process tree every 2s for known CLIs (`claude`, `codex`, `aider`, `amp`, `cline`, `cursor-agent`, `gemini`, `goose`, `opencode`, `kiro`) and shows a badge in the header when one is running. Normalizes Windows' `.exe`-suffixed process names so detection works on both platforms.
- Desktop notifications from OSC 9 / 99 / 777 sequences (iTerm/wezterm-style, urxvt-style, Kitty-style) routed through the OS notification centre.
- Settings panel (⌘, or the gear button): theme picker, accent color override (presets + custom picker), font size, hidden-files toggle. All persisted, all applied live.
- Four built-in themes (Warm Dark, Midnight, Moss, Latte-light) defined once in `src/themes.ts` — the same source drives the Tailwind CSS variables and the xterm ANSI palette, so UI chrome and terminal colors can't drift apart. The accent override recolors everything: cursor, selection, borders, grid pattern, scrollbars, search highlights.
- Default look: warm dark with a subtle Claude-orange grid pattern; xterm cursor and accents in Claude coral (`#d97757`).

## Roadmap

| Phase | Goal |
| --- | --- |
| 1 | Tauri + xterm + PTY + drag-drop file path insert + read-only file tree — **done** |
| 2 | Clipboard panel with image thumbnails, screenshot watcher, drop-image UX — **done** |
| 3 | Claude Code integration: agent process detection + OSC 9/99/777 notifications — **done**. Left for later: OSC 133 shell-integration for prompt/output framing, multi-tab. |
| 4 | Polish — multi-tab (**done**), lightweight tab-layout restore (**done**), settings panel (**done**), themes (**done**) |
| next | OSC 133 prompt/output framing, asset image lightbox, tab drag-reorder, session reattach exploration |

## Develop

```sh
npm install
npm run tauri dev
```

Requires Rust (`rustup`) and Node 20+.

Unit tests: `cd src-tauri && cargo test` — 30 tests covering the OSC parser, notification format matcher, screenshot filename recognizer, default start directory, Windows agent-name normalization, clipboard image-file cleanup, and directory listing (hidden-file filtering + sort order).

## Directory layout

```
src/                   # React app
  components/
    Terminal/            # xterm.js wrapper (one instance per tab)
    TabBar/              # tab strip: switch/close/new
    FileTree/            # left sidebar, follows active tab's cwd
    AssetPanel/          # right sidebar (clipboard + screenshots)
    DropOverlay/         # translucent drop feedback
    Settings/            # ⌘, modal: theme / accent / font size / dotfiles
  stores/                # zustand (ptyStore = tabs, settingsStore = theme + font size + dotfiles)
  lib/                   # shell-escape + cross-platform path display helpers
  themes.ts              # theme definitions: CSS tokens + xterm palettes from one source
src-tauri/src/         # Rust backend
  pty.rs                 # portable-pty + OSC 7 parser + notification parser + shell hook
  fs.rs                  # fs_list_dir / fs_home_dir
  clipboard.rs           # arboard-based clipboard monitor
  screenshots.rs         # notify-based screenshot watcher
  agents.rs              # sysinfo-based agent detection
  lib.rs                 # tauri entry, wires everything up
```

## Why not just use cmux?

[cmux](https://github.com/manaflow-ai/cmux) is the closest neighbour and it's great — but it's macOS-only (Swift + libghostty) and GPL-3.0. LoganTerminal targets macOS + Windows with a permissive license and puts image/clipboard "asset feeding" at the centre of the UX rather than as a side feature.

## License

MIT — see [LICENSE](LICENSE).

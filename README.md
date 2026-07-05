# LoganTerminal

Cross-platform terminal built for AI coding agents (Claude Code, Codex, Aider, etc.) where dragging images and feeding visual context into the terminal is a first-class operation.

## Status

Phases 1–11 in: multi-tab + split panes, command palette, 8 themes, GPU rendering, OSC 133 shell integration (zsh + bash), and an agent-fleet workflow layer (broadcast input, prompt library, attention routing, prompt cadence timer, agent overview dashboard, git-branch awareness, one-action fleet spawn, worktree-per-agent flows). Daily-usable, still pre-1.0.

## Stack

- **Shell**: Tauri 2 (Rust backend, React 19 + TS + Vite + Tailwind 4 frontend)
- **Terminal**: `@xterm/xterm` v6 + fit / web-links addons
- **PTY**: `portable-pty` (cross-platform ConPTY / openpty)
- **State**: zustand

## What works today

- Multi-tab terminal sessions: each tab is an independent PTY, new tabs inherit the current tab's cwd, hidden tabs stay alive (scrollback + shell process preserved). Tabs are labelled by the shell/app-set window title (OSC 0/2 — Claude Code updates it live) with the cwd as fallback. Shortcuts: ⌘T new tab, ⌘⇧W close tab/pane, ⌘⇧]/⌘⇧[ cycle, ⌘1-9 jump, drag to reorder.
- Split panes, tmux-style: ⌘D split right, ⌘⇧D split down, ⌘⌥arrows to move focus geometrically, draggable dividers, ⌘⇧Z zoom (temporarily maximize a pane without killing its siblings). Per-pane unread dots show which background split produced output. The pane tree is part of the persisted tab snapshot.
- Command palette (⌘P): fuzzy-searchable access to every tab/pane/terminal/appearance action, with your recently-run commands surfaced first and ranked higher while searching.
- Shell integration (OSC 133, auto-injected for zsh and bash): ⌘↑/⌘↓ jump between prompts, ⌘⇧A selects the last command's output, failed commands get a red tick on the overview ruler and an "exit N" chip in the header, commands ≥ 2s show their duration next to it. A command that takes ≥ 10s and finishes while the window is unfocused (or its tab hidden) fires a desktop notification — great for long agent runs; toggleable in settings. On bash ≥ 4.4 everything works; macOS's stock bash 3.2 lacks `PS0`, so there the exit chip clears one prompt late and duration/⌘⇧A are unavailable — the rest degrades gracefully.
- Scrollback search (⌘F): find bar with match count, ↩/⇧↩ next/previous, warm-accent match highlighting, prefilled from the terminal selection. Plus a scroll-to-bottom pill whenever the viewport is scrolled up.
- GPU rendering via the xterm WebGL addon (DOM-renderer fallback), Unicode 11 widths so emoji/CJK-heavy AI CLI output lines up, smooth scrolling.
- Background-tab activity: a tab that produces output (or exits) while hidden gets an unread dot — glance at the tab strip to see which agent finished. Exited tabs show a struck-through label and an "exited" status instead of silently looking alive.
- Tab layout (count + each tab's last-known cwd) is remembered across app restarts via `localStorage`, up to 9 tabs. Not a full session reattach — each restored tab gets a fresh shell at its old directory, not its old scrollback/process.
- A brand-new tab with no directory to inherit starts in `~/Documents` instead of whatever the OS handed the process (falls back gracefully if that folder doesn't exist).
- xterm.js terminal wired to a real shell via `portable-pty` (macOS zsh / Windows PowerShell defaults, resize-synced)
- Drag any file(s) from Finder / Explorer into the window → paths are escaped for the active shell (POSIX quoting on macOS/Linux, PowerShell quoting on Windows) and inserted at the cursor. Drop overlay previews thumbnails for image files.
- Left FileTree that follows the shell's cwd via OSC 7 (auto-generated hooks: `ZDOTDIR` for zsh, `--rcfile` for bash — both chain the user's own rc files first). Shells start as login shells (zsh via `-l` + chain stubs, bash by emulating the `/etc/profile` → `~/.bash_profile` sequence), so PATH entries from `~/.zprofile` — Homebrew, nvm — survive a Dock/Finder launch where no terminal environment is inherited. Header buttons toggle dotfiles (persisted) and refresh the listing; path handling is separator-aware so it also behaves on Windows.
- Right AssetPanel that shows:
  - Clipboard history (last 20 text or image items, images thumbnailed and stored as PNG under `~/.logan-terminal/clipboard/`)
  - Recent screenshots picked up from macOS's screenshot location (respecting `defaults com.apple.screencapture location`) or Windows' `Pictures/Screenshots`
- Agent detection: polls each PTY session's process tree every 2s for known CLIs (`claude`, `codex`, `aider`, `amp`, `cline`, `cursor-agent`, `gemini`, `goose`, `opencode`, `kiro`) and shows a badge in the header when one is running. Normalizes Windows' `.exe`-suffixed process names so detection works on both platforms.
- Desktop notifications from OSC 9 / 99 / 777 sequences (iTerm/wezterm-style, urxvt-style, Kitty-style) routed through the OS notification centre.
- Terminal-bell awareness: agent CLIs ring BEL when they need input — the pane gets an unread dot, and if the window is unfocused (or the tab hidden) an OS toast names the detected agent ("claude needs attention"). Throttled to one per pane per 30s, toggleable.
- Attention routing: a bell or a ≥ 10s command finishing in an unwatched pane marks it "waiting" — the header shows a count chip (click to jump to the most recent), and the palette lists each waiting pane by agent and tab. Ordinary background output stays a plain unread dot; only strong "needs a human" signals escalate.
- Agent overview (⌘⇧O): one overlay lists every pane across every tab — state (waiting on you / running / exited / idle), agent name, directory, git branch, unseen-output dot, and time since your last prompt. ↑↓ + ↵ or click to jump anywhere in the fleet.
- Git-branch awareness: each pane shows its repo's current branch (read straight from `.git/HEAD` — linked worktrees included, no `git` subprocess). Refreshes at every prompt, so a `git checkout` shows up immediately; ideal for the one-agent-per-worktree workflow.
- Fleet spawn: one palette action opens a new tab pre-split into 2 panes or a 2×2 grid with your configured agent command (Settings → Agents, default `claude`) auto-run in every pane. The command is session-only — restored tabs after a restart come back as plain shells, never auto-re-running anything.
- Worktree-per-agent (⌘⇧N): type a task name → a git worktree is created in `<repo>-worktrees/` next to the repo on a new branch, and a tab opens there with your agent already running — parallel agents without ever touching your main checkout (Chinese task names work; branch/path previewed live). The same modal lists existing worktrees to open or remove; removal is never forced, so git refusing a dirty tree is the safety rail and the branch always survives.
- Broadcast input (⌘⌥I): keystrokes in the focused pane fan out to every live pane in the tab (tmux `synchronize-panes`) — drive several agents through the same prompt at once. Solid header chip + accent borders on every pane while on; deliberately never persisted across restarts.
- Prompt library: save reusable prompt snippets in Settings → Prompts, run them from the palette — inserted through the bracketed-paste-safe channel, so multi-line prompts never auto-execute.
- Prompt cadence timer: the status bar tracks time since your last prompt to the detected agent, with a progress fill over Claude's ~5-minute prompt-cache window — pace follow-ups to keep the cache warm. Auto-resets when you submit to an agent pane (broadcast included); click it (or use the palette) to start/reset manually.
- Paste-as-file: any clipboard text card in the AssetPanel can be written to `~/.logan-terminal/pastes/` (auto-pruned to the newest 50) and inserted as an escaped file path instead of raw text — agent CLIs handle "read this file" far better than a 300-line paste.
- Links in output are clickable: plain URLs and OSC 8 hyperlinks (agents emit these for file references) open via the OS — web links in the default browser, `file://` links revealed in the file manager (deliberately never *launched* from a click).
- Settings panel (⌘, or the gear button): theme picker, accent color override (presets + custom picker), cursor style/blink, ambient motion, CRT mode, long-command + bell notifications, font size, hidden-files toggle. All persisted, all applied live.
- Eight built-in themes (Warm Dark, Midnight, Moss, Latte-light, Synthwave, Matrix, Sakura, Ocean) defined once in `src/themes.ts` — the same source drives the Tailwind CSS variables and the xterm ANSI palette, so UI chrome and terminal colors can't drift apart. The accent override recolors everything: cursor, selection, borders, grid pattern, scrollbars, search highlights.
- Default look: warm dark with a subtle Claude-orange grid pattern; xterm cursor and accents in Claude coral (`#d97757`).

## Roadmap

| Phase | Goal |
| --- | --- |
| 1 | Tauri + xterm + PTY + drag-drop file path insert + read-only file tree — **done** |
| 2 | Clipboard panel with image thumbnails, screenshot watcher, drop-image UX — **done** |
| 3 | Claude Code integration: agent process detection + OSC 9/99/777 notifications — **done** |
| 4 | Polish — multi-tab, tab-layout restore, ⌘F search, settings panel, themes — **done** |
| 5 | Command palette, WebGL rendering, tab drag-reorder, neon themes, ambient FX, asset lightbox — **done** |
| 6 | Split panes: ⌘D/⌘⇧D splits, geometric focus, draggable dividers, pane snapshot restore — **done** |
| 7 | Pane zoom, per-pane unread dots, OSC 133 shell integration (zsh + bash): prompt jumps, exit-code chip, select-last-output — **done** |
| 8 | Shell-integration payoff: bash OSC 133, command duration chip, long-command + bell notifications, clickable links, OSC 0/2 tab titles, palette recency — **done** |
| 9 | Agent fleet: broadcast input, paste-as-file, prompt library, attention routing, prompt cadence timer — **done** |
| 10 | Fleet command: agent overview dashboard (⌘⇧O), git-branch awareness per pane, one-action fleet spawn — **done** |
| 11 | Worktree-per-agent (⌘⇧N): create sibling worktree + branch + agent tab, list/open/remove — **done** |
| next | session reattach exploration (tmux-style daemon), Windows shell integration (Git Bash / PowerShell), scrollback snapshot restore, worktree dirty-state / merge helpers, global summon hotkey |

## Develop

```sh
npm install
npm run tauri dev
```

Requires Rust (`rustup`) and Node 20+.

Unit tests — both sides of the stack:

- `cd src-tauri && cargo test` — 58 tests covering the OSC parser, notification format matcher, screenshot filename recognizer, default start directory, Windows agent-name normalization, clipboard image-file cleanup, paste-file write + pruning, UTF-8 chunk-boundary reassembly, git-branch resolution (`.git/HEAD` incl. worktree `gitdir:` files), worktree create/list/remove (driving real `git` against temp repos), directory listing, shell-name detection, and the generated shell-integration rc files — including tests that drive real interactive zsh/bash sessions to assert the login-profile chain and the exact OSC sequences emitted.
- `npm test` — 104 vitest tests over the frontend logic: the pane-tree store (splits, close-focus handoff, zoom, unread/attention semantics, fleet tabs, snapshot round-trip incl. legacy format and depth caps), prompt library, agent-overview projection, worktree task sanitizer (fixture-matched with the Rust side), fuzzy matcher, palette recency, path/duration/keyboard-hint helpers, and the terminal command bus.

## Directory layout

```
src/                   # React app
  components/
    Terminal/            # xterm.js wrapper (one instance per pane, OSC 133 handler)
    PaneTree/            # split-pane layout: flattens the pane tree to keyed cells
    TabBar/              # tab strip: switch/close/new/drag-reorder
    CommandPalette/      # ⌘P fuzzy action palette with recent-command ranking
    AgentDashboard/      # ⌘⇧O fleet overview: every pane, state, branch, timer
    WorktreeModal/       # ⌘⇧N worktree-per-agent: create / open / remove
    FileTree/            # left sidebar, follows active pane's cwd
    AssetPanel/          # right sidebar (clipboard + screenshots)
    DropOverlay/         # translucent drop feedback
    Settings/            # ⌘, modal: theme / accent / cursor / effects / font size / prompts
  stores/                # zustand (ptyStore = tab + pane tree, promptStore, settingsStore, uiStore)
  lib/                   # shell-escape, path display, fuzzy match, term bus, palette recency, platform keys
  themes.ts              # theme definitions: CSS tokens + xterm palettes from one source
src-tauri/src/         # Rust backend
  pty.rs                 # portable-pty + OSC 7 parser + notification parser + shell hook
  git.rs                 # .git/HEAD branch lookup + worktree add/list/remove
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

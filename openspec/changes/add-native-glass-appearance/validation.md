# Validation — add-native-glass-appearance

Date: 2026-10-04

## Platforms & versions

- macOS (arm64), Tauri 2.11.3 (locked), wry 0.55.1, window-vibrancy 0.6.0
- Windows: **no environment available** — current adapter directly checks
  `DwmSetWindowAttribute` HRESULT on Win11 22H2+ (build ≥22621) and the legacy
  `SetWindowCompositionAttribute` BOOL on build ≥17763. API lookup failure and
  failed returns produce solid fallback. A Windows-target cross-check of the
  actual adapter and result-policy source passed; the full Windows app and
  real Acrylic rendering remain unverified.

## Command results

| Command | Result |
| --- | --- |
| `npm test` | 35 files, 285 tests passed (incl. real-promise timeout/reconciliation and settings interaction regressions) |
| `npm run build` | OK (tsc + vite; pre-existing >500 kB chunk warning only) |
| `cd src-tauri && cargo fmt --check` | clean (after one formatting pass on `window_appearance.rs`) |
| `cd src-tauri && cargo test` | 91 passed, 0 failed |
| `openspec validate add-native-glass-appearance --strict` | valid |
| `npm run tauri dev` | launches cleanly; window appears, no startup stall, no errors in log |

## What is verified

- **Preference normalization** (unit): windowMaterial normalizes to
  `solid`/`glass`; backgroundOpacity defaults 0.75, clamps to 0.10–1.00,
  empty/whitespace/NaN input falls back to default. Existing preference keys
  untouched.
- **Surface composition** (unit): solid → opaque theme colors; glass →
  shell/terminal at slider alpha, modal ≥ 0.92 alpha, reader always opaque;
  100% opacity is fully opaque; clamping respected.
- **Coordinator** (unit): rapid glass→solid collapses to latest target; stale
  in-flight results discarded by sequence; 3 s timeout → solid + `timeout`
  status while retaining the real IPC promise; the next native operation waits
  for the previous one to finish, and late completion reconciles the latest
  mode+blur (at most one automatic replay per request); apply-failed / unsupported → solid fallback with readable status;
  manual retry re-invokes the native layer; changed material buttons no longer
  send an extra retry alongside the settings subscription.
- **Terminal lifecycle** (unit, mocked xterm): starts opaque with
  `allowTransparency: true` and exactly one PTY attach; glass swap changes
  only `options.theme.background` to `#00000000` — ANSI palette, cursor and
  selection preserved, no `dispose`, no PTY respawn; opacity slider moves
  never touch the xterm theme reference.
- **Startup/shutdown non-blocking** (code review + dev run):
  `initWindowAppearance()` paints opaque CSS surfaces synchronously before the
  first native call; the native request is fire-and-forget through the serial
  coordinator with a bounded 3 s wait; no window-close hooks were added, and
  the NSVisualEffectView is a window-owned subview destroyed with the window.
  The dev app starts and stops normally.
- **Rust adapter** (code review of macOS dependency and checked Windows adapter): unknown
  modes rejected with a parameter error; clear-before-apply prevents
  NSVisualEffectView stacking; clear failure keeps the applied flag so the
  next solid request retries the clear; unsupported platforms return
  `effective: solid` + `unsupported` without touching native state.

## Screenshots

Initial run: not captured (no screen-recording permission). A follow-up
session on 2026-10-04 (permission granted, two displays) captured evidence —
see "Follow-up session" below.

## Follow-up session — 2026-10-04: terminal transparency defect found and fixed

Scope adjustment in the same session: user feedback after seeing glass at 40%
was "still not transparent enough" — two changes followed. First the opacity
floor moved from 0.40 to **0.10** (store constant, slider range, spec/
proposal/design text, clamping tests; in-range values below the old floors
are preserved). Second, after re-test at the 20% floor the residual veil was
identified as the native Vibrancy frost itself, so glass gained a
**background-blur toggle** (`logan.backgroundBlur`, default on): blur off
clears the native material and reports `effective: glass, material: none` —
the desktop shows through the tint crisply (iTerm2-style), blur on restores
the frosted material. The coordinator target is now mode+blur; the Rust
command takes `blur: Option<bool>` (missing = on, preserving the old
contract). Unsupported platforms still fall back to solid either way.
Default remains 0.75; modal floor stays 0.92.

The first real-desktop run exposed exactly why glass looked "not fully
transparent": **the terminal pane rendered as an opaque black rectangle while
the shell chrome went translucent correctly.**

Root cause (verified in the locked `@xterm/xterm` 6.0.0 sources and by a
standalone WebKit repro):

- `xterm.css` ships `.xterm .xterm-viewport { background-color: #000 }`
  ("On OS X this is required in order for the scroll bar to appear fully
  opaque"). The viewport is the absolute-positioned container under the
  render canvas and spans the whole pane.
- xterm 6 applies the theme background inline on the new
  `.xterm-scrollable-element` node, **not** on `.xterm-viewport` (DOM probe:
  `xterm-scrollable-element` inline `rgba(0,0,0,0)`, `xterm-viewport`
  inline empty + computed `rgb(0,0,0)`).
- So an opaque theme background hid the `#000` (solid mode always looked
  right), but glass's `#00000000` theme background let the hardcoded black
  show through — the whole terminal turned black in glass mode, on both the
  WebGL and DOM renderers.

Fix: `src/index.css` sets `.terminal-surface .xterm .xterm-viewport { background-color: transparent }`
in both modes — the pane surface owns the single base tint, and the scrollbar
is drawn by the scrollable-element sliders plus the global
`::-webkit-scrollbar` rules. Verified pixel evidence (window-level captures,
PNG alpha sampled):

| State | header | terminal pane |
| --- | --- | --- |
| glass before fix | 238,234,230 | **0,0,0 (opaque black)** |
| glass after fix | 234,230,226 | 234,231,228 — same single tint |

The vibrancy apply itself had always succeeded (Rust log: `status: applied,
material: vibrancy`); the black viewport was the only blocker. A standalone
Safari (same WebKit engine) A/B page confirms the fix is renderer-independent:
both the WebGL and DOM-renderer terminals show the desktop through after the
viewport override.

Runtime evidence gathered in this session:

- **2.4** — several clean `tauri dev` starts/stops: first paint is usable
  immediately, the glass result lands right after it (Rust log within the
  first second), window close exits cleanly (no hang, no leaked/stacked
  layer across ~8 restart cycles).
- **6.3 (partial)** — the saved glass preference + opacity survived every
  restart in this session; the browser-preview unsupported→solid path stays
  covered by unit tests. Simulated native-failure/clear-failure drills still
  pending.
- **Blur toggle runtime note** — the rebuilt dev binary logs the new contract
  (`apply_window_appearance called with mode="glass" blur=Some(true)` →
  `applied / vibrancy`); the `blur=Some(false)` clear path is covered by the
  coordinator unit tests, and flipping the toggle in Settings was left to the
  user because synthetic clicks kept landing on the host app's overlapping
  window (window-focus fighting), not on LoganTerminal.
- **6.1 (partial)** — glass at the user's saved 40% opacity, Latte light
  theme, verified on the real desktop (second display): uniform translucent
  tint across header/sidebar/tab strip/terminal, crisp text, opaque settings
  modal. Also observed live: an accidental theme switch (Sakura→Latte)
  re-tinted everything in place with the terminal instance intact — no
  dispose/reopen.
- **Renderer fallback (5.4, partial)** — the viewport fix is CSS-level and
  renderer-independent (standalone repro covers WebGL + DOM). Multi-split
  scroll/resize timing comparison still pending an interactive session.

Minor observations (cosmetic, non-blocking):

- After rapid synthetic open/close of the settings modal plus a theme flip, a
  stale compositing tile of the modal shadow lingered over the terminal once
  and cleared on the next repaint (window resize). Not reproduced by normal
  interaction; noting it here for completeness.
- The xterm IME composition popup keeps its hardcoded `#000` background from
  xterm.css (black box during CJK composition in glass mode). Functional;
  left as-is.

## Screenshot evidence

| Scene | Evidence |
| --- | --- |
| Glass before fix — black terminal | [terminal-black-before.png](../../../docs/glass-validation/terminal-black-before.png) |
| Glass after fix — uniform tint | [glass-after-fix.png](../../../docs/glass-validation/glass-after-fix.png) |
| Glass over the real desktop (composite) | [glass-desktop-composite.png](../../../docs/glass-validation/glass-desktop-composite.png) |
| Standalone xterm viewport A/B repro | [xterm-viewport-repro.png](../../../docs/glass-validation/xterm-viewport-repro.png) |
| Settings modal opaque over glass, 40% slider | [settings-modal.png](../../../docs/glass-validation/settings-modal.png) |

## Not yet verified

- **6.1 (remainder)** — glass 75%/100% screenshots, dark themes, unfocused
  dimming, drag/resize with evidence; solid↔glass switching was not verified
  through the material buttons (the accidental theme switch verified only
  live theme updates, not a material transition)
  (synthetic UI driving proved unreliable on the WKWebView; the Rust command
  log channel is the suggested next verification route).
- **6.2** Windows real-machine acceptance — no Windows environment available;
  kept unchecked per the change's task 1.3 instruction.
- **5.4 (remainder)** — multi-split scroll/resize performance comparison in
  glass vs solid.
- **6.3 (remainder)** — simulated native-failure / clear-failure drills on a
  real machine.


## Review fixes — 2026-10-04

Five implementation findings are addressed:

1. **Timeout / late native completion** — removed the bridge's `Promise.race`.
   The coordinator's timer paints a usable solid fallback at 3 seconds but
   continues to await the real IPC promise. Only after it settles does the
   coordinator apply the latest target; a late answer never paints tokens.
   An unchanged target receives one fresh reconciliation attempt, with a
   bounded automatic retry and manual retry still available.
2. **Windows system failures** — a small adapter uses checked HRESULT/BOOL
   results, reports missing legacy exports, and preserves solid fallback on
   failure. Native state checking and mutation now occur within one UI-thread
   operation; the command executes on Tauri's async thread pool. macOS still
   uses window-vibrancy, including propagating pre-apply cleanup errors.
3. **Unpainted frame gaps** — `workspace-frame` paints only outside the content
   box with a clipped spread shadow; it also covers under the 1px border and
   around rounded corners. The sidebar resize handle owns its own shell tint.
   The terminal content has no tinted ancestor underneath it.
4. **Cleanup feedback** — cleanup failure is displayed for solid as well as
   glass preferences, with localized guidance to reselect the current target.
   Other unconfirmed solid outcomes also show retry guidance. State changes
   use a polite live region.
5. **Accessible state** — choice buttons expose `aria-pressed`; toggles expose
   `role=switch` and `aria-checked`; disabled states and percentage slider
   announcements remain available.

### New evidence

- Frontend: 285 tests in 35 files pass. Added actual unresolved-promise tests
  for timeout, late completion, solid and blur-only queued requests, bounded
  reconciliation, IPC rejection, manual retry and cleanup failure. UI tests
  check cleanup feedback in English/Chinese, selected/checked/disabled states,
  percentage announcements, toggle interaction and the duplicate-request fix.
- Rust: 91 tests pass. Three additional tests cover failed HRESULT, false BOOL
  and supported-build API selection. These are policy tests, not Windows
  system-call execution.
- Windows target: `/tmp/logan-glass-windows-check` imports the actual
  `window_appearance/windows.rs` and `windows_status.rs` (no copied adapter)
  and passes `cargo check --target x86_64-pc-windows-gnu --tests --offline`.
  This checks API types/ABI declarations; it does not build or run the full
  Tauri app. The temporary harness produces expected unused-code warnings.
- Browser composition: opened
  [frame-review.html](../../../docs/glass-validation/frame-review.html) through
  the existing Vite server, using `/src/index.css?direct` rather than copied
  CSS. With a bright-green backing, 75% shell/frame/terminal regions appeared
  uniform without a second tint. At 100%, straight and rounded frame gaps
  showed no green leak, including below the translucent border; computed
  handle/pane/ring colors were all `rgb(20, 16, 13)`. Screenshots were inspected
  in the browser tool; no new PNG was saved. Reproduce at
  `http://127.0.0.1:1420/docs/glass-validation/frame-review.html` while Vite runs.
  This fixture checks frontend paint composition only, not native materials,
  live xterm rendering or PTY identity.
- `npm run build`, `cargo fmt --check`, and OpenSpec strict pass. The existing
  >500 kB bundle warning remains.

### Acceptance status correction

Task **5.3 is reopened**: mocked terminal identity/attach/dispose checks passed,
plus the earlier limited theme-switch observation, but full runtime evidence
for running commands, multiple tabs, split/zoom, selection and companion
reader identity was not recorded. Tasks 5.4, 6.1, 6.2 and 6.3 remain pending;
the review regressions and browser fixture do not substitute for those real
machine checks. No Windows rendering or full macOS acceptance is claimed.


## Push scope verification — 2026-10-04

The glass appearance was staged independently of the still-uncommitted
document workspace. Shared files were split in the Git index; working files
retain the document changes. An export of the exact staged tree at
`/tmp/logan-glass-push-check` passed 258 frontend tests in 28 files,
`npm run build`, 89 Rust tests with `cargo test --locked`, `cargo fmt --check`,
and this change's OpenSpec strict validation. The higher 285/91 counts above
refer to the combined local workspace, which also contains document tests.
The pushed glass implementation does not require the document workspace.


## macOS worktree sync — 2026-10-04

The review fixes are also applied to `codex/macos-document-workspace`, which
already contains the document reader and original glass implementation.
The exact combined worktree passes 285 frontend tests in 35 files,
`npm run build`, 91 Rust tests with `cargo test --locked`, `cargo fmt --check`,
OpenSpec strict validation and `git diff --check`. The existing bundle-size
warning remains. Native acceptance tasks listed above remain pending.

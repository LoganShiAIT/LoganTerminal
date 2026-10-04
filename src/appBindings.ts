import { useWorkspaceStore } from "./stores/workspaceStore";
import { workspaceCwd, cycleWorkspace, activateWorkspace, closeFocusedSurface, getFocusedTerminalTarget } from "./lib/workspace";
import { usePtyStore } from "./stores/ptyStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUiStore } from "./stores/uiStore";
import { sendTermCmd } from "./lib/termBus";
import { launchPrimaryAgent } from "./lib/launchAgent";
import { isMac } from "./lib/keys";
import type { Binding } from "./lib/keymap";

/**
 * Move pane focus geometrically (⌘⌥arrows). Panes are located via their
 * data-pane-id DOM rects; hidden tabs' panes have zero size and are skipped.
 */
function focusDirectionalPane(dir: "left" | "right" | "up" | "down") {
  if (!getFocusedTerminalTarget()) return;
  const s = usePtyStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab || tab.root.type === "leaf") return;
  const els = Array.from(
    document.querySelectorAll<HTMLElement>("[data-pane-id]"),
  ).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
  const current = els.find((el) => el.dataset.paneId === tab.activePaneId);
  if (!current) return;
  const c = current.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  let best: { id: string; score: number } | null = null;
  for (const el of els) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const inDir =
      dir === "right" ? dx > 1 : dir === "left" ? dx < -1 : dir === "down" ? dy > 1 : dy < -1;
    if (!inDir) continue;
    const primary = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
    const cross = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + cross * 2;
    if (!best || score < best.score) best = { id: el.dataset.paneId!, score };
  }
  if (best) {
    s.setActivePane(tab.id, best.id);
    requestAnimationFrame(() => sendTermCmd("focus"));
  }
}

const pty = () => usePtyStore.getState();
const ui = () => useUiStore.getState();

/**
 * Window-level shortcuts, in match order. Every entry implicitly carries the
 * app modifier (⌘ / Ctrl); see `lib/keymap.ts` for the matching rules.
 * Per-terminal shortcuts (⌘F, ⌘K, font size, prompt jumps) live in
 * Terminal.tsx instead, since they act on one xterm instance.
 */
export const APP_BINDINGS: Binding[] = [
  {
    key: "t",
    shift: false,
    run: () => {
      pty().addTab(workspaceCwd());
    },
  },
  {
    // Shift avoids plain ⌘W, which macOS's default window menu intercepts
    // before it reaches the webview and closes the whole app. Closes the
    // focused pane; the last pane of a tab closes the tab.
    key: "w",
    shift: true,
    refocus: true,
    run: closeFocusedSurface,
  },
  // Windows keeps plain Ctrl+D for the shell (EOF); there ⌃⇧D splits down
  // and split-right stays reachable via the palette.
  ...(isMac
    ? [
        {
          key: "d",
          shift: false,
          refocus: true,
          run: () => pty().splitPane("row"),
        } satisfies Binding,
      ]
    : []),
  { key: "d", shift: true, refocus: true, run: () => pty().splitPane("col") },
  {
    // Matches WezTerm's default TogglePaneZoomState binding.
    key: "z",
    shift: true,
    refocus: true,
    run: () => pty().toggleZoom(),
  },
  {
    match: (k) => k.startsWith("Arrow"),
    alt: true,
    run: (e) =>
      focusDirectionalPane(
        e.key === "ArrowLeft"
          ? "left"
          : e.key === "ArrowRight"
            ? "right"
            : e.key === "ArrowUp"
              ? "up"
              : "down",
      ),
  },
  {
    // iTerm2's broadcast-input convention; keyed by physical code because ⌥
    // composes dead keys on macOS.
    code: "KeyI",
    alt: true,
    run: () => {
      const s = pty();
      if (s.activeTabId) s.toggleBroadcast(s.activeTabId);
    },
  },
  { key: "]", shift: true, run: () => cycleWorkspace(1) },
  { key: "[", shift: true, run: () => cycleWorkspace(-1) },
  {
    match: (k) => /^[1-9]$/.test(k),
    run: (e) => { const entry = useWorkspaceStore.getState().entries[parseInt(e.key,10)-1]; if (entry) activateWorkspace(entry.id); },
  },
  {
    key: ",",
    run: () => {
      const s = useSettingsStore.getState();
      s.setPanelOpen(!s.panelOpen);
    },
  },
  {
    key: "p",
    run: () => {
      const s = ui();
      s.setPaletteOpen(!s.paletteOpen);
    },
  },
  {
    key: "o",
    shift: true,
    run: () => {
      const s = ui();
      s.setDashboardOpen(!s.dashboardOpen);
    },
  },
  {
    // Plain ⌘F stays with xterm's scrollback search (Terminal.tsx); ⇧ widens
    // the search from "this pane's output" to "the disk".
    key: "f",
    shift: true,
    run: () => {
      const s = ui();
      s.setFileSearchOpen(!s.fileSearchOpen);
    },
  },
  {
    key: "n",
    shift: true,
    run: () => {
      const s = ui();
      s.setWorktreeModalOpen(!s.worktreeModalOpen);
    },
  },
  {
    // One key for "start my usual agent" — the first enabled launcher, in a
    // new tab at the focused pane's directory. The rest live behind the ⚡
    // menu and the palette.
    key: "l",
    shift: true,
    run: () => launchPrimaryAgent("tab"),
  },
  { key: "g", shift: true, run: () => ui().toggleSidebarPanel("diff") },
  {
    // Math preview: pull the terminal selection (or the last command's
    // output) into the panel on the way in.
    key: "m",
    shift: true,
    run: () => {
      const s = ui();
      if (!(s.sidebarOpen && s.sidebarTab === "math")) {
        sendTermCmd("send-selection");
      }
      s.toggleSidebarPanel("math");
    },
  },
  // ⌘B is the panel itself; ⌘J is "show me the files", the same shape as
  // ⌘⇧G for the diff — press it again on the file tab and the panel closes.
  { key: "b", shift: false, run: () => ui().toggleSidebar() },
  { key: "j", shift: false, run: () => ui().toggleSidebarPanel("files") },
];

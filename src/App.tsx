import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import FileTree from "./components/FileTree/FileTree";
import RightPanel from "./components/RightPanel/RightPanel";
import DropOverlay from "./components/DropOverlay/DropOverlay";
import TabBar from "./components/TabBar/TabBar";
import PaneTree from "./components/PaneTree/PaneTree";
import SettingsPanel from "./components/Settings/SettingsPanel";
import CommandPalette from "./components/CommandPalette/CommandPalette";
import AgentDashboard from "./components/AgentDashboard/AgentDashboard";
import WorktreeModal from "./components/WorktreeModal/WorktreeModal";
import {
  usePtyStore,
  useActiveTab,
  useActivePane,
  getActiveLeaf,
  collectLeaves,
  attentionPanes,
} from "./stores/ptyStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUiStore } from "./stores/uiStore";
import { shellEscapePaths } from "./lib/shellEscape";
import { formatDuration } from "./lib/duration";
import { homeDir, tildify } from "./lib/paths";
import { attachReviewPaths } from "./lib/reviewAttachments";
import { sendTermCmd } from "./lib/termBus";
import { kbd } from "./lib/keys";
import { dirtyTotal } from "./lib/git";

const isMac = navigator.userAgent.includes("Mac");
const CLAUDE_CACHE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Move pane focus geometrically (⌘⌥arrows). Panes are located via their
 * data-pane-id DOM rects; hidden tabs' panes have zero size and are skipped.
 */
function focusDirectionalPane(dir: "left" | "right" | "up" | "down") {
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

export default function App() {
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);
  const leftSidebarOpen = useUiStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useUiStore((s) => s.rightSidebarOpen);
  const leftSidebarWidth = useUiStore((s) => s.leftSidebarWidth);
  const rightSidebarWidth = useUiStore((s) => s.rightSidebarWidth);
  const toggleLeftSidebar = useUiStore((s) => s.toggleLeftSidebar);
  const toggleRightSidebar = useUiStore((s) => s.toggleRightSidebar);
  const shiftDownRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDownRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDownRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Page teardown (dev HMR hard reload, window close) skips React effect
  // cleanup, which would orphan every backend PTY session until app quit —
  // best-effort kill them synchronously-ish on the way out. In the shipped
  // app window close also quits the process, so this is dev-mode hygiene.
  useEffect(() => {
    const killAll = () => {
      for (const tab of usePtyStore.getState().tabs) {
        for (const leaf of collectLeaves(tab.root)) {
          if (leaf.sessionId && !leaf.exited) {
            invoke("pty_kill", { sessionId: leaf.sessionId }).catch(() => {});
          }
        }
      }
    };
    window.addEventListener("beforeunload", killAll);
    return () => window.removeEventListener("beforeunload", killAll);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        const { setDropPaths } = usePtyStore.getState();
        const sid = getActiveLeaf()?.sessionId;
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          if ("paths" in p && p.paths && p.paths.length > 0) {
            setDropPaths(p.paths);
          }
        } else if (p.type === "leave") {
          setDropPaths(null);
        } else if (p.type === "drop") {
          setDropPaths(null);
          const paths = ("paths" in p && p.paths) || [];
          if (paths.length === 0) return;
          if (shiftDownRef.current && sid) {
            const escaped = await shellEscapePaths(paths);
            const text = escaped.join(" ") + " ";
            invoke("pty_write", { sessionId: sid, data: text });
            return;
          }
          attachReviewPaths(paths).catch((err) =>
            console.error("attachReviewPaths failed", err),
          );
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Mac: ⌘ only — plain Ctrl must reach the shell untouched (Ctrl+D EOF,
      // Ctrl+K kill-line, Ctrl+T transpose). Elsewhere Ctrl is the app mod.
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
      if (!mod) return;
      const store = usePtyStore.getState();
      if (e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        const leaf = getActiveLeaf();
        store.addTab(leaf?.cwd ?? leaf?.initialCwd ?? null);
      } else if ((e.key === "w" || e.key === "W") && e.shiftKey) {
        // Shift avoids plain Cmd+W, which macOS's default window menu
        // intercepts before it reaches the webview and closes the whole app.
        // Closes the focused pane; the last pane of a tab closes the tab.
        e.preventDefault();
        store.closeActivePane();
        requestAnimationFrame(() => sendTermCmd("focus"));
      } else if ((e.key === "d" || e.key === "D") && (isMac || e.shiftKey)) {
        // Windows keeps plain Ctrl+D for the shell; Ctrl+Shift+D splits
        // (down), and split-right stays reachable via the palette.
        e.preventDefault();
        store.splitPane(e.shiftKey ? "col" : "row");
        requestAnimationFrame(() => sendTermCmd("focus"));
      } else if ((e.key === "z" || e.key === "Z") && e.shiftKey) {
        // Matches WezTerm's default TogglePaneZoomState binding.
        e.preventDefault();
        store.toggleZoom();
        requestAnimationFrame(() => sendTermCmd("focus"));
      } else if (e.altKey && e.key.startsWith("Arrow")) {
        e.preventDefault();
        focusDirectionalPane(
          e.key === "ArrowLeft"
            ? "left"
            : e.key === "ArrowRight"
              ? "right"
              : e.key === "ArrowUp"
                ? "up"
                : "down",
        );
      } else if (e.altKey && e.code === "KeyI") {
        // iTerm2's broadcast-input convention. Match the physical key: on
        // mac, ⌥ composes dead keys into e.key ("ı"), never a plain "i".
        e.preventDefault();
        if (store.activeTabId) store.toggleBroadcast(store.activeTabId);
      } else if (e.shiftKey && e.key === "]") {
        e.preventDefault();
        store.cycleTab(1);
      } else if (e.shiftKey && e.key === "[") {
        e.preventDefault();
        store.cycleTab(-1);
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        store.jumpToTab(parseInt(e.key, 10) - 1);
      } else if (e.key === ",") {
        e.preventDefault();
        const settings = useSettingsStore.getState();
        settings.setPanelOpen(!settings.panelOpen);
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setPaletteOpen(!ui.paletteOpen);
      } else if ((e.key === "o" || e.key === "O") && e.shiftKey) {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setDashboardOpen(!ui.dashboardOpen);
      } else if ((e.key === "n" || e.key === "N") && e.shiftKey) {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setWorktreeModalOpen(!ui.worktreeModalOpen);
      } else if ((e.key === "g" || e.key === "G") && e.shiftKey) {
        // Diff panel: bring it up; if it's already the visible tab, hide
        // the sidebar again (a true toggle for review-glance workflows).
        e.preventDefault();
        const ui = useUiStore.getState();
        if (ui.rightSidebarOpen && ui.rightPanelTab === "diff") {
          ui.toggleRightSidebar();
        } else {
          ui.setRightPanelTab("diff");
          if (!ui.rightSidebarOpen) ui.toggleRightSidebar();
        }
      } else if ((e.key === "b" || e.key === "B") && !e.shiftKey) {
        e.preventDefault();
        useUiStore.getState().toggleLeftSidebar();
      } else if ((e.key === "j" || e.key === "J") && !e.shiftKey) {
        e.preventDefault();
        useUiStore.getState().toggleRightSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex h-screen w-screen flex-col select-none text-ink">
      <AmbientOrbs />
      <header
        data-tauri-drag-region
        className={`relative h-11 shrink-0 flex items-center gap-3 pr-3 border-b border-edge bg-panel/70 backdrop-blur-md ${
          isMac ? "pl-20" : "pl-2"
        }`}
      >
        <button
          className={`w-7 h-7 shrink-0 grid place-items-center rounded-lg transition-colors ${
            leftSidebarOpen
              ? "text-accent bg-accent/[0.08]"
              : "text-muted hover:text-accent hover:bg-accent/[0.08]"
          }`}
          onClick={toggleLeftSidebar}
          title="Toggle file sidebar"
        >
          <SidebarIcon side="left" />
        </button>
        <TabBar />
        <StatusCluster />
        <button
          className={`w-7 h-7 shrink-0 grid place-items-center rounded-lg transition-colors ${
            rightSidebarOpen
              ? "text-accent bg-accent/[0.08]"
              : "text-muted hover:text-accent hover:bg-accent/[0.08]"
          }`}
          onClick={toggleRightSidebar}
          title="Toggle review sidebar"
        >
          <SidebarIcon side="right" />
        </button>
        <button
          className="w-7 h-7 shrink-0 grid place-items-center rounded-lg text-muted hover:text-accent hover:bg-accent/[0.08] transition-colors"
          onClick={() => useSettingsStore.getState().setPanelOpen(true)}
          title={`Settings (${kbd("⌘,")})`}
        >
          <GearIcon />
        </button>
        <AgentHairline />
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          className="shrink-0 overflow-hidden border-edge bg-panel/60 backdrop-blur-sm transition-[width,opacity,border-width] duration-200 ease-out"
          style={{
            width: leftSidebarOpen ? leftSidebarWidth : 0,
            borderRightWidth: leftSidebarOpen ? 1 : 0,
            opacity: leftSidebarOpen ? 1 : 0,
          }}
          aria-hidden={!leftSidebarOpen}
        >
          <div
            className="h-full transition-opacity duration-150 ease-out"
            style={{
              width: leftSidebarWidth,
              opacity: leftSidebarOpen ? 1 : 0,
            }}
          >
              <FileTree />
          </div>
        </aside>
        <ResizeHandle side="left" active={leftSidebarOpen} />

        <main className="flex-1 min-w-0 relative bg-panel">
          {tabs.length === 0 ? (
            <WelcomeScreen />
          ) : (
            tabs.map((tab) => (
              <div
                key={tab.id}
                className={
                  tab.id === activeTabId ? "absolute inset-0" : "hidden"
                }
              >
                <PaneTree tab={tab} tabActive={tab.id === activeTabId} />
              </div>
            ))
          )}
          <CrtOverlay />
        </main>

        <ResizeHandle side="right" active={rightSidebarOpen} />
        <aside
          className="shrink-0 overflow-hidden border-edge bg-panel/60 backdrop-blur-sm transition-[width,opacity,border-width] duration-200 ease-out"
          style={{
            width: rightSidebarOpen ? rightSidebarWidth : 0,
            borderLeftWidth: rightSidebarOpen ? 1 : 0,
            opacity: rightSidebarOpen ? 1 : 0,
          }}
          aria-hidden={!rightSidebarOpen}
        >
          <div
            className="h-full transition-opacity duration-150 ease-out"
            style={{
              width: rightSidebarWidth,
              opacity: rightSidebarOpen ? 1 : 0,
            }}
          >
              <RightPanel />
          </div>
        </aside>
      </div>

      <DropOverlay />
      <SettingsPanel />
      <CommandPalette />
      <AgentDashboard />
      <WorktreeModal />
    </div>
  );
}

function AmbientOrbs() {
  const ambient = useSettingsStore((s) => s.ambientMotion);
  if (!ambient) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden"
      aria-hidden
    >
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
    </div>
  );
}

function CrtOverlay() {
  const crt = useSettingsStore((s) => s.crtMode);
  if (!crt) return null;
  return <div className="crt-overlay" aria-hidden />;
}

/** Hairline under the header; sweeps with light while an agent is running. */
function AgentHairline() {
  const activeTab = useActiveTab();
  const agentLive = activeTab
    ? collectLeaves(activeTab.root).some((l) => l.agentName && !l.exited)
    : false;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 -bottom-px ${
        agentLive ? "h-[2px] agent-shimmer" : "h-px header-hairline"
      }`}
    />
  );
}

function ResizeHandle({
  side,
  active,
}: {
  side: "left" | "right";
  active: boolean;
}) {
  const setLeftSidebarWidth = useUiStore((s) => s.setLeftSidebarWidth);
  const setRightSidebarWidth = useUiStore((s) => s.setRightSidebarWidth);

  const startDrag = (e: React.MouseEvent) => {
    if (!active) return;
    e.preventDefault();
    const onMove = (move: MouseEvent) => {
      if (side === "left") setLeftSidebarWidth(move.clientX);
      else setRightSidebarWidth(window.innerWidth - move.clientX);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={`group relative z-10 shrink-0 bg-transparent transition-[width,opacity] duration-200 ease-out ${
        active ? "w-1 cursor-col-resize opacity-100" : "w-0 opacity-0"
      }`}
      onMouseDown={startDrag}
      title="Resize sidebar"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-edge transition-colors group-hover:bg-accent/70" />
    </div>
  );
}

function SidebarIcon({ side }: { side: "left" | "right" }) {
  const x = side === "left" ? 3 : 10;
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d={`M${x} 3v10`} />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </svg>
  );
}

function StatusCluster() {
  const activeTab = useActiveTab();
  const pane = useActivePane();
  const attnCount = usePtyStore((s) => attentionPanes(s.tabs).length);
  const [home, setHome] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    homeDir().then(setHome).catch(() => {});
  }, []);

  const exited = Boolean(pane?.exited);
  const live = Boolean(pane?.sessionId) && !exited;
  const cwd = pane?.cwd ?? null;
  const promptSentAt = pane?.lastPromptSentAt ?? null;
  const showPromptTimer = Boolean(pane && live);
  const promptElapsedMs = promptSentAt ? Math.max(0, now - promptSentAt) : null;
  const promptProgress =
    promptElapsedMs === null
      ? 0
      : Math.min(100, (promptElapsedMs / CLAUDE_CACHE_WINDOW_MS) * 100);
  const cacheWindowOpen =
    promptElapsedMs !== null && promptElapsedMs < CLAUDE_CACHE_WINDOW_MS;

  useEffect(() => {
    if (!showPromptTimer || promptSentAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [showPromptTimer, promptSentAt]);

  return (
    <div className="ml-auto flex items-center gap-2.5 shrink-0">
      {activeTab?.broadcast && (
        <button
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] text-white bg-accent border border-accent shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
          onClick={() =>
            usePtyStore.getState().toggleBroadcast(activeTab.id)
          }
          title="Broadcast is ON — keystrokes go to every pane in this tab. Click to turn off."
        >
          ⇶ broadcast
        </button>
      )}
      {attnCount > 0 && (
        <button
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold text-accent bg-accent/15 border border-accent/40 hover:bg-accent hover:text-white transition-colors"
          onClick={() => {
            usePtyStore.getState().jumpToAttention();
            requestAnimationFrame(() => sendTermCmd("focus"));
          }}
          title={`Panes waiting on you (bell / long command done) — click to jump, ${kbd("⌘⇧O")} for the full overview`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          {attnCount} waiting
        </button>
      )}
      {pane?.gitBranch && !exited && (
        <button
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono text-muted bg-ink/5 border border-edge max-w-[200px] hover:text-accent hover:border-accent/35 transition-colors"
          onClick={() => {
            const ui = useUiStore.getState();
            ui.setRightPanelTab("diff");
            if (!ui.rightSidebarOpen) ui.toggleRightSidebar();
          }}
          title={`Git branch of ${cwd ?? "cwd"}${
            dirtyTotal(pane.gitDirty) > 0
              ? ` · uncommitted: ${pane.gitDirty!.added} new, ${pane.gitDirty!.modified} modified, ${pane.gitDirty!.deleted} deleted`
              : " · clean"
          } — click for the diff panel (${kbd("⌘⇧G")})`}
        >
          <GitBranchIcon />
          <span className="truncate">{pane.gitBranch}</span>
          {dirtyTotal(pane.gitDirty) > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              {pane.gitDirty!.added > 0 && (
                <span className="text-emerald-300/90">+{pane.gitDirty!.added}</span>
              )}
              {pane.gitDirty!.modified > 0 && (
                <span className="text-amber-300/90">~{pane.gitDirty!.modified}</span>
              )}
              {pane.gitDirty!.deleted > 0 && (
                <span className="text-red-300/90">−{pane.gitDirty!.deleted}</span>
              )}
            </span>
          )}
        </button>
      )}
      {pane?.agentName && !exited && (
        <span
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] text-accent bg-accent/15 border border-accent/40"
          title={`Detected agent: ${pane.agentName}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          {pane.agentName}
        </span>
      )}
      {showPromptTimer && pane && (
        <button
          className={`group relative isolate flex h-6 min-w-[86px] items-center gap-1.5 overflow-hidden rounded-full border px-2 font-mono text-[10px] transition-colors ${
            promptSentAt
              ? cacheWindowOpen
                ? "border-accent/40 text-accent bg-accent/10 hover:bg-accent/15"
                : "border-edge text-muted bg-ink/5 hover:text-accent hover:border-accent/35"
              : "border-edge text-faint bg-ink/5 hover:text-accent hover:border-accent/35"
          }`}
          style={
            promptSentAt
              ? ({
                  "--prompt-progress": `${promptProgress}%`,
                } as CSSProperties)
              : undefined
          }
          onClick={() => usePtyStore.getState().markPromptSent(pane.id)}
          title={
            promptSentAt
              ? `${cacheWindowOpen ? "Claude cache window" : "Cache window passed"} · click to reset timer`
              : "Start prompt timer"
          }
        >
          {promptSentAt && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 -z-10 w-[var(--prompt-progress)] bg-accent/15 transition-[width] duration-300"
            />
          )}
          <ClockIcon />
          <span>{promptElapsedMs === null ? "timer" : formatDuration(promptElapsedMs)}</span>
        </button>
      )}
      {/* Only surface anomalies — a clean exit says nothing here. Requires
          zsh/bash shell integration (OSC 133); silently absent otherwise. */}
      {!exited && pane?.lastExitCode != null && pane.lastExitCode !== 0 && (
        <span
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold text-red-300 bg-red-500/15 border border-red-400/40"
          title="Last command's exit status"
        >
          exit {pane.lastExitCode}
        </span>
      )}
      {/* Same anomaly-only philosophy: quick commands say nothing. */}
      {!exited && pane?.lastDurationMs != null && pane.lastDurationMs >= 2000 && (
        <span
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono text-muted bg-ink/5 border border-edge"
          title="Last command's duration"
        >
          {formatDuration(pane.lastDurationMs)}
        </span>
      )}
      <span
        className="flex items-center gap-1.5 font-mono text-[11px] text-muted"
        title={
          pane?.sessionId
            ? `session ${pane.sessionId.slice(0, 8)}${cwd ? ` · ${cwd}` : ""}`
            : undefined
        }
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            live
              ? "bg-accent shadow-[0_0_8px_var(--color-accent)]"
              : exited
                ? "bg-red-400/70"
                : "bg-faint"
          }`}
        />
        <span className="truncate max-w-[240px]">
          {exited
            ? `exited — ${kbd("⌘⇧W")} to close`
            : live
              ? cwd
                ? tildify(cwd, home)
                : "shell"
              : activeTab
                ? "starting…"
                : "no session"}
        </span>
      </span>
    </div>
  );
}

function GitBranchIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="4.5" cy="3.5" r="1.8" />
      <circle cx="4.5" cy="12.5" r="1.8" />
      <circle cx="11.5" cy="5.5" r="1.8" />
      <path d="M4.5 5.3v5.4M11.5 7.3c0 2.2-3 2.4-5 3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  );
}

function WelcomeScreen() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-7">
      <div className="grid h-20 w-20 place-items-center rounded-3xl border border-accent/30 bg-raise/50 backdrop-blur-sm animate-[glow-breathe_4.5s_ease-in-out_infinite]">
        <div className="flex items-end gap-1.5 font-mono text-3xl text-accent">
          ❯
          <span className="inline-block w-[0.55em] h-[1.05em] rounded-[2px] bg-accent/85 animate-[cursor-blink_1.1s_steps(1)_infinite]" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <div className="title-shine text-base font-bold uppercase tracking-[0.32em]">
          LoganTerminal
        </div>
        <div className="font-mono text-xs text-muted">
          <span className="type-in">a terminal built for AI coding agents</span>
        </div>
      </div>
      <button
        className="px-4 py-1.5 rounded-full border border-accent/40 text-accent text-sm hover:bg-accent/10 hover:border-accent/70 hover:shadow-[0_0_24px_color-mix(in_srgb,var(--color-accent)_35%,transparent)] transition-[color,border-color,box-shadow]"
        onClick={() => usePtyStore.getState().addTab()}
      >
        New Terminal
      </button>
      <div className="flex max-w-[80%] flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘P")}</span> commands
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘T")}</span> new tab
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘D")}</span> split
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘⇧Z")}</span> zoom pane
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘F")}</span> find
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘K")}</span> clear
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘↑↓")}</span> jump prompts
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘B")}</span> files
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘J")}</span> assets
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘1-9")}</span> jump
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">{kbd("⌘,")}</span> settings
        </span>
      </div>
    </div>
  );
}

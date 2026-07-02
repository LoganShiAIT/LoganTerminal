import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import Terminal from "./components/Terminal/Terminal";
import FileTree from "./components/FileTree/FileTree";
import AssetPanel from "./components/AssetPanel/AssetPanel";
import DropOverlay from "./components/DropOverlay/DropOverlay";
import TabBar from "./components/TabBar/TabBar";
import SettingsPanel from "./components/Settings/SettingsPanel";
import { usePtyStore, useActiveTab } from "./stores/ptyStore";
import { useSettingsStore } from "./stores/settingsStore";
import { shellEscapePaths } from "./lib/shellEscape";
import { homeDir, tildify } from "./lib/paths";

const isMac = navigator.userAgent.includes("Mac");

export default function App() {
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        const { setDropPaths, tabs, activeTabId } = usePtyStore.getState();
        const sid = tabs.find((t) => t.id === activeTabId)?.sessionId;
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          if ("paths" in p && p.paths && p.paths.length > 0) {
            setDropPaths(p.paths);
          }
        } else if (p.type === "leave") {
          setDropPaths(null);
        } else if (p.type === "drop") {
          setDropPaths(null);
          if (!sid) return;
          const paths = ("paths" in p && p.paths) || [];
          if (paths.length === 0) return;
          const escaped = await shellEscapePaths(paths);
          const text = escaped.join(" ") + " ";
          invoke("pty_write", { sessionId: sid, data: text });
        }
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const store = usePtyStore.getState();
      if (e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        const active = store.tabs.find((t) => t.id === store.activeTabId);
        store.addTab(active?.cwd ?? null);
      } else if ((e.key === "w" || e.key === "W") && e.shiftKey) {
        // Shift avoids plain Cmd+W, which macOS's default window menu
        // intercepts before it reaches the webview and closes the whole app.
        e.preventDefault();
        if (store.activeTabId) store.closeTab(store.activeTabId);
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex h-screen w-screen flex-col select-none text-ink">
      <header
        data-tauri-drag-region
        className={`h-11 shrink-0 flex items-center gap-3 pr-3 border-b border-edge bg-panel/70 backdrop-blur-md ${
          isMac ? "pl-20" : "pl-2"
        }`}
      >
        <TabBar />
        <StatusCluster />
        <button
          className="w-7 h-7 shrink-0 grid place-items-center rounded-lg text-muted hover:text-accent hover:bg-accent/[0.08] transition-colors"
          onClick={() => useSettingsStore.getState().setPanelOpen(true)}
          title="Settings (⌘,)"
        >
          <GearIcon />
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-60 shrink-0 border-r border-edge overflow-hidden bg-panel/60 backdrop-blur-sm">
          <FileTree />
        </aside>

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
                <Terminal
                  tabId={tab.id}
                  active={tab.id === activeTabId}
                  initialCwd={tab.initialCwd}
                />
              </div>
            ))
          )}
        </main>

        <aside className="w-72 shrink-0 border-l border-edge overflow-hidden bg-panel/60 backdrop-blur-sm">
          <AssetPanel />
        </aside>
      </div>

      <DropOverlay />
      <SettingsPanel />
    </div>
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
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => {
    homeDir().then(setHome).catch(() => {});
  }, []);

  const exited = Boolean(activeTab?.exited);
  const live = Boolean(activeTab?.sessionId) && !exited;
  const cwd = activeTab?.cwd ?? null;

  return (
    <div className="ml-auto flex items-center gap-2.5 shrink-0">
      {activeTab?.agentName && !exited && (
        <span
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] text-accent bg-accent/15 border border-accent/40"
          title={`Detected agent: ${activeTab.agentName}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          {activeTab.agentName}
        </span>
      )}
      <span
        className="flex items-center gap-1.5 font-mono text-[11px] text-muted"
        title={
          activeTab?.sessionId
            ? `session ${activeTab.sessionId.slice(0, 8)}${cwd ? ` · ${cwd}` : ""}`
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
            ? "exited — ⌘⇧W to close"
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

function WelcomeScreen() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-7">
      <div className="flex items-end gap-1.5 font-mono text-4xl text-accent">
        ❯
        <span className="inline-block w-[0.55em] h-[1.05em] rounded-[2px] bg-accent/85 animate-[cursor-blink_1.1s_steps(1)_infinite]" />
      </div>
      <div className="text-center space-y-1.5">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] text-ink/90">
          LoganTerminal
        </div>
        <div className="text-xs text-muted">
          a terminal built for AI coding agents
        </div>
      </div>
      <button
        className="px-4 py-1.5 rounded-full border border-accent/40 text-accent text-sm hover:bg-accent/10 hover:border-accent/70 transition-colors"
        onClick={() => usePtyStore.getState().addTab()}
      >
        New Terminal
      </button>
      <div className="flex items-center gap-4 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="kbd">⌘T</span> new tab
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">⌘F</span> find
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">⌘K</span> clear
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">⌘±</span> font size
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">⌘1-9</span> jump
        </span>
        <span className="flex items-center gap-1.5">
          <span className="kbd">⌘,</span> settings
        </span>
      </div>
    </div>
  );
}

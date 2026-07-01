import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import Terminal from "./components/Terminal/Terminal";
import FileTree from "./components/FileTree/FileTree";
import AssetPanel from "./components/AssetPanel/AssetPanel";
import DropOverlay from "./components/DropOverlay/DropOverlay";
import TabBar from "./components/TabBar/TabBar";
import { usePtyStore, useActiveTab } from "./stores/ptyStore";
import { shellEscapePaths } from "./lib/shellEscape";

export default function App() {
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);
  const activeTab = useActiveTab();

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex h-screen w-screen select-none text-[color:var(--text-primary)]">
      <aside className="w-60 shrink-0 border-r border-[color:var(--border-warm)] overflow-y-auto bg-[color:var(--bg-panel)]/60 backdrop-blur-sm">
        <FileTree />
      </aside>
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="h-9 px-3 flex items-center gap-2 text-xs border-b border-[color:var(--border-warm)] bg-[color:var(--bg-panel)]/40 backdrop-blur-sm">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              background: activeTab?.sessionId
                ? "var(--claude-orange)"
                : "var(--text-muted)",
              boxShadow: activeTab?.sessionId
                ? "0 0 8px var(--claude-orange)"
                : "none",
            }}
          />
          <span className="text-[color:var(--text-muted)]">
            {activeTab?.sessionId ? (
              <span className="truncate">
                session {activeTab.sessionId.slice(0, 8)}
              </span>
            ) : (
              <span>{tabs.length === 0 ? "no session" : "starting…"}</span>
            )}
          </span>
          {activeTab?.agentName && (
            <span
              className="ml-auto px-2 py-0.5 text-[10px] rounded-full uppercase tracking-[0.15em] font-semibold"
              style={{
                background: "rgba(217, 119, 87, 0.18)",
                border: "1px solid rgba(217, 119, 87, 0.5)",
                color: "var(--claude-orange)",
              }}
              title={`Detected agent: ${activeTab.agentName}`}
            >
              {activeTab.agentName}
            </span>
          )}
        </div>
        <TabBar />
        <div className="flex-1 min-h-0 relative bg-[color:var(--bg-panel)]/80">
          {tabs.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                className="px-4 py-2 rounded-md text-sm border border-[color:var(--border-warm)] text-[color:var(--text-muted)] hover:text-[color:var(--claude-orange)] hover:border-[color:var(--claude-orange)] transition-colors"
                onClick={() => usePtyStore.getState().addTab()}
              >
                + New Terminal (⌘T)
              </button>
            </div>
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
        </div>
      </main>
      <aside className="w-72 shrink-0 border-l border-[color:var(--border-warm)] overflow-y-auto bg-[color:var(--bg-panel)]/60 backdrop-blur-sm">
        <AssetPanel />
      </aside>
      <DropOverlay />
    </div>
  );
}

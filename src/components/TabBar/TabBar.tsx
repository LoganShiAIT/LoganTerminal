import { usePtyStore } from "../../stores/ptyStore";

function tabLabel(cwd: string | null): string {
  if (!cwd) return "shell";
  const segments = cwd.split("/").filter(Boolean);
  return segments[segments.length - 1] || "/";
}

export default function TabBar() {
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);
  const setActiveTab = usePtyStore((s) => s.setActiveTab);
  const closeTab = usePtyStore((s) => s.closeTab);
  const addTab = usePtyStore((s) => s.addTab);

  const handleNewTab = () => {
    const active = tabs.find((t) => t.id === activeTabId);
    addTab(active?.cwd ?? null);
  };

  return (
    <div className="h-8 flex items-stretch gap-0.5 px-1.5 pt-1.5 border-b border-[color:var(--border-warm)] bg-[color:var(--bg-panel)]/40 backdrop-blur-sm overflow-x-auto shrink-0">
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.cwd ?? undefined}
            className={`group flex items-center gap-1.5 px-2.5 rounded-t-md text-xs cursor-pointer max-w-[160px] shrink-0 transition-colors ${
              isActive
                ? "bg-[color:var(--bg-panel)] text-[color:var(--text-primary)] border-t border-x border-[color:var(--border-warm)]"
                : "text-[color:var(--text-muted)] hover:bg-[color:var(--claude-orange-soft)]"
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                background: tab.agentName
                  ? "var(--claude-orange)"
                  : "transparent",
                boxShadow: tab.agentName
                  ? "0 0 6px var(--claude-orange)"
                  : "none",
              }}
            />
            <span className="truncate">{tabLabel(tab.cwd)}</span>
            {i < 9 && (
              <span className="text-[9px] text-[color:var(--text-muted)] shrink-0">
                {i + 1}
              </span>
            )}
            {tabs.length > 1 && (
              <button
                className="opacity-0 group-hover:opacity-100 hover:text-[color:var(--claude-orange)] leading-none ml-0.5 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        className="px-2 text-[color:var(--text-muted)] hover:text-[color:var(--claude-orange)] text-sm shrink-0"
        onClick={handleNewTab}
        title="New terminal (⌘T)"
      >
        +
      </button>
    </div>
  );
}

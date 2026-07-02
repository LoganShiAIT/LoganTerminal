import { usePtyStore } from "../../stores/ptyStore";
import { basename } from "../../lib/paths";

function tabLabel(cwd: string | null): string {
  if (!cwd) return "shell";
  return basename(cwd) || "/";
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
    <div
      data-tauri-drag-region
      className="flex-1 min-w-0 h-full flex items-center gap-1 overflow-x-auto no-scrollbar"
    >
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={
              tab.exited ? `${tab.cwd ?? "shell"} — exited` : (tab.cwd ?? undefined)
            }
            className={`group flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs cursor-pointer max-w-[180px] shrink-0 transition-colors duration-100 ${
              isActive
                ? "bg-raise text-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-ink)_8%,transparent)]"
                : "text-muted hover:bg-accent/[0.08] hover:text-ink/80"
            }`}
          >
            {tab.agentName && !tab.exited && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)] shrink-0"
                title={`agent: ${tab.agentName}`}
              />
            )}
            {tab.unread && !isActive && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-ink/75 shrink-0"
                title="New output"
              />
            )}
            <span
              className={`truncate ${tab.exited ? "line-through opacity-50" : ""}`}
            >
              {tabLabel(tab.cwd)}
            </span>
            {i < 9 && (
              <span className="text-[9px] font-mono text-faint shrink-0">
                {i + 1}
              </span>
            )}
            {(tabs.length > 1 || tab.exited) && (
              <button
                className="w-4 h-4 -mr-1 grid place-items-center rounded text-[11px] leading-none opacity-0 group-hover:opacity-100 text-muted hover:text-ink hover:bg-ink/10 transition-opacity shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                title="Close tab (⌘⇧W)"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        className="w-7 h-7 grid place-items-center rounded-lg text-base leading-none text-muted hover:text-accent hover:bg-accent/[0.08] transition-colors shrink-0"
        onClick={handleNewTab}
        title="New terminal (⌘T)"
      >
        +
      </button>
    </div>
  );
}

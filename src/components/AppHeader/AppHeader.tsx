import { useActiveTab, collectLeaves } from "../../stores/ptyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { kbd, isMac } from "../../lib/keys";
import { useT } from "../../i18n";
import TabBar from "../TabBar/TabBar";
import { GearIcon, SidebarIcon } from "../icons";
import StatusCluster from "./StatusCluster";
import AgentLaunchMenu from "./AgentLaunchMenu";

const HEADER_BUTTON =
  "w-7 h-7 shrink-0 grid place-items-center rounded-lg transition-colors";

/**
 * The window's title bar: the sidebar toggle, tabs, live status, settings.
 *
 * `data-tauri-drag-region="deep"` makes the whole strip a window-drag
 * surface. Tauri's drag script exempts clickable elements (buttons) by
 * itself, but custom pointer-driven widgets — the tab pills — must opt out
 * with `data-tauri-drag-region="false"`.
 *
 * The explicit `z-30` is what lets the launcher popover hang below the header
 * and still paint over `<main>`: both are positioned with `z-auto` otherwise,
 * and the later sibling would win.
 */
export default function AppHeader() {
  const t = useT();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  const toggleClass = (open: boolean) =>
    `${HEADER_BUTTON} ${
      open
        ? "text-accent bg-accent/[0.08]"
        : "text-muted hover:text-accent hover:bg-accent/[0.08]"
    }`;

  return (
    <header
      data-tauri-drag-region="deep"
      className={`relative z-30 h-11 shrink-0 flex items-center gap-3 pr-3 border-b border-edge bg-panel/70 backdrop-blur-md ${
        isMac ? "pl-20" : "pl-2"
      }`}
    >
      <button
        className={toggleClass(sidebarOpen)}
        onClick={toggleSidebar}
        title={t("Toggle sidebar ({key})", { key: kbd("⌘B") })}
      >
        <SidebarIcon />
      </button>
      <TabBar />
      <StatusCluster />
      <AgentLaunchMenu />
      <button
        className={`${HEADER_BUTTON} text-muted hover:text-accent hover:bg-accent/[0.08]`}
        onClick={() => useSettingsStore.getState().setPanelOpen(true)}
        title={t("Settings ({key})", { key: kbd("⌘,") })}
      >
        <GearIcon />
      </button>
      <AgentHairline />
    </header>
  );
}

/**
 * Hairline under the header; sweeps with light only while an agent is
 * actually working (LeafPane.busy). An agent sitting idle at its prompt
 * leaves the hairline static — the motion means "a task is running".
 */
function AgentHairline() {
  const activeTab = useActiveTab();
  const agentBusy = activeTab
    ? collectLeaves(activeTab.root).some((l) => l.agentName && !l.exited && l.busy)
    : false;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 -bottom-px ${
        agentBusy ? "h-[2px] agent-shimmer" : "h-px header-hairline"
      }`}
    />
  );
}

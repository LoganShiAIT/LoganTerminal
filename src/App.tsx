import { usePtyStore } from "./stores/ptyStore";
import { useUiStore } from "./stores/uiStore";
import {
  useGlobalKeymap,
  useWindowFileDrop,
  usePtyTeardownOnUnload,
} from "./lib/appEffects";
import AppHeader from "./components/AppHeader/AppHeader";
import { Sidebar, ResizeHandle } from "./components/Sidebar/Sidebar";
import { AmbientOrbs, CrtOverlay } from "./components/Ambient/AmbientLayers";
import WelcomeScreen from "./components/Welcome/WelcomeScreen";
import SidePanel from "./components/SidePanel/SidePanel";
import PaneTree from "./components/PaneTree/PaneTree";
import DropOverlay from "./components/DropOverlay/DropOverlay";
import SettingsPanel from "./components/Settings/SettingsPanel";
import CommandPalette from "./components/CommandPalette/CommandPalette";
import FileSearch from "./components/FileSearch/FileSearch";
import MathHoverLayer from "./components/MathHover/MathHoverLayer";
import AgentDashboard from "./components/AgentDashboard/AgentDashboard";
import WorktreeModal from "./components/WorktreeModal/WorktreeModal";

/**
 * The window: a header, one collapsible sidebar left of the terminal grid,
 * and the overlays that float above all of it.
 *
 * Every tab stays mounted and is hidden with `display: none` rather than
 * unmounted — an xterm instance that is torn down loses its scrollback, and
 * its PTY would have to be respawned.
 */
export default function App() {
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);

  useGlobalKeymap();
  useWindowFileDrop();
  usePtyTeardownOnUnload();

  return (
    <div className="relative flex h-screen w-screen flex-col select-none text-ink">
      <AmbientOrbs />
      <AppHeader />

      <div className="flex flex-1 min-h-0">
        <Sidebar open={sidebarOpen} width={sidebarWidth}>
          <SidePanel />
        </Sidebar>
        <ResizeHandle active={sidebarOpen} />

        <main className="flex-1 min-w-0 relative bg-panel">
          {tabs.length === 0 ? (
            <WelcomeScreen />
          ) : (
            tabs.map((tab) => (
              <div
                key={tab.id}
                className={tab.id === activeTabId ? "absolute inset-0" : "hidden"}
              >
                <PaneTree tab={tab} tabActive={tab.id === activeTabId} />
              </div>
            ))
          )}
          <CrtOverlay />
        </main>
      </div>

      <DropOverlay />
      <SettingsPanel />
      <CommandPalette />
      <FileSearch />
      <MathHoverLayer />
      <AgentDashboard />
      <WorktreeModal />
    </div>
  );
}

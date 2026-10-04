import { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "./stores/workspaceStore";
import DocumentReader from "./components/DocumentReader/DocumentReader";
import { useT } from "./i18n";
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
  const t = useT();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const entries = useWorkspaceStore((s) => s.entries);
  const focus = useWorkspaceStore((s) => s.focus);
  const notice = useWorkspaceStore((s) => s.notice);
  const entry = entries.find((e) => e.id === activeId);
  const companion = entry?.kind === "terminal" ? entry.companionId : null;
  const ratio = entry?.kind === "terminal" ? entry.ratio : 0.45;
  const mainRef = useRef<HTMLElement>(null);
  const [mainWidth, setMainWidth] = useState(1000);
  useEffect(() => {
    if (!mainRef.current) return;
    const ro = new ResizeObserver(([e]) => setMainWidth(e.contentRect.width));
    ro.observe(mainRef.current);
    return () => ro.disconnect();
  }, []);
  const narrowReader =
    !!companion && mainWidth < 760 && focus?.kind === "document";
  const companionVisible = !!companion && (mainWidth >= 760 || narrowReader);
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

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

        <div className="workspace-frame flex flex-1 min-w-0">
          <main
            ref={mainRef}
            className="workspace-main flex-1 min-w-0 relative bg-panel"
          >
            {tabs.length === 0 && entries.length === 0 && <WelcomeScreen />}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                data-terminal-tab={tab.id}
                className={
                  tab.id === activeId && !narrowReader
                    ? "absolute inset-y-0 left-0 terminal-surface"
                    : "hidden"
                }
                style={{
                  width:
                    tab.id === activeId && companionVisible && mainWidth >= 760
                      ? `${(1 - ratio) * 100}%`
                      : "100%",
                }}
                onMouseDownCapture={() =>
                  useWorkspaceStore
                    .getState()
                    .focusTerminal(tab.id, tab.activePaneId)
                }
              >
                <PaneTree
                  tab={tab}
                  tabActive={
                    tab.id === activeId &&
                    focus?.kind === "terminal" &&
                    !narrowReader
                  }
                />
                <CrtOverlay />
              </div>
            ))}
            {entries
              .filter((e) => e.kind === "document")
              .map((e) => (
                <div
                  key={`reader-${e.id}`}
                  className={
                    e.id === activeId
                      ? "absolute inset-0 reader-surface"
                      : "hidden"
                  }
                >
                  <DocumentReader id={e.id} />
                </div>
              ))}
            {entries
              .filter((e) => e.kind === "terminal" && e.companionId)
              .map(
                (e) =>
                  e.kind === "terminal" && (
                    <div
                      key={`companion-${e.id}`}
                      className={
                        e.id === activeId && companionVisible
                          ? "absolute inset-y-0 right-0 reader-surface"
                          : "hidden"
                      }
                      style={{
                        width: mainWidth < 760 ? "100%" : `${e.ratio * 100}%`,
                      }}
                    >
                      <DocumentReader id={e.companionId!} tabId={e.id} />
                    </div>
                  ),
              )}
            {companionVisible && mainWidth >= 760 && (
              <div
                role="separator"
                aria-label={t("Resize reader")}
                aria-valuenow={Math.round(ratio * 100)}
                aria-valuemin={25}
                aria-valuemax={65}
                tabIndex={0}
                className="reader-divider"
                style={{ left: `${(1 - ratio) * 100}%` }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    useWorkspaceStore
                      .getState()
                      .setRatio(
                        activeId!,
                        ratio + (e.key === "ArrowLeft" ? 0.03 : -0.03),
                      );
                  }
                }}
                onPointerDown={startDrag}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const rect = mainRef.current!.getBoundingClientRect();
                  useWorkspaceStore
                    .getState()
                    .setRatio(
                      activeId!,
                      1 - (e.clientX - rect.left) / rect.width,
                    );
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
              />
            )}
            {companion && !companionVisible && entry?.kind === "terminal" && (
              <button
                className="reader-reopen"
                onClick={() =>
                  useWorkspaceStore.getState().focusDocument(companion, entry.id)
                }
              >
                {t("Read beside terminal")} ↗
              </button>
            )}
            {notice && (
              <div role="alert" className="workspace-notice">
                {t(notice.replace(/^Error: /, ""))}
                <button
                  aria-label={t("Close")}
                  onClick={() => useWorkspaceStore.getState().setNotice(null)}
                >
                  ×
                </button>
              </div>
            )}
          </main>
        </div>
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

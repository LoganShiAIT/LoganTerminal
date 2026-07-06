import { create } from "zustand";

type RightPanelTab = "assets" | "review" | "diff";

interface UiStore {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  rightPanelTab: RightPanelTab;
  /** Command palette visibility — UI state, not persisted. */
  paletteOpen: boolean;
  /** Agent overview (⌘⇧O) visibility — UI state, not persisted. */
  dashboardOpen: boolean;
  /** Worktree modal (⌘⇧N) visibility — UI state, not persisted. */
  worktreeModalOpen: boolean;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setPaletteOpen: (open: boolean) => void;
  setDashboardOpen: (open: boolean) => void;
  setWorktreeModalOpen: (open: boolean) => void;
}

const UI_KEY = "logan.uiLayout";
export const LEFT_SIDEBAR_MIN = 180;
export const LEFT_SIDEBAR_MAX = 420;
export const RIGHT_SIDEBAR_MIN = 280;
export const RIGHT_SIDEBAR_MAX = 640;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const rightPanelTab: RightPanelTab =
      parsed.rightPanelTab === "review" || parsed.rightPanelTab === "diff"
        ? parsed.rightPanelTab
        : "assets";
    return {
      leftSidebarOpen:
        typeof parsed.leftSidebarOpen === "boolean"
          ? parsed.leftSidebarOpen
          : true,
      rightSidebarOpen:
        typeof parsed.rightSidebarOpen === "boolean"
          ? parsed.rightSidebarOpen
          : true,
      leftSidebarWidth: clamp(
        Number(parsed.leftSidebarWidth) || 240,
        LEFT_SIDEBAR_MIN,
        LEFT_SIDEBAR_MAX,
      ),
      rightSidebarWidth: clamp(
        Number(parsed.rightSidebarWidth) || 360,
        RIGHT_SIDEBAR_MIN,
        RIGHT_SIDEBAR_MAX,
      ),
      rightPanelTab,
    };
  } catch {
    return null;
  }
}

function saveLayout(state: UiStore) {
  try {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        leftSidebarOpen: state.leftSidebarOpen,
        rightSidebarOpen: state.rightSidebarOpen,
        leftSidebarWidth: state.leftSidebarWidth,
        rightSidebarWidth: state.rightSidebarWidth,
        rightPanelTab: state.rightPanelTab,
      }),
    );
  } catch {
    // Layout persistence is best-effort.
  }
}

const initial = loadLayout() ?? {
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  leftSidebarWidth: 240,
  rightSidebarWidth: 360,
  rightPanelTab: "assets" as RightPanelTab,
};

export const useUiStore = create<UiStore>((set) => ({
  ...initial,
  paletteOpen: false,
  dashboardOpen: false,
  worktreeModalOpen: false,
  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setLeftSidebarWidth: (width) =>
    set({
      leftSidebarWidth: clamp(width, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX),
    }),
  setRightSidebarWidth: (width) =>
    set({
      rightSidebarWidth: clamp(width, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX),
    }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setDashboardOpen: (dashboardOpen) => set({ dashboardOpen }),
  setWorktreeModalOpen: (worktreeModalOpen) => set({ worktreeModalOpen }),
}));

useUiStore.subscribe(saveLayout);

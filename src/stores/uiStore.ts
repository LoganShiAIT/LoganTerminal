import { create } from "zustand";

export type RightPanelTab = "assets" | "review" | "diff" | "math";

interface UiStore {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  /** Height of the review panel's attachment list, above its drag handle. */
  reviewListHeight: number;
  rightPanelTab: RightPanelTab;
  /** Command palette visibility — UI state, not persisted. */
  paletteOpen: boolean;
  /** Agent overview (⌘⇧O) visibility — UI state, not persisted. */
  dashboardOpen: boolean;
  /** Worktree modal (⌘⇧N) visibility — UI state, not persisted. */
  worktreeModalOpen: boolean;
  /** File/folder finder (⌘⇧F) visibility — UI state, not persisted. */
  fileSearchOpen: boolean;
  /**
   * Pending "show this path in the file tree" request. The counter is what
   * FileTree keys its effect on, so revealing the same path twice in a row
   * still re-fires (and re-plays the highlight).
   */
  reveal: { path: string; isDir: boolean; seq: number } | null;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  setReviewListHeight: (height: number) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  /** Show `tab` in the right sidebar, opening the sidebar if it is closed. */
  openRightPanel: (tab: RightPanelTab) => void;
  /**
   * True toggle for review-glance workflows: hide the sidebar when `tab` is
   * already the visible one, otherwise behave like [`openRightPanel`].
   */
  toggleRightPanel: (tab: RightPanelTab) => void;
  setPaletteOpen: (open: boolean) => void;
  setDashboardOpen: (open: boolean) => void;
  setWorktreeModalOpen: (open: boolean) => void;
  setFileSearchOpen: (open: boolean) => void;
  revealInFileTree: (path: string, isDir: boolean) => void;
}

const UI_KEY = "logan.uiLayout";
export const LEFT_SIDEBAR_MIN = 180;
export const LEFT_SIDEBAR_MAX = 420;
export const RIGHT_SIDEBAR_MIN = 280;
export const RIGHT_SIDEBAR_MAX = 640;
/** Attachment-list bounds. The panel also caps it at 70% of its own height,
 *  so a value persisted from a tall window can't swallow a short one. */
export const REVIEW_LIST_MIN = 72;
export const REVIEW_LIST_MAX = 720;
export const REVIEW_LIST_DEFAULT = 200;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function loadLayout() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const rightPanelTab: RightPanelTab = ["review", "diff", "math"].includes(
      parsed.rightPanelTab,
    )
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
      reviewListHeight: clamp(
        Number(parsed.reviewListHeight) || REVIEW_LIST_DEFAULT,
        REVIEW_LIST_MIN,
        REVIEW_LIST_MAX,
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
        reviewListHeight: state.reviewListHeight,
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
  reviewListHeight: REVIEW_LIST_DEFAULT,
  rightPanelTab: "assets" as RightPanelTab,
};

export const useUiStore = create<UiStore>((set) => ({
  ...initial,
  paletteOpen: false,
  dashboardOpen: false,
  worktreeModalOpen: false,
  fileSearchOpen: false,
  reveal: null,
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
  setReviewListHeight: (height) =>
    set({ reviewListHeight: clamp(height, REVIEW_LIST_MIN, REVIEW_LIST_MAX) }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  openRightPanel: (rightPanelTab) =>
    set({ rightPanelTab, rightSidebarOpen: true }),
  toggleRightPanel: (rightPanelTab) =>
    set((s) =>
      s.rightSidebarOpen && s.rightPanelTab === rightPanelTab
        ? { rightSidebarOpen: false }
        : { rightPanelTab, rightSidebarOpen: true },
    ),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setDashboardOpen: (dashboardOpen) => set({ dashboardOpen }),
  setWorktreeModalOpen: (worktreeModalOpen) => set({ worktreeModalOpen }),
  setFileSearchOpen: (fileSearchOpen) => set({ fileSearchOpen }),
  revealInFileTree: (path, isDir) =>
    set((s) => ({
      // Revealing is pointless against a collapsed sidebar — open it.
      leftSidebarOpen: true,
      reveal: { path, isDir, seq: (s.reveal?.seq ?? 0) + 1 },
    })),
}));

useUiStore.subscribe(saveLayout);

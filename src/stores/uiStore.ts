import { create } from "zustand";

/** The five surfaces the one sidebar can show; also their left-to-right order. */
export type SidebarTab = "files" | "assets" | "review" | "diff" | "math";

export const SIDEBAR_TABS: SidebarTab[] = [
  "files",
  "assets",
  "review",
  "diff",
  "math",
];

interface UiStore {
  sidebarOpen: boolean;
  sidebarWidth: number;
  /** Height of the review panel's attachment list, above its drag handle. */
  reviewListHeight: number;
  sidebarTab: SidebarTab;
  /** True while the seam is being dragged — the panel drops its width
   *  transition for the duration so it tracks the cursor. Not persisted. */
  sidebarResizing: boolean;
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
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setReviewListHeight: (height: number) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarResizing: (resizing: boolean) => void;
  /** Show `tab` in the sidebar, opening the sidebar if it is closed. */
  openSidebarPanel: (tab: SidebarTab) => void;
  /**
   * True toggle for glance workflows: hide the sidebar when `tab` is already
   * the visible one, otherwise behave like [`openSidebarPanel`].
   */
  toggleSidebarPanel: (tab: SidebarTab) => void;
  setPaletteOpen: (open: boolean) => void;
  setDashboardOpen: (open: boolean) => void;
  setWorktreeModalOpen: (open: boolean) => void;
  setFileSearchOpen: (open: boolean) => void;
  revealInFileTree: (path: string, isDir: boolean) => void;
}

const UI_KEY = "logan.uiLayout";
/** Wide enough that the five-segment tab strip still reads at the minimum. */
export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 720;
export const SIDEBAR_DEFAULT = 320;
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
    return {
      sidebarOpen:
        typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : true,
      sidebarWidth: clamp(
        Number(parsed.sidebarWidth) || SIDEBAR_DEFAULT,
        SIDEBAR_MIN,
        SIDEBAR_MAX,
      ),
      reviewListHeight: clamp(
        Number(parsed.reviewListHeight) || REVIEW_LIST_DEFAULT,
        REVIEW_LIST_MIN,
        REVIEW_LIST_MAX,
      ),
      sidebarTab: SIDEBAR_TABS.includes(parsed.sidebarTab)
        ? (parsed.sidebarTab as SidebarTab)
        : "files",
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
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        reviewListHeight: state.reviewListHeight,
        sidebarTab: state.sidebarTab,
      }),
    );
  } catch {
    // Layout persistence is best-effort.
  }
}

const initial = loadLayout() ?? {
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT,
  reviewListHeight: REVIEW_LIST_DEFAULT,
  sidebarTab: "files" as SidebarTab,
};

export const useUiStore = create<UiStore>((set) => ({
  ...initial,
  sidebarResizing: false,
  paletteOpen: false,
  dashboardOpen: false,
  worktreeModalOpen: false,
  fileSearchOpen: false,
  reveal: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (width) =>
    set({ sidebarWidth: clamp(width, SIDEBAR_MIN, SIDEBAR_MAX) }),
  setReviewListHeight: (height) =>
    set({ reviewListHeight: clamp(height, REVIEW_LIST_MIN, REVIEW_LIST_MAX) }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setSidebarResizing: (sidebarResizing) => set({ sidebarResizing }),
  openSidebarPanel: (sidebarTab) => set({ sidebarTab, sidebarOpen: true }),
  toggleSidebarPanel: (sidebarTab) =>
    set((s) =>
      s.sidebarOpen && s.sidebarTab === sidebarTab
        ? { sidebarOpen: false }
        : { sidebarTab, sidebarOpen: true },
    ),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setDashboardOpen: (dashboardOpen) => set({ dashboardOpen }),
  setWorktreeModalOpen: (worktreeModalOpen) => set({ worktreeModalOpen }),
  setFileSearchOpen: (fileSearchOpen) => set({ fileSearchOpen }),
  revealInFileTree: (path, isDir) =>
    set((s) => ({
      // Revealing is pointless against a hidden tree — open the sidebar and
      // put the file tab in front of whatever else was showing.
      sidebarOpen: true,
      sidebarTab: "files",
      reveal: { path, isDir, seq: (s.reveal?.seq ?? 0) + 1 },
    })),
}));

useUiStore.subscribe(saveLayout);

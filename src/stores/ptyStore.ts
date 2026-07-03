import { create } from "zustand";

export interface PtyTab {
  id: string;
  sessionId: string | null;
  cwd: string | null;
  agentName: string | null;
  initialCwd: string | null;
  /** Output arrived while the tab was in the background; cleared on activation. */
  unread: boolean;
  /** The shell process ended; the tab stays open but accepts no input. */
  exited: boolean;
}

interface PtyStore {
  tabs: PtyTab[];
  activeTabId: string | null;
  dropPaths: string[] | null;
  addTab: (initialCwd?: string | null) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  moveTab: (from: number, to: number) => void;
  cycleTab: (dir: 1 | -1) => void;
  jumpToTab: (index: number) => void;
  setSessionId: (tabId: string, sessionId: string | null) => void;
  setCwd: (tabId: string, cwd: string | null) => void;
  setAgentName: (tabId: string, name: string | null) => void;
  markUnread: (tabId: string) => void;
  markExited: (tabId: string) => void;
  setDropPaths: (paths: string[] | null) => void;
}

function makeTab(initialCwd: string | null = null): PtyTab {
  return {
    id: crypto.randomUUID(),
    sessionId: null,
    cwd: null,
    agentName: null,
    initialCwd,
    unread: false,
    exited: false,
  };
}

function withUnreadCleared(tabs: PtyTab[], activeId: string | null): PtyTab[] {
  return tabs.map((t) =>
    t.id === activeId && t.unread ? { ...t, unread: false } : t,
  );
}

const SNAPSHOT_KEY = "logan.tabSnapshot";
const MAX_RESTORED_TABS = 9;

function loadSnapshotCwds(): (string | null)[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_RESTORED_TABS)
      .map((cwd) => (typeof cwd === "string" ? cwd : null));
  } catch {
    return [];
  }
}

function saveSnapshot(tabs: PtyTab[]) {
  try {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify(tabs.map((t) => t.cwd)),
    );
  } catch {
    // localStorage unavailable or quota exceeded — session restore is best-effort.
  }
}

const restoredCwds = loadSnapshotCwds();
const initialTabs =
  restoredCwds.length > 0 ? restoredCwds.map((cwd) => makeTab(cwd)) : [makeTab()];

export const usePtyStore = create<PtyStore>((set, get) => ({
  tabs: initialTabs,
  activeTabId: initialTabs[0].id,
  dropPaths: null,

  addTab: (initialCwd = null) => {
    const tab = makeTab(initialCwd);
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    return tab.id;
  },

  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (activeTabId === id) {
        const fallback = tabs[idx] ?? tabs[idx - 1];
        activeTabId = fallback ? fallback.id : null;
      }
      return { tabs, activeTabId };
    });
  },

  setActiveTab: (id) =>
    set((s) => ({ activeTabId: id, tabs: withUnreadCleared(s.tabs, id) })),

  moveTab: (from, to) =>
    set((s) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= s.tabs.length ||
        to >= s.tabs.length
      )
        return s;
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { tabs };
    }),

  cycleTab: (dir) => {
    const { tabs, activeTabId } = get();
    if (tabs.length === 0) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    const next = (idx + dir + tabs.length) % tabs.length;
    get().setActiveTab(tabs[next].id);
  },

  jumpToTab: (index) => {
    const { tabs } = get();
    if (index < 0 || index >= tabs.length) return;
    get().setActiveTab(tabs[index].id);
  },

  setSessionId: (tabId, sessionId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, sessionId } : t)),
    })),

  setCwd: (tabId, cwd) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, cwd } : t)),
    })),

  setAgentName: (tabId, agentName) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, agentName } : t)),
    })),

  markUnread: (tabId) =>
    set((s) => {
      // The active tab is being watched — only background output counts.
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab || tab.unread || tabId === s.activeTabId) return s;
      return {
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, unread: true } : t)),
      };
    }),

  markExited: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, exited: true } : t)),
    })),

  setDropPaths: (paths) => set({ dropPaths: paths }),
}));

export function useActiveTab(): PtyTab | undefined {
  return usePtyStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
}

usePtyStore.subscribe((state, prevState) => {
  if (state.tabs !== prevState.tabs) saveSnapshot(state.tabs);
});

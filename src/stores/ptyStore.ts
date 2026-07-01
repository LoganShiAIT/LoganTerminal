import { create } from "zustand";

export interface PtyTab {
  id: string;
  sessionId: string | null;
  cwd: string | null;
  agentName: string | null;
  initialCwd: string | null;
}

interface PtyStore {
  tabs: PtyTab[];
  activeTabId: string | null;
  dropPaths: string[] | null;
  addTab: (initialCwd?: string | null) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  cycleTab: (dir: 1 | -1) => void;
  jumpToTab: (index: number) => void;
  setSessionId: (tabId: string, sessionId: string | null) => void;
  setCwd: (tabId: string, cwd: string | null) => void;
  setAgentName: (tabId: string, name: string | null) => void;
  setDropPaths: (paths: string[] | null) => void;
}

function makeTab(initialCwd: string | null = null): PtyTab {
  return {
    id: crypto.randomUUID(),
    sessionId: null,
    cwd: null,
    agentName: null,
    initialCwd,
  };
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

  setActiveTab: (id) => set({ activeTabId: id }),

  cycleTab: (dir) => {
    const { tabs, activeTabId } = get();
    if (tabs.length === 0) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    const next = (idx + dir + tabs.length) % tabs.length;
    set({ activeTabId: tabs[next].id });
  },

  jumpToTab: (index) => {
    const { tabs } = get();
    if (index < 0 || index >= tabs.length) return;
    set({ activeTabId: tabs[index].id });
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

  setDropPaths: (paths) => set({ dropPaths: paths }),
}));

export function useActiveTab(): PtyTab | undefined {
  return usePtyStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
}

usePtyStore.subscribe((state, prevState) => {
  if (state.tabs !== prevState.tabs) saveSnapshot(state.tabs);
});

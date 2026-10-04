import { readWorkspaceSnapshot } from "./workspaceSnapshot";
import { useDocumentStore } from "./documentStore";
import { useWorkspaceStore } from "./workspaceStore";
import { create } from "zustand";
import type { GitDirty } from "../lib/git";
import { dirLabel } from "../lib/paths";
import {
  activeLeafOf,
  attentionPanes,
  collectLeaves,
  findLeaf,
  findParentSplit,
  firstLeaf,
  makeLeaf,
  makeSplit,
  makeTab,
  removeLeafFrom,
  splitLeafIn,
  updateLeafIn,
  updateSplitRatioIn,
  MAX_PANES_PER_TAB,
  type LeafPane,
  type PaneNode,
  type PtyTab,
} from "./paneTree";
import { loadSnapshotTabs, saveSnapshot } from "./tabSnapshot";

// The pane tree's types and pure helpers are re-exported so consumers keep
// importing everything terminal-related from one place.
export {
  activeLeafOf,
  attentionPanes,
  collectLeaves,
  findLeaf,
  firstLeaf,
  MAX_PANES_PER_TAB,
} from "./paneTree";
export type { LeafPane, PaneNode, PtyTab, SplitPane } from "./paneTree";

interface PtyStore {
  tabs: PtyTab[];
  activeTabId: string | null;
  dropPaths: string[] | null;
  /** New tab; optional one-shot `initialCmd` typed into the shell on spawn. */
  addTab: (initialCwd?: string | null, initialCmd?: string | null) => string;
  /**
   * New tab pre-split into a 2-pane row or 2×2 grid, every pane running
   * `cmd` once after its shell spawns (null = plain shells). Inherits the
   * active pane's directory, same as addTab-from-current semantics.
   */
  addFleetTab: (panes: 2 | 4, cmd: string | null) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  moveTab: (from: number, to: number) => void;
  cycleTab: (dir: 1 | -1) => void;
  jumpToTab: (index: number) => void;
  /**
   * Split the focused pane. `cwd` overrides where the new pane starts —
   * the file tree uses it to open a split directly in a browsed folder
   * instead of inheriting the source pane's directory. `initialCmd` is the
   * same one-shot startup command `addTab` takes (agent launchers use it).
   */
  splitPane: (
    dir: "row" | "col",
    cwd?: string | null,
    initialCmd?: string | null,
  ) => void;
  /** Close the active pane; closing the last pane closes the tab. */
  closeActivePane: () => void;
  setActivePane: (tabId: string, paneId: string) => void;
  cyclePane: (dir: 1 | -1) => void;
  /** Toggle maximizing the active tab's focused pane over its siblings. */
  toggleZoom: () => void;
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  setSessionId: (paneId: string, sessionId: string | null) => void;
  setCwd: (paneId: string, cwd: string | null) => void;
  setAgentName: (paneId: string, name: string | null, at?: number) => void;
  /** Branch + dirty counts land together (one OSC 7 refresh, one render). */
  setGitInfo: (
    paneId: string,
    branch: string | null,
    dirty: GitDirty | null,
  ) => void;
  /** Consume a pane's one-shot startup command after sending it. */
  clearInitialCmd: (paneId: string) => void;
  /** Start/reset a pane's idle timer by hand (the chip and palette action). */
  markAgentIdle: (paneId: string, at?: number) => void;
  setPaneTitle: (paneId: string, title: string | null) => void;
  /** Both null = a command just started; both set = it finished. */
  setCommandResult: (
    paneId: string,
    code: number | null,
    durationMs: number | null,
  ) => void;
  /**
   * Flip a pane's "something is running here" flag (see LeafPane.busy) and,
   * on an agent pane, drive `agentIdleSinceAt` off the same edge.
   */
  setPaneBusy: (paneId: string, busy: boolean, at?: number) => void;
  markUnread: (tabId: string, paneId: string) => void;
  /** Strong needs-a-human signal (bell / long command done); see LeafPane.attention. */
  markAttention: (tabId: string, paneId: string) => void;
  /** Focus the first pane flagged for attention; returns false when none. */
  jumpToAttention: () => boolean;
  /** Toggle keystroke fanout to all panes of a tab (tmux synchronize-panes). */
  toggleBroadcast: (tabId: string) => void;
  markPaneExited: (paneId: string) => void;
  setDropPaths: (paths: string[] | null) => void;
}

/**
 * On activating a tab, clear its tab-level dot AND its focused pane's dot +
 * attention flag (that pane is now being watched) — but leave any other
 * background pane's markers alone until the user actually focuses it.
 */
function withUnreadCleared(tabs: PtyTab[], activeId: string | null): PtyTab[] {
  return tabs.map((t) => {
    if (t.id !== activeId) return t;
    const root = updateLeafIn(t.root, t.activePaneId, (l) =>
      l.unread || l.attention ? { ...l, unread: false, attention: false } : l,
    );
    return !t.unread && root === t.root ? t : { ...t, unread: false, root };
  });
}

const restoredTabs = loadSnapshotTabs();
const initialTabs =
  restoredTabs.length > 0 || readWorkspaceSnapshot() ? restoredTabs : [makeTab(makeLeaf())];

export const usePtyStore = create<PtyStore>((set, get) => {
  const updatePane = (paneId: string, fn: (leaf: LeafPane) => LeafPane) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        const root = updateLeafIn(t.root, paneId, fn);
        return root === t.root ? t : { ...t, root };
      }),
    }));

  /** Replace one tab in place; other tabs keep their identity. */
  const updateTab = (tabId: string, fn: (tab: PtyTab) => PtyTab) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? fn(t) : t)) }));

  const activeTab = () => {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId);
  };

  return {
    tabs: initialTabs,
    activeTabId: initialTabs[0]?.id ?? null,
    dropPaths: null,

    addTab: (initialCwd = null, initialCmd = null) => {
      const tab = makeTab(makeLeaf(initialCwd, initialCmd?.trim() || null));
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      return tab.id;
    },

    addFleetTab: (panes, cmd) => {
      const tab = activeTab();
      const source = tab ? activeLeafOf(tab) : null;
      const focus = useWorkspaceStore.getState().focus;
      const docCwd = focus?.kind === "document" ? useDocumentStore.getState().documents[focus.documentId]?.baseDir : null;
      const cwd = docCwd ?? (source ? (source.cwd ?? source.initialCwd) : null);
      const startCmd = cmd?.trim() || null;
      const leaf = () => makeLeaf(cwd, startCmd);
      const pair = () => makeSplit("col", leaf(), leaf());
      const root: PaneNode =
        panes === 2
          ? makeSplit("row", leaf(), leaf())
          : makeSplit("row", pair(), pair());
      const fleet = makeTab(root);
      set((s) => ({ tabs: [...s.tabs, fleet], activeTabId: fleet.id }));
      return fleet.id;
    },

    closeTab: (id) => {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        if (idx === -1) return s;
        const tabs = s.tabs.filter((t) => t.id !== id);
        let activeTabId = s.activeTabId;
        if (activeTabId === id) {
          // Focus the tab that slid into this slot, else the one before it.
          const fallback = tabs[idx] ?? tabs[idx - 1];
          activeTabId = fallback ? fallback.id : null;
        }
        return { tabs, activeTabId };
      });
    },

    setActiveTab: (id) => {
      set((s) => ({ activeTabId: id, tabs: withUnreadCleared(s.tabs, id) }));
      useWorkspaceStore.getState().focusTerminal(id);
    },

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
      get().setActiveTab(tabs[(idx + dir + tabs.length) % tabs.length].id);
    },

    jumpToTab: (index) => {
      const { tabs } = get();
      if (index < 0 || index >= tabs.length) return;
      get().setActiveTab(tabs[index].id);
    },

    splitPane: (dir, cwd, initialCmd = null) => {
      if (useWorkspaceStore.getState().focus?.kind === "document") return;
      const tab = activeTab();
      if (!tab) return;
      if (collectLeaves(tab.root).length >= MAX_PANES_PER_TAB) return;
      const source = activeLeafOf(tab);
      const newLeaf = makeLeaf(
        cwd ?? source.cwd ?? source.initialCwd,
        initialCmd?.trim() || null,
      );
      const root = splitLeafIn(tab.root, source.id, dir, newLeaf);
      if (root === tab.root) return;
      updateTab(tab.id, (t) => ({
        ...t,
        root,
        activePaneId: newLeaf.id,
        zoomedPaneId: null,
      }));
    },

    closeActivePane: () => {
      if (useWorkspaceStore.getState().focus?.kind === "document") return;
      const tab = activeTab();
      if (!tab) return;
      if (tab.root.type === "leaf") {
        get().closeTab(tab.id);
        return;
      }
      const paneId = tab.activePaneId;
      // Focus lands on the sibling that inherits the closed pane's space.
      const parent = findParentSplit(tab.root, paneId);
      const sibling =
        parent &&
        (parent.a.type === "leaf" && parent.a.id === paneId
          ? parent.b
          : parent.a);
      updateTab(tab.id, (t) => {
        const root = removeLeafFrom(t.root, paneId);
        if (root === null || root === t.root) return t;
        return {
          ...t,
          root,
          activePaneId: sibling ? firstLeaf(sibling).id : firstLeaf(root).id,
          zoomedPaneId: null,
        };
      });
    },

    setActivePane: (tabId, paneId) => {
      useWorkspaceStore.getState().focusTerminal(tabId, paneId);
      updateTab(tabId, (t) => {
        const root = updateLeafIn(t.root, paneId, (l) =>
          l.unread || l.attention
            ? { ...l, unread: false, attention: false }
            : l,
        );
        if (t.activePaneId === paneId && root === t.root) return t;
        return { ...t, activePaneId: paneId, root };
      });
    },

    cyclePane: (dir) => {
      if (useWorkspaceStore.getState().focus?.kind === "document") return;
      const tab = activeTab();
      if (!tab) return;
      const leaves = collectLeaves(tab.root);
      if (leaves.length < 2) return;
      const idx = leaves.findIndex((l) => l.id === tab.activePaneId);
      get().setActivePane(
        tab.id,
        leaves[(idx + dir + leaves.length) % leaves.length].id,
      );
    },

    toggleZoom: () => {
      if (useWorkspaceStore.getState().focus?.kind === "document") return;
      const tab = activeTab();
      if (!tab || tab.root.type === "leaf") return;
      updateTab(tab.id, (t) => ({
        ...t,
        zoomedPaneId: t.zoomedPaneId ? null : t.activePaneId,
      }));
    },

    setSplitRatio: (tabId, splitId, ratio) =>
      updateTab(tabId, (t) => {
        const root = updateSplitRatioIn(t.root, splitId, ratio);
        return root === t.root ? t : { ...t, root };
      }),

    setSessionId: (paneId, sessionId) =>
      updatePane(paneId, (l) => ({ ...l, sessionId })),

    setCwd: (paneId, cwd) => updatePane(paneId, (l) => ({ ...l, cwd })),

    // Detection can land after the CLI's banner already went quiet, which
    // would leave the first turn untimed; an agent appearing on an idle pane
    // therefore starts the clock itself. Losing the agent stops it — a bare
    // shell has nobody waiting on the user.
    setAgentName: (paneId, agentName, at = Date.now()) =>
      updatePane(paneId, (l) => {
        if (l.agentName === agentName) return l;
        const next = { ...l, agentName };
        if (!agentName) next.agentIdleSinceAt = null;
        else if (!l.busy && l.agentIdleSinceAt === null)
          next.agentIdleSinceAt = at;
        return next;
      }),

    setGitInfo: (paneId, gitBranch, gitDirty) =>
      updatePane(paneId, (l) => {
        const sameDirty =
          l.gitDirty === gitDirty ||
          (l.gitDirty !== null &&
            gitDirty !== null &&
            l.gitDirty.added === gitDirty.added &&
            l.gitDirty.modified === gitDirty.modified &&
            l.gitDirty.deleted === gitDirty.deleted);
        return l.gitBranch === gitBranch && sameDirty
          ? l
          : { ...l, gitBranch, gitDirty };
      }),

    clearInitialCmd: (paneId) =>
      updatePane(paneId, (l) =>
        l.initialCmd === null ? l : { ...l, initialCmd: null },
      ),

    markAgentIdle: (paneId, at = Date.now()) =>
      updatePane(paneId, (l) =>
        l.agentIdleSinceAt === at ? l : { ...l, agentIdleSinceAt: at },
      ),

    setPaneTitle: (paneId, title) =>
      updatePane(paneId, (l) => (l.title === title ? l : { ...l, title })),

    setCommandResult: (paneId, lastExitCode, lastDurationMs) =>
      updatePane(paneId, (l) =>
        l.lastExitCode === lastExitCode && l.lastDurationMs === lastDurationMs
          ? l
          : { ...l, lastExitCode, lastDurationMs },
      ),

    // The idle stamp rides this edge: work starting clears it, work falling
    // silent starts it. Only on a live agent pane — a plain shell going quiet
    // isn't an agent handing the turn back, and a dead one waits on nobody.
    setPaneBusy: (paneId, busy, at = Date.now()) =>
      updatePane(paneId, (l) => {
        if (l.busy === busy) return l;
        const tracks = Boolean(l.agentName) && !l.exited;
        return {
          ...l,
          busy,
          agentIdleSinceAt: tracks ? (busy ? null : at) : l.agentIdleSinceAt,
        };
      }),

    markUnread: (tabId, paneId) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId);
        if (!tab) return s;
        const focus = useWorkspaceStore.getState().focus;
        const tabIsActive = tabId === s.activeTabId && (!focus || focus.kind === "terminal");
        // Both true: this exact pane is the one being watched right now.
        if (tabIsActive && paneId === tab.activePaneId) return s;

        const root = updateLeafIn(tab.root, paneId, (l) =>
          l.unread ? l : { ...l, unread: true },
        );
        // Tab-level dot keeps its pre-existing meaning: "the whole tab was
        // in the background" — untouched when the tab itself is active,
        // even if a non-focused sibling pane just produced output.
        const unread = tabIsActive ? tab.unread : true;
        if (root === tab.root && unread === tab.unread) return s;
        return {
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, root, unread } : t)),
        };
      }),

    markAttention: (tabId, paneId) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId);
        if (!tab) return s;
        // Watched right now → nothing to flag (same rule as markUnread).
        const focus = useWorkspaceStore.getState().focus;
        if (tabId === s.activeTabId && paneId === tab.activePaneId && (!focus || focus.kind === "terminal")) return s;
        const root = updateLeafIn(tab.root, paneId, (l) =>
          l.attention ? l : { ...l, attention: true },
        );
        if (root === tab.root) return s;
        return { tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, root } : t)) };
      }),

    jumpToAttention: () => {
      const hit = attentionPanes(get().tabs)[0];
      if (!hit) return false;
      // setActiveTab clears the *current* focused pane's markers; ordering
      // matters — activate the tab first, then focus the flagged pane
      // (which clears its own flag and makes the next call cycle onward).
      get().setActiveTab(hit.tab.id);
      get().setActivePane(hit.tab.id, hit.leaf.id);
      return true;
    },

    toggleBroadcast: (tabId) => {
      if (useWorkspaceStore.getState().focus?.kind === "document") return;
      updateTab(tabId, (t) => ({ ...t, broadcast: !t.broadcast }));
    },

    markPaneExited: (paneId) =>
      updatePane(paneId, (l) => ({ ...l, exited: true, busy: false })),

    setDropPaths: (paths) => set({ dropPaths: paths }),
  };
});

export function useActiveTab(): PtyTab | undefined {
  return usePtyStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
}

/** The focused pane of the active tab — the target for inserts/status. */
export function useActivePane(): LeafPane | undefined {
  return usePtyStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab ? activeLeafOf(tab) : undefined;
  });
}

/** Non-hook accessor for event handlers. */
export function getActiveLeaf(): LeafPane | undefined {
  const s = usePtyStore.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  return tab ? activeLeafOf(tab) : undefined;
}

/**
 * Short "where did this happen" label for a pane — its directory's last
 * segment, or "shell" before the first OSC 7 lands. Used by notification
 * bodies, which have no room for a full path.
 */
export function paneWhere(tabId: string, paneId: string): string {
  const tab = usePtyStore.getState().tabs.find((t) => t.id === tabId);
  const cwd = tab ? findLeaf(tab.root, paneId)?.cwd : null;
  return cwd ? dirLabel(cwd) : "shell";
}

usePtyStore.subscribe((state, prevState) => {
  if (state.tabs !== prevState.tabs) saveSnapshot(state.tabs);
});

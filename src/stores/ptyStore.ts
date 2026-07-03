import { create } from "zustand";

/** A terminal pane holding one PTY session. */
export interface LeafPane {
  type: "leaf";
  id: string;
  sessionId: string | null;
  cwd: string | null;
  agentName: string | null;
  initialCwd: string | null;
  /** The shell process ended; the pane stays visible but accepts no input. */
  exited: boolean;
}

export interface SplitPane {
  type: "split";
  id: string;
  /** "row" = panes side by side; "col" = stacked. */
  dir: "row" | "col";
  /** Size share of child `a`, clamped to RATIO_MIN..RATIO_MAX. */
  ratio: number;
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = LeafPane | SplitPane;

export interface PtyTab {
  id: string;
  root: PaneNode;
  activePaneId: string;
  /** Output arrived while the tab was in the background; cleared on activation. */
  unread: boolean;
}

export const MAX_PANES_PER_TAB = 8;
const RATIO_MIN = 0.15;
const RATIO_MAX = 0.85;

function clampRatio(r: number): number {
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, r));
}

function makeLeaf(initialCwd: string | null = null): LeafPane {
  return {
    type: "leaf",
    id: crypto.randomUUID(),
    sessionId: null,
    cwd: null,
    agentName: null,
    initialCwd,
    exited: false,
  };
}

function makeTab(root: PaneNode): PtyTab {
  return {
    id: crypto.randomUUID(),
    root,
    activePaneId: firstLeaf(root).id,
    unread: false,
  };
}

// ---------------------------------------------------------------------------
// Pane-tree helpers (exported ones are used by components).

export function collectLeaves(node: PaneNode): LeafPane[] {
  if (node.type === "leaf") return [node];
  return [...collectLeaves(node.a), ...collectLeaves(node.b)];
}

export function firstLeaf(node: PaneNode): LeafPane {
  return node.type === "leaf" ? node : firstLeaf(node.a);
}

export function findLeaf(node: PaneNode, paneId: string): LeafPane | undefined {
  if (node.type === "leaf") return node.id === paneId ? node : undefined;
  return findLeaf(node.a, paneId) ?? findLeaf(node.b, paneId);
}

/** The leaf a tab's UI (label, status bar, inserts) should represent. */
export function activeLeafOf(tab: PtyTab): LeafPane {
  return findLeaf(tab.root, tab.activePaneId) ?? firstLeaf(tab.root);
}

/** Immutable leaf update; untouched subtrees keep their identity. */
function updateLeafIn(
  node: PaneNode,
  paneId: string,
  fn: (leaf: LeafPane) => LeafPane,
): PaneNode {
  if (node.type === "leaf") {
    return node.id === paneId ? fn(node) : node;
  }
  const a = updateLeafIn(node.a, paneId, fn);
  const b = updateLeafIn(node.b, paneId, fn);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function updateSplitRatioIn(
  node: PaneNode,
  splitId: string,
  ratio: number,
): PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio: clampRatio(ratio) };
  const a = updateSplitRatioIn(node.a, splitId, ratio);
  const b = updateSplitRatioIn(node.b, splitId, ratio);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function splitLeafIn(
  node: PaneNode,
  paneId: string,
  dir: "row" | "col",
  newLeaf: LeafPane,
): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== paneId) return node;
    return {
      type: "split",
      id: crypto.randomUUID(),
      dir,
      ratio: 0.5,
      a: node,
      b: newLeaf,
    };
  }
  const a = splitLeafIn(node.a, paneId, dir, newLeaf);
  const b = splitLeafIn(node.b, paneId, dir, newLeaf);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** Returns null when `node` itself is the removed leaf. */
function removeLeafFrom(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "leaf") return node.id === paneId ? null : node;
  const a = removeLeafFrom(node.a, paneId);
  if (a === null) return node.b;
  const b = removeLeafFrom(node.b, paneId);
  if (b === null) return node.a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function findParentSplit(
  node: PaneNode,
  paneId: string,
): SplitPane | undefined {
  if (node.type === "leaf") return undefined;
  if (
    (node.a.type === "leaf" && node.a.id === paneId) ||
    (node.b.type === "leaf" && node.b.id === paneId)
  ) {
    return node;
  }
  return findParentSplit(node.a, paneId) ?? findParentSplit(node.b, paneId);
}

// ---------------------------------------------------------------------------
// Store

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
  /** Split the active pane of the active tab; focuses the new pane. */
  splitPane: (dir: "row" | "col") => void;
  /** Close the active pane; closing the last pane closes the tab. */
  closeActivePane: () => void;
  setActivePane: (tabId: string, paneId: string) => void;
  cyclePane: (dir: 1 | -1) => void;
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  setSessionId: (paneId: string, sessionId: string | null) => void;
  setCwd: (paneId: string, cwd: string | null) => void;
  setAgentName: (paneId: string, name: string | null) => void;
  markUnread: (tabId: string) => void;
  markPaneExited: (paneId: string) => void;
  setDropPaths: (paths: string[] | null) => void;
}

function withUnreadCleared(tabs: PtyTab[], activeId: string | null): PtyTab[] {
  return tabs.map((t) =>
    t.id === activeId && t.unread ? { ...t, unread: false } : t,
  );
}

// ---------------------------------------------------------------------------
// Snapshot persistence: the pane tree serializes to nested {dir,ratio,a,b}
// with leaves as cwd strings. The legacy format (flat cwd array) is a valid
// subset — a bare string deserializes to a single-leaf tab.

type PaneSnapshot =
  | string
  | null
  | { dir: "row" | "col"; ratio: number; a: PaneSnapshot; b: PaneSnapshot };

const SNAPSHOT_KEY = "logan.tabSnapshot";
const MAX_RESTORED_TABS = 9;
/** Depth 3 caps a restored tab at 8 leaves = MAX_PANES_PER_TAB. */
const MAX_RESTORE_DEPTH = 3;

function serializeNode(node: PaneNode): PaneSnapshot {
  if (node.type === "leaf") return node.cwd ?? node.initialCwd;
  return {
    dir: node.dir,
    ratio: node.ratio,
    a: serializeNode(node.a),
    b: serializeNode(node.b),
  };
}

function deserializeNode(snap: unknown, depth: number): PaneNode {
  if (typeof snap === "string") return makeLeaf(snap);
  if (
    snap !== null &&
    typeof snap === "object" &&
    "a" in snap &&
    "b" in snap &&
    depth < MAX_RESTORE_DEPTH
  ) {
    const s = snap as { dir?: unknown; ratio?: unknown; a: unknown; b: unknown };
    return {
      type: "split",
      id: crypto.randomUUID(),
      dir: s.dir === "col" ? "col" : "row",
      ratio: clampRatio(Number(s.ratio) || 0.5),
      a: deserializeNode(s.a, depth + 1),
      b: deserializeNode(s.b, depth + 1),
    };
  }
  return makeLeaf(null);
}

function loadSnapshotTabs(): PtyTab[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_RESTORED_TABS)
      .map((snap) => makeTab(deserializeNode(snap, 0)));
  } catch {
    return [];
  }
}

function saveSnapshot(tabs: PtyTab[]) {
  try {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify(tabs.map((t) => serializeNode(t.root))),
    );
  } catch {
    // localStorage unavailable or quota exceeded — session restore is best-effort.
  }
}

const restoredTabs = loadSnapshotTabs();
const initialTabs =
  restoredTabs.length > 0 ? restoredTabs : [makeTab(makeLeaf())];

export const usePtyStore = create<PtyStore>((set, get) => {
  const updatePane = (paneId: string, fn: (leaf: LeafPane) => LeafPane) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        const root = updateLeafIn(t.root, paneId, fn);
        return root === t.root ? t : { ...t, root };
      }),
    }));

  return {
    tabs: initialTabs,
    activeTabId: initialTabs[0].id,
    dropPaths: null,

    addTab: (initialCwd = null) => {
      const tab = makeTab(makeLeaf(initialCwd));
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

    splitPane: (dir) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        if (!tab) return s;
        if (collectLeaves(tab.root).length >= MAX_PANES_PER_TAB) return s;
        const source = activeLeafOf(tab);
        const newLeaf = makeLeaf(source.cwd ?? source.initialCwd);
        const root = splitLeafIn(tab.root, source.id, dir, newLeaf);
        if (root === tab.root) return s;
        return {
          tabs: s.tabs.map((t) =>
            t.id === tab.id ? { ...t, root, activePaneId: newLeaf.id } : t,
          ),
        };
      }),

    closeActivePane: () => {
      const s = get();
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
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
      set((st) => ({
        tabs: st.tabs.map((t) => {
          if (t.id !== tab.id) return t;
          const root = removeLeafFrom(t.root, paneId);
          if (root === null || root === t.root) return t;
          const nextActive = sibling ? firstLeaf(sibling).id : firstLeaf(root).id;
          return { ...t, root, activePaneId: nextActive };
        }),
      }));
    },

    setActivePane: (tabId, paneId) =>
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.activePaneId !== paneId
            ? { ...t, activePaneId: paneId }
            : t,
        ),
      })),

    cyclePane: (dir) => {
      const s = get();
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (!tab) return;
      const leaves = collectLeaves(tab.root);
      if (leaves.length < 2) return;
      const idx = leaves.findIndex((l) => l.id === tab.activePaneId);
      const next = leaves[(idx + dir + leaves.length) % leaves.length];
      get().setActivePane(tab.id, next.id);
    },

    setSplitRatio: (tabId, splitId, ratio) =>
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== tabId) return t;
          const root = updateSplitRatioIn(t.root, splitId, ratio);
          return root === t.root ? t : { ...t, root };
        }),
      })),

    setSessionId: (paneId, sessionId) =>
      updatePane(paneId, (l) => ({ ...l, sessionId })),

    setCwd: (paneId, cwd) => updatePane(paneId, (l) => ({ ...l, cwd })),

    setAgentName: (paneId, agentName) =>
      updatePane(paneId, (l) =>
        l.agentName === agentName ? l : { ...l, agentName },
      ),

    markUnread: (tabId) =>
      set((s) => {
        // The active tab is being watched — only background output counts.
        const tab = s.tabs.find((t) => t.id === tabId);
        if (!tab || tab.unread || tabId === s.activeTabId) return s;
        return {
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, unread: true } : t)),
        };
      }),

    markPaneExited: (paneId) =>
      updatePane(paneId, (l) => ({ ...l, exited: true })),

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

usePtyStore.subscribe((state, prevState) => {
  if (state.tabs !== prevState.tabs) saveSnapshot(state.tabs);
});

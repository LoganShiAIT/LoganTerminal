import { create } from "zustand";
import type { GitDirty } from "../lib/git";

/** A terminal pane holding one PTY session. */
export interface LeafPane {
  type: "leaf";
  id: string;
  sessionId: string | null;
  cwd: string | null;
  agentName: string | null;
  /** Last time the user submitted input to a detected agent in this pane. */
  lastPromptSentAt: number | null;
  /** Shell/app-set window title (OSC 0/2); tab label prefers it over cwd. */
  title: string | null;
  initialCwd: string | null;
  /**
   * Git branch of cwd (read from .git/HEAD on every OSC 7 prompt event);
   * null = not a repository / unknown.
   */
  gitBranch: string | null;
  /**
   * Working-tree dirty counts (`git status --porcelain`), refreshed with
   * the branch on every OSC 7 prompt event. null = clean-or-unknown; the
   * chip treats an all-zero value the same way.
   */
  gitDirty: GitDirty | null;
  /**
   * One-shot command typed into the shell right after spawn (fleet tabs).
   * Session-only by design: the tab snapshot never carries it, so restored
   * tabs come back as plain shells and never auto-re-run anything.
   */
  initialCmd: string | null;
  /** The shell process ended; the pane stays visible but accepts no input. */
  exited: boolean;
  /**
   * Exit code of the last completed command (OSC 133;D via shell
   * integration, zsh/bash — see Terminal.tsx). Null while a command is
   * running or none has finished yet.
   */
  lastExitCode: number | null;
  /**
   * Wall-clock duration of the last completed command (OSC 133 C→D span).
   * Null while running, when no command finished yet, or when the shell
   * never emitted C (bash < 4.4 has no PS0).
   */
  lastDurationMs: number | null;
  /** Output arrived while this pane wasn't the focused one; see markUnread. */
  unread: boolean;
  /**
   * A strong "needs a human" signal fired while the pane wasn't watched:
   * BEL (agent TUIs ring when blocked on input) or a ≥10s command
   * finishing. Deliberately NOT set by ordinary background output — that's
   * what `unread` is for. Cleared alongside unread when the pane becomes
   * watched.
   */
  attention: boolean;
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
  /** Non-null while one pane is temporarily maximized (⌘⇧Z) over its siblings. */
  zoomedPaneId: string | null;
  /**
   * Keystrokes in the focused pane fan out to every live pane in this tab
   * (tmux synchronize-panes). Deliberately not persisted in the tab
   * snapshot: a forgotten fanout switch surviving a restart is a footgun.
   */
  broadcast: boolean;
}

export const MAX_PANES_PER_TAB = 8;
const RATIO_MIN = 0.15;
const RATIO_MAX = 0.85;

function clampRatio(r: number): number {
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, r));
}

function makeLeaf(
  initialCwd: string | null = null,
  initialCmd: string | null = null,
): LeafPane {
  return {
    type: "leaf",
    id: crypto.randomUUID(),
    sessionId: null,
    cwd: null,
    agentName: null,
    lastPromptSentAt: null,
    title: null,
    initialCwd,
    gitBranch: null,
    gitDirty: null,
    initialCmd,
    exited: false,
    lastExitCode: null,
    lastDurationMs: null,
    unread: false,
    attention: false,
  };
}

function makeTab(root: PaneNode): PtyTab {
  return {
    id: crypto.randomUUID(),
    root,
    activePaneId: firstLeaf(root).id,
    unread: false,
    zoomedPaneId: null,
    broadcast: false,
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
  /** Split the active pane of the active tab; focuses the new pane. */
  splitPane: (dir: "row" | "col") => void;
  /** Close the active pane; closing the last pane closes the tab. */
  closeActivePane: () => void;
  setActivePane: (tabId: string, paneId: string) => void;
  cyclePane: (dir: 1 | -1) => void;
  /** Toggle maximizing the active tab's focused pane over its siblings. */
  toggleZoom: () => void;
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  setSessionId: (paneId: string, sessionId: string | null) => void;
  setCwd: (paneId: string, cwd: string | null) => void;
  setAgentName: (paneId: string, name: string | null) => void;
  /** Branch + dirty counts land together (one OSC 7 refresh, one render). */
  setGitInfo: (
    paneId: string,
    branch: string | null,
    dirty: GitDirty | null,
  ) => void;
  /** Consume a pane's one-shot startup command after sending it. */
  clearInitialCmd: (paneId: string) => void;
  /** Start/reset the prompt cadence timer for a pane. */
  markPromptSent: (paneId: string, at?: number) => void;
  setPaneTitle: (paneId: string, title: string | null) => void;
  /** Both null = a command just started; both set = it finished. */
  setCommandResult: (
    paneId: string,
    code: number | null,
    durationMs: number | null,
  ) => void;
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

/** Every pane currently flagged for attention, in tab order. */
export function attentionPanes(
  tabs: PtyTab[],
): Array<{ tab: PtyTab; tabIndex: number; leaf: LeafPane }> {
  const out: Array<{ tab: PtyTab; tabIndex: number; leaf: LeafPane }> = [];
  tabs.forEach((tab, tabIndex) => {
    for (const leaf of collectLeaves(tab.root)) {
      if (leaf.attention) out.push({ tab, tabIndex, leaf });
    }
  });
  return out;
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

    addTab: (initialCwd = null, initialCmd = null) => {
      const tab = makeTab(makeLeaf(initialCwd, initialCmd?.trim() || null));
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      return tab.id;
    },

    addFleetTab: (panes, cmd) => {
      const s = get();
      const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
      const cwd = activeTab
        ? (activeLeafOf(activeTab).cwd ?? activeLeafOf(activeTab).initialCwd)
        : null;
      const startCmd = cmd?.trim() || null;
      const pair = (): SplitPane => ({
        type: "split",
        id: crypto.randomUUID(),
        dir: "col",
        ratio: 0.5,
        a: makeLeaf(cwd, startCmd),
        b: makeLeaf(cwd, startCmd),
      });
      const root: PaneNode =
        panes === 2
          ? {
              type: "split",
              id: crypto.randomUUID(),
              dir: "row",
              ratio: 0.5,
              a: makeLeaf(cwd, startCmd),
              b: makeLeaf(cwd, startCmd),
            }
          : {
              type: "split",
              id: crypto.randomUUID(),
              dir: "row",
              ratio: 0.5,
              a: pair(),
              b: pair(),
            };
      const tab = makeTab(root);
      set((st) => ({ tabs: [...st.tabs, tab], activeTabId: tab.id }));
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
            t.id === tab.id
              ? { ...t, root, activePaneId: newLeaf.id, zoomedPaneId: null }
              : t,
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
          return { ...t, root, activePaneId: nextActive, zoomedPaneId: null };
        }),
      }));
    },

    setActivePane: (tabId, paneId) =>
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== tabId) return t;
          const root = updateLeafIn(t.root, paneId, (l) =>
            l.unread || l.attention
              ? { ...l, unread: false, attention: false }
              : l,
          );
          if (t.activePaneId === paneId && root === t.root) return t;
          return { ...t, activePaneId: paneId, root };
        }),
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

    toggleZoom: () =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        if (!tab || tab.root.type === "leaf") return s;
        const zoomedPaneId = tab.zoomedPaneId ? null : tab.activePaneId;
        return {
          tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, zoomedPaneId } : t)),
        };
      }),

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

    markPromptSent: (paneId, at = Date.now()) =>
      updatePane(paneId, (l) =>
        l.lastPromptSentAt === at ? l : { ...l, lastPromptSentAt: at },
      ),

    setPaneTitle: (paneId, title) =>
      updatePane(paneId, (l) => (l.title === title ? l : { ...l, title })),

    setCommandResult: (paneId, lastExitCode, lastDurationMs) =>
      updatePane(paneId, (l) =>
        l.lastExitCode === lastExitCode && l.lastDurationMs === lastDurationMs
          ? l
          : { ...l, lastExitCode, lastDurationMs },
      ),

    markUnread: (tabId, paneId) =>
      set((s) => {
        const tabIdx = s.tabs.findIndex((t) => t.id === tabId);
        if (tabIdx === -1) return s;
        const tab = s.tabs[tabIdx];
        const tabIsActive = tabId === s.activeTabId;
        const paneIsFocused = paneId === tab.activePaneId;
        // Both true: this exact pane is the one being watched right now.
        if (tabIsActive && paneIsFocused) return s;

        const root = updateLeafIn(tab.root, paneId, (l) =>
          l.unread ? l : { ...l, unread: true },
        );
        // Tab-level dot keeps its pre-existing meaning: "the whole tab was
        // in the background" — untouched when the tab itself is active,
        // even if a non-focused sibling pane just produced output.
        const nextTabUnread = tabIsActive ? tab.unread : true;
        if (root === tab.root && nextTabUnread === tab.unread) return s;

        const tabs = [...s.tabs];
        tabs[tabIdx] = { ...tab, root, unread: nextTabUnread };
        return { tabs };
      }),

    markAttention: (tabId, paneId) =>
      set((s) => {
        const tabIdx = s.tabs.findIndex((t) => t.id === tabId);
        if (tabIdx === -1) return s;
        const tab = s.tabs[tabIdx];
        // Watched right now → nothing to flag (same rule as markUnread).
        if (tabId === s.activeTabId && paneId === tab.activePaneId) return s;
        const root = updateLeafIn(tab.root, paneId, (l) =>
          l.attention ? l : { ...l, attention: true },
        );
        if (root === tab.root) return s;
        const tabs = [...s.tabs];
        tabs[tabIdx] = { ...tab, root };
        return { tabs };
      }),

    jumpToAttention: () => {
      const s = get();
      const hit = attentionPanes(s.tabs)[0];
      if (!hit) return false;
      // setActiveTab clears the *current* focused pane's markers; ordering
      // matters — activate the tab first, then focus the flagged pane
      // (which clears its own flag and makes the next call cycle onward).
      get().setActiveTab(hit.tab.id);
      get().setActivePane(hit.tab.id, hit.leaf.id);
      return true;
    },

    toggleBroadcast: (tabId) =>
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, broadcast: !t.broadcast } : t,
        ),
      })),

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

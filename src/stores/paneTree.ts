import type { GitDirty } from "../lib/git";

/**
 * The pane tree: a tab's terminals arranged as a binary tree of splits, the
 * same shape tmux uses.
 *
 * Everything here is pure — types plus structural transforms that take a tree
 * and return a new one. The store (see `ptyStore.ts`) is only responsible for
 * deciding *when* to apply them, which is what makes both halves easy to
 * reason about and to test.
 */

/** A terminal pane holding one PTY session. */
export interface LeafPane {
  type: "leaf";
  id: string;
  sessionId: string | null;
  cwd: string | null;
  agentName: string | null;
  /**
   * When the detected agent in this pane last finished a turn and went quiet
   * waiting on the user — i.e. the moment the idle clock starts. Set by
   * `setPaneBusy` on the busy→idle edge, cleared the moment work resumes, so
   * the timer measures how long the human has been sitting on their reply
   * (which is what the prompt-cache window actually counts), not how long the
   * agent took to answer.
   */
  agentIdleSinceAt: number | null;
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
   * integration, zsh/bash — see `lib/shellIntegration.ts`). Null while a
   * command is running or none has finished yet.
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
  /**
   * The pane is producing sustained output right now — i.e. something is
   * actually running in it. Driven by pty data in `lib/ptySession.ts`
   * (keystroke echo excluded) and cleared after a short silence, so an agent
   * CLI that merely sits at its prompt reads as idle. Session-only, never
   * persisted.
   */
  busy: boolean;
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

export function clampRatio(r: number): number {
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, r));
}

export function makeLeaf(
  initialCwd: string | null = null,
  initialCmd: string | null = null,
): LeafPane {
  return {
    type: "leaf",
    id: crypto.randomUUID(),
    sessionId: null,
    cwd: null,
    agentName: null,
    agentIdleSinceAt: null,
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
    busy: false,
  };
}

export function makeSplit(
  dir: "row" | "col",
  a: PaneNode,
  b: PaneNode,
  ratio = 0.5,
): SplitPane {
  return { type: "split", id: crypto.randomUUID(), dir, ratio, a, b };
}

export function makeTab(root: PaneNode): PtyTab {
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
// Queries

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

export function findParentSplit(
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
// Transforms. Each returns the *same* node when nothing changed, so callers
// can skip a store update — and React can skip re-rendering untouched
// subtrees, since their identity is preserved either way.

export function updateLeafIn(
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

export function updateSplitRatioIn(
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

export function splitLeafIn(
  node: PaneNode,
  paneId: string,
  dir: "row" | "col",
  newLeaf: LeafPane,
): PaneNode {
  if (node.type === "leaf") {
    return node.id === paneId ? makeSplit(dir, node, newLeaf) : node;
  }
  const a = splitLeafIn(node.a, paneId, dir, newLeaf);
  const b = splitLeafIn(node.b, paneId, dir, newLeaf);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** Returns null when `node` itself is the removed leaf. */
export function removeLeafFrom(
  node: PaneNode,
  paneId: string,
): PaneNode | null {
  if (node.type === "leaf") return node.id === paneId ? null : node;
  const a = removeLeafFrom(node.a, paneId);
  if (a === null) return node.b;
  const b = removeLeafFrom(node.b, paneId);
  if (b === null) return node.a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

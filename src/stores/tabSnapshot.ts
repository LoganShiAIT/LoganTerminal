import { readWorkspaceSnapshot } from "./workspaceSnapshot";
import {
  clampRatio,
  makeLeaf,
  makeTab,
  type PaneNode,
  type PtyTab,
} from "./paneTree";

/**
 * Session restore: which directories were open, in which split layout.
 *
 * The pane tree serializes to nested `{dir, ratio, a, b}` with leaves as cwd
 * strings. The legacy format (a flat array of cwds) is a valid subset — a
 * bare string deserializes to a single-leaf tab — so old snapshots keep
 * loading.
 *
 * Deliberately *not* persisted: session ids, agent state, and `initialCmd`.
 * A restored tab comes back as a plain shell in the right directory and never
 * auto-runs anything.
 */

export type PaneSnapshot =
  | string
  | null
  | { dir: "row" | "col"; ratio: number; a: PaneSnapshot; b: PaneSnapshot };

const SNAPSHOT_KEY = "logan.tabSnapshot";
const MAX_RESTORED_TABS = 9;
/** Depth 3 caps a restored tab at 8 leaves = MAX_PANES_PER_TAB. */
const MAX_RESTORE_DEPTH = 3;

export function serializeNode(node: PaneNode): PaneSnapshot {
  if (node.type === "leaf") return node.cwd ?? node.initialCwd;
  return {
    dir: node.dir,
    ratio: node.ratio,
    a: serializeNode(node.a),
    b: serializeNode(node.b),
  };
}

/** Anything unrecognized (or too deep) degrades to a plain empty pane. */
export function deserializeNode(snap: unknown, depth: number): PaneNode {
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

export function loadSnapshotTabs(): PtyTab[] {
  try {
    const workspace = readWorkspaceSnapshot();
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (workspace) {
      return workspace.entries.filter(e => e.kind === "terminal").slice(0, 9).map(e => makeTab(deserializeNode(e.layout, 0)));
    }
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

export function saveSnapshot(tabs: PtyTab[]) {
  try {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify(tabs.map((t) => serializeNode(t.root))),
    );
  } catch {
    // localStorage unavailable or quota exceeded — session restore is best-effort.
  }
}

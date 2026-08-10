import type { Commit } from "./git";

/**
 * Lane layout for the commit graph — the `git log --graph` columns, computed
 * once so the renderer only has to draw lines.
 *
 * The state is one slot per lane holding the hash that lane is *waiting for*.
 * A commit claims the leftmost lane waiting for it (or a fresh one), its first
 * parent inherits that lane, and every other parent either joins a lane
 * already waiting for it or opens one to the right. Lanes waiting for a commit
 * that has already been drawn are freed, which is what makes branches visibly
 * converge.
 */

export interface GraphRow {
  commit: Commit;
  /** Column the commit's node sits in. */
  lane: number;
  /** Lanes crossing this row untouched — plain vertical lines. */
  through: number[];
  /** Lanes ending at this node: curves coming down into it from the right. */
  merging: number[];
  /** Extra parents: curves leaving the node and continuing downward. */
  branching: number[];
  /** The node has a first parent, so its own lane continues below. */
  continues: boolean;
  /** Something above feeds into the node — false for a branch tip. */
  incoming: boolean;
  /** Lanes this row occupies (max index used + 1). */
  width: number;
}

export interface CommitGraph {
  rows: GraphRow[];
  /** Widest row — how much horizontal room the gutter needs. */
  width: number;
}

export function layoutCommitGraph(commits: Commit[]): CommitGraph {
  /** Per lane: the hash that lane is waiting to draw, or null when free. */
  const active: (string | null)[] = [];
  const freeLane = () => {
    const i = active.indexOf(null);
    return i === -1 ? active.length : i;
  };

  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const waiting: number[] = [];
    for (let i = 0; i < active.length; i++) {
      if (active[i] === commit.hash) waiting.push(i);
    }
    const incoming = waiting.length > 0;
    const lane = incoming ? waiting[0] : freeLane();
    const merging = waiting.slice(1);
    for (const i of merging) active[i] = null;
    // Clearing the node's own lane first keeps it out of `through` below.
    active[lane] = null;

    const through: number[] = [];
    for (let i = 0; i < active.length; i++) {
      if (i !== lane && active[i] !== null) through.push(i);
    }

    const [first, ...rest] = commit.parents;
    active[lane] = first ?? null;
    const branching: number[] = [];
    for (const parent of rest) {
      let idx = active.indexOf(parent);
      if (idx === -1) {
        idx = freeLane();
        active[idx] = parent;
      }
      if (idx !== lane && !branching.includes(idx)) branching.push(idx);
    }

    rows.push({
      commit,
      lane,
      through,
      merging,
      branching,
      continues: first !== undefined,
      incoming,
      width: Math.max(lane, ...through, ...merging, ...branching, 0) + 1,
    });

    // Trailing free lanes would otherwise pad the gutter forever.
    while (active.length > 0 && active[active.length - 1] === null) active.pop();
  }

  return {
    rows,
    width: rows.reduce((w, r) => Math.max(w, r.width), 1),
  };
}

import { describe, expect, it } from "vitest";
import { layoutCommitGraph } from "./commitGraph";
import type { Commit } from "./git";

const c = (hash: string, parents: string[] = []): Commit => ({
  hash,
  short: hash,
  parents,
  author: "t",
  timestamp: 0,
  refs: [],
  subject: hash,
  ahead: false,
});

describe("layoutCommitGraph", () => {
  it("keeps linear history in a single lane", () => {
    const g = layoutCommitGraph([c("c", ["b"]), c("b", ["a"]), c("a")]);
    expect(g.width).toBe(1);
    expect(g.rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(g.rows.every((r) => r.through.length === 0)).toBe(true);
    // The tip has nothing above it; the root has nothing below.
    expect(g.rows[0].incoming).toBe(false);
    expect(g.rows[0].continues).toBe(true);
    expect(g.rows[2].continues).toBe(false);
  });

  it("gives a diverged branch its own lane and converges at the fork point", () => {
    // feat and main both sit on top of base.
    const g = layoutCommitGraph([
      c("feat", ["base"]),
      c("main", ["base"]),
      c("base"),
    ]);
    expect(g.width).toBe(2);
    expect(g.rows[0].lane).toBe(0);
    // main opens lane 1; feat's lane crosses that row untouched.
    expect(g.rows[1].lane).toBe(1);
    expect(g.rows[1].through).toEqual([0]);
    expect(g.rows[1].incoming).toBe(false);
    // base is waited for by both lanes: it draws in lane 0, lane 1 ends here.
    expect(g.rows[2].lane).toBe(0);
    expect(g.rows[2].merging).toEqual([1]);
    expect(g.rows[2].through).toEqual([]);
    expect(g.rows[2].continues).toBe(false);
  });

  it("sends a merge commit's second parent into its own lane", () => {
    const g = layoutCommitGraph([
      c("m", ["main1", "side1"]),
      c("main1", ["base"]),
      c("side1", ["base"]),
      c("base"),
    ]);
    expect(g.rows[0].lane).toBe(0);
    expect(g.rows[0].branching).toEqual([1]); // side1 opens lane 1
    expect(g.rows[1].lane).toBe(0);
    expect(g.rows[1].through).toEqual([1]); // side1 still pending
    expect(g.rows[2].lane).toBe(1);
    expect(g.rows[2].through).toEqual([0]); // base pending in main's lane
    expect(g.rows[3].lane).toBe(0);
    expect(g.rows[3].merging).toEqual([1]);
    expect(g.width).toBe(2);
  });

  it("reuses a freed lane instead of drifting right", () => {
    // side closes at `base`, then an unrelated tip appears — it should land
    // back in lane 1 rather than opening a third column.
    const g = layoutCommitGraph([
      c("m", ["main1", "side1"]),
      c("side1", ["base"]),
      c("main1", ["base"]),
      c("base"),
      c("orphan"),
    ]);
    expect(g.rows[4].lane).toBe(0);
    expect(g.width).toBe(2);
  });

  it("handles an empty log and a lone root commit", () => {
    expect(layoutCommitGraph([])).toEqual({ rows: [], width: 1 });
    const solo = layoutCommitGraph([c("only")]);
    expect(solo.rows[0]).toMatchObject({ lane: 0, continues: false, width: 1 });
  });
});

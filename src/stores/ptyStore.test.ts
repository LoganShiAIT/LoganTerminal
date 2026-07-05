import { describe, it, expect, beforeEach, vi } from "vitest";

const SNAPSHOT_KEY = "logan.tabSnapshot";

type PtyModule = typeof import("./ptyStore");

/**
 * ptyStore hydrates from localStorage and registers its persistence
 * subscription at import time, so every test re-imports a fresh module,
 * optionally with a seeded snapshot.
 */
async function fresh(seed?: unknown): Promise<PtyModule> {
  vi.resetModules();
  localStorage.clear();
  if (seed !== undefined) {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(seed));
  }
  return await import("./ptyStore");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("boot", () => {
  it("starts with one default tab holding a single leaf", async () => {
    const m = await fresh();
    const s = m.usePtyStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(s.tabs[0].id);
    expect(s.tabs[0].root.type).toBe("leaf");
    expect(s.tabs[0].broadcast).toBe(false);
    expect(s.tabs[0].zoomedPaneId).toBeNull();
  });
});

describe("tab lifecycle", () => {
  it("addTab activates the new tab and stores its initialCwd", async () => {
    const m = await fresh();
    const id = m.usePtyStore.getState().addTab("/proj");
    const s = m.usePtyStore.getState();
    expect(s.activeTabId).toBe(id);
    const tab = s.tabs.find((t) => t.id === id)!;
    expect(m.firstLeaf(tab.root).initialCwd).toBe("/proj");
  });

  it("addTab stages an optional one-shot command, excluded from the snapshot", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const id = st().addTab("/wt/fix-login", "claude");
    const tab = st().tabs.find((t) => t.id === id)!;
    expect(m.firstLeaf(tab.root).initialCmd).toBe("claude");
    // Blank commands normalize to null.
    const plain = st().addTab("/x", "   ");
    const plainTab = st().tabs.find((t) => t.id === plain)!;
    expect(m.firstLeaf(plainTab.root).initialCmd).toBeNull();
    // The persisted snapshot carries only directories, never commands.
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toContain("claude");
  });

  it("closeTab falls forward to the next tab, then backward, then null", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const a = st().tabs[0].id;
    const b = st().addTab();
    const c = st().addTab();

    st().setActiveTab(b);
    st().closeTab(b);
    expect(st().activeTabId).toBe(c); // falls to the tab that took B's slot

    st().closeTab(c);
    expect(st().activeTabId).toBe(a); // no right neighbor -> previous

    st().closeTab(a);
    expect(st().tabs).toHaveLength(0);
    expect(st().activeTabId).toBeNull();
  });

  it("closing an inactive tab keeps the active one", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const a = st().tabs[0].id;
    const b = st().addTab();
    st().closeTab(a);
    expect(st().activeTabId).toBe(b);
  });

  it("moveTab reorders and ignores out-of-bounds moves", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const a = st().tabs[0].id;
    const b = st().addTab();
    const c = st().addTab();

    st().moveTab(0, 2);
    expect(st().tabs.map((t) => t.id)).toEqual([b, c, a]);

    st().moveTab(2, 5); // out of bounds -> no-op
    st().moveTab(-1, 0);
    expect(st().tabs.map((t) => t.id)).toEqual([b, c, a]);
  });

  it("cycleTab wraps in both directions", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const a = st().tabs[0].id;
    const b = st().addTab();
    const c = st().addTab(); // active

    st().cycleTab(1);
    expect(st().activeTabId).toBe(a); // wrapped past the end
    st().cycleTab(-1);
    expect(st().activeTabId).toBe(c);
    void b;
  });

  it("jumpToTab ignores invalid indices", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().addTab();
    st().jumpToTab(0);
    expect(st().activeTabId).toBe(st().tabs[0].id);
    st().jumpToTab(9);
    expect(st().activeTabId).toBe(st().tabs[0].id);
  });
});

describe("split panes", () => {
  it("splitPane replaces the leaf with a 50/50 split and focuses the new pane", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().addTab("/proj");
    st().splitPane("row");

    const tab = st().tabs[1];
    expect(tab.root.type).toBe("split");
    if (tab.root.type !== "split") return;
    expect(tab.root.dir).toBe("row");
    expect(tab.root.ratio).toBe(0.5);
    // New pane (side b) is focused and inherits the source's directory.
    expect(tab.activePaneId).toBe(m.firstLeaf(tab.root.b).id);
    expect(m.firstLeaf(tab.root.b).initialCwd).toBe("/proj");
  });

  it("splits inherit the live cwd over the initial one", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().addTab("/init");
    const tab = () => st().tabs[1];
    st().setCwd(tab().activePaneId, "/live");
    st().splitPane("col");
    const newLeaf = m.findLeaf(tab().root, tab().activePaneId)!;
    expect(newLeaf.initialCwd).toBe("/live");
  });

  it("caps a tab at MAX_PANES_PER_TAB leaves", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    for (let i = 0; i < m.MAX_PANES_PER_TAB + 3; i++) st().splitPane("row");
    expect(m.collectLeaves(st().tabs[0].root)).toHaveLength(
      m.MAX_PANES_PER_TAB,
    );
  });

  it("closing the only pane closes the whole tab", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const keep = st().addTab();
    st().addTab();
    st().closeActivePane();
    expect(st().tabs.map((t) => t.id)).toEqual([st().tabs[0].id, keep]);
  });

  it("closing a nested pane hands focus to the sibling subtree", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    // L0 | (L1 / L2): split right, then split the new pane down.
    st().splitPane("row");
    const l1 = st().tabs[0].activePaneId;
    st().splitPane("col");
    expect(m.collectLeaves(st().tabs[0].root)).toHaveLength(3);

    st().closeActivePane(); // closes L2; sibling of L2 is L1
    const tab = st().tabs[0];
    expect(m.collectLeaves(tab.root)).toHaveLength(2);
    expect(tab.activePaneId).toBe(l1);
    expect(tab.zoomedPaneId).toBeNull();
  });

  it("cyclePane walks leaves in tree order and wraps", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().splitPane("row");
    st().splitPane("row");
    const tab = () => st().tabs[0];
    const order = m.collectLeaves(tab().root).map((l) => l.id);
    st().setActivePane(tab().id, order[2]);

    st().cyclePane(1);
    expect(tab().activePaneId).toBe(order[0]); // wrap forward
    st().cyclePane(-1);
    expect(tab().activePaneId).toBe(order[2]); // wrap back
  });

  it("setSplitRatio clamps into 0.15–0.85", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().splitPane("row");
    const tab = () => st().tabs[0];
    const rootId = tab().root.id;
    const ratio = () => {
      const root = tab().root;
      return root.type === "split" ? root.ratio : null;
    };

    st().setSplitRatio(tab().id, rootId, 0.05);
    expect(ratio()).toBe(0.15);
    st().setSplitRatio(tab().id, rootId, 0.95);
    expect(ratio()).toBe(0.85);
    st().setSplitRatio(tab().id, rootId, 0.42);
    expect(ratio()).toBe(0.42);
  });

  it("toggleZoom is a no-op on a single leaf and clears on split", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().toggleZoom();
    expect(st().tabs[0].zoomedPaneId).toBeNull();

    st().splitPane("row");
    st().toggleZoom();
    expect(st().tabs[0].zoomedPaneId).toBe(st().tabs[0].activePaneId);
    st().toggleZoom();
    expect(st().tabs[0].zoomedPaneId).toBeNull();

    st().toggleZoom();
    st().splitPane("col"); // splitting always un-zooms
    expect(st().tabs[0].zoomedPaneId).toBeNull();
  });
});

describe("unread and attention", () => {
  it("markUnread is a no-op for the watched pane", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const tab = st().tabs[0];
    st().markUnread(tab.id, tab.activePaneId);
    expect(m.firstLeaf(st().tabs[0].root).unread).toBe(false);
    expect(st().tabs[0].unread).toBe(false);
  });

  it("flags only the pane dot for a background sibling in the active tab", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().splitPane("row");
    const tab = () => st().tabs[0];
    const background = m
      .collectLeaves(tab().root)
      .find((l) => l.id !== tab().activePaneId)!;

    st().markUnread(tab().id, background.id);
    expect(m.findLeaf(tab().root, background.id)!.unread).toBe(true);
    expect(tab().unread).toBe(false); // tab-level dot means "whole tab hidden"
  });

  it("flags pane and tab dots for output in a background tab", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const bg = st().tabs[0];
    st().addTab(); // now active, bg goes background

    st().markUnread(bg.id, bg.activePaneId);
    const bgNow = st().tabs.find((t) => t.id === bg.id)!;
    expect(bgNow.unread).toBe(true);
    expect(m.firstLeaf(bgNow.root).unread).toBe(true);
  });

  it("activating a tab clears its dot and the focused pane's markers only", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const bg = st().tabs[0];
    st().addTab();

    st().markUnread(bg.id, bg.activePaneId);
    st().setActiveTab(bg.id);
    const tab = st().tabs.find((t) => t.id === bg.id)!;
    expect(tab.unread).toBe(false);
    expect(m.firstLeaf(tab.root).unread).toBe(false);
  });

  it("keeps a background sibling's dot when the tab activates", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().splitPane("row"); // active tab, two panes
    const tab = () => st().tabs[0];
    const focused = tab().activePaneId;
    const sibling = m
      .collectLeaves(tab().root)
      .find((l) => l.id !== focused)!;
    st().markUnread(tab().id, sibling.id);

    st().addTab();
    st().setActiveTab(tab().id); // re-activate; sibling still unfocused
    expect(m.findLeaf(st().tabs[0].root, sibling.id)!.unread).toBe(true);

    st().setActivePane(st().tabs[0].id, sibling.id); // focusing clears it
    expect(m.findLeaf(st().tabs[0].root, sibling.id)!.unread).toBe(false);
  });

  it("markAttention respects the watched-pane rule and attentionPanes keeps tab order", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const a = st().tabs[0];
    st().markAttention(a.id, a.activePaneId); // watched -> ignored
    expect(m.attentionPanes(st().tabs)).toHaveLength(0);

    const b = st().addTab();
    const c = st().addTab(); // active
    const bTab = () => st().tabs.find((t) => t.id === b)!;
    st().markAttention(a.id, a.activePaneId);
    st().markAttention(b, bTab().activePaneId);

    const waiting = m.attentionPanes(st().tabs);
    expect(waiting.map((w) => w.tab.id)).toEqual([a.id, b]); // tab order, not mark order
    void c;
  });

  it("jumpToAttention focuses, clears, and cycles through flagged panes", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const a = st().tabs[0];
    const b = st().addTab();
    st().addTab(); // third tab active so a & b are background

    st().markAttention(a.id, a.activePaneId);
    const bTab = st().tabs.find((t) => t.id === b)!;
    st().markAttention(b, bTab.activePaneId);

    expect(st().jumpToAttention()).toBe(true);
    expect(st().activeTabId).toBe(a.id);
    expect(m.attentionPanes(st().tabs)).toHaveLength(1);

    expect(st().jumpToAttention()).toBe(true);
    expect(st().activeTabId).toBe(b);

    expect(st().jumpToAttention()).toBe(false); // nothing left
  });
});

describe("pane field updates", () => {
  it("markPromptSent stamps only the target pane", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().splitPane("row");
    const [l0, l1] = m.collectLeaves(st().tabs[0].root);

    st().markPromptSent(l0.id, 12345);
    const [n0, n1] = m.collectLeaves(st().tabs[0].root);
    expect(n0.lastPromptSentAt).toBe(12345);
    expect(n1.lastPromptSentAt).toBeNull();

    st().markPromptSent(l1.id); // default arg = now
    expect(
      m.collectLeaves(st().tabs[0].root)[1].lastPromptSentAt,
    ).toBeTypeOf("number");
  });

  it("setCommandResult stores results and preserves leaf identity on no-ops", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const paneId = st().tabs[0].activePaneId;

    st().setCommandResult(paneId, 1, 2500);
    const before = m.firstLeaf(st().tabs[0].root);
    expect(before.lastExitCode).toBe(1);
    expect(before.lastDurationMs).toBe(2500);

    st().setCommandResult(paneId, 1, 2500); // identical -> same leaf object
    expect(m.firstLeaf(st().tabs[0].root)).toBe(before);
  });

  it("markPaneExited and toggleBroadcast flip their flags", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const tab = st().tabs[0];

    st().markPaneExited(tab.activePaneId);
    expect(m.firstLeaf(st().tabs[0].root).exited).toBe(true);

    st().toggleBroadcast(tab.id);
    expect(st().tabs[0].broadcast).toBe(true);
    st().toggleBroadcast(tab.id);
    expect(st().tabs[0].broadcast).toBe(false);
  });
});

describe("fleet tabs", () => {
  it("builds a 2-pane row with the command staged on every leaf", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().addTab("/repo");
    const id = st().addFleetTab(2, "claude");

    const tabNow = st().tabs.find((t) => t.id === id)!;
    expect(st().activeTabId).toBe(id);
    expect(tabNow.root.type).toBe("split");
    if (tabNow.root.type !== "split") return;
    expect(tabNow.root.dir).toBe("row");
    const leaves = m.collectLeaves(tabNow.root);
    expect(leaves).toHaveLength(2);
    expect(leaves.map((l) => l.initialCmd)).toEqual(["claude", "claude"]);
    // Inherits the previously-active pane's directory.
    expect(leaves.map((l) => l.initialCwd)).toEqual(["/repo", "/repo"]);
    expect(tabNow.activePaneId).toBe(leaves[0].id);
  });

  it("builds a 2×2 grid of column pairs for 4 panes", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const id = st().addFleetTab(4, "codex");
    const root = st().tabs.find((t) => t.id === id)!.root;
    expect(root.type).toBe("split");
    if (root.type !== "split") return;
    expect(root.dir).toBe("row");
    expect(root.a.type).toBe("split");
    expect(root.b.type).toBe("split");
    if (root.a.type === "split") expect(root.a.dir).toBe("col");
    const leaves = m.collectLeaves(root);
    expect(leaves).toHaveLength(4);
    expect(leaves.every((l) => l.initialCmd === "codex")).toBe(true);
  });

  it("treats blank commands as plain shells", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const id = st().addFleetTab(2, "   ");
    const leaves = m.collectLeaves(st().tabs.find((t) => t.id === id)!.root);
    expect(leaves.every((l) => l.initialCmd === null)).toBe(true);
  });

  it("clearInitialCmd consumes the one-shot command", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const id = st().addFleetTab(2, "claude");
    const [l0] = m.collectLeaves(st().tabs.find((t) => t.id === id)!.root);
    st().clearInitialCmd(l0.id);
    const leaves = m.collectLeaves(st().tabs.find((t) => t.id === id)!.root);
    expect(leaves.map((l) => l.initialCmd)).toEqual([null, "claude"]);
  });

  it("never persists initialCmd into the tab snapshot", async () => {
    const m = await fresh();
    m.usePtyStore.getState().addFleetTab(2, "claude");
    const raw = JSON.stringify(localStorage.getItem(SNAPSHOT_KEY));
    expect(raw).not.toContain("claude");
    // Restoring that snapshot yields plain shells.
    vi.resetModules();
    const m2: PtyModule = await import("./ptyStore");
    const restoredTabs = m2.usePtyStore.getState().tabs;
    const restored = restoredTabs[restoredTabs.length - 1];
    expect(
      m2.collectLeaves(restored.root).every((l) => l.initialCmd === null),
    ).toBe(true);
  });
});

describe("git branch", () => {
  it("setGitBranch stamps only the target pane and preserves identity on no-ops", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().splitPane("row");
    const [l0] = m.collectLeaves(st().tabs[0].root);

    st().setGitBranch(l0.id, "main");
    const [n0, n1] = m.collectLeaves(st().tabs[0].root);
    expect(n0.gitBranch).toBe("main");
    expect(n1.gitBranch).toBeNull();

    st().setGitBranch(l0.id, "main"); // unchanged -> same leaf object
    expect(m.collectLeaves(st().tabs[0].root)[0]).toBe(n0);
  });
});

describe("snapshot persistence", () => {
  it("serializes leaves to cwd strings and splits to {dir,ratio,a,b}", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    st().addTab("/proj");
    st().splitPane("row");

    const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)!);
    expect(raw).toEqual([
      null, // the boot tab never got a cwd
      { dir: "row", ratio: 0.5, a: "/proj", b: "/proj" },
    ]);
  });

  it("does not rewrite the snapshot for non-tab state changes", async () => {
    const m = await fresh();
    const st = () => m.usePtyStore.getState();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    st().setDropPaths(["/dropped"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("restores the legacy flat cwd-array format", async () => {
    const m = await fresh(["/a", "/b", null]);
    const s = m.usePtyStore.getState();
    expect(s.tabs).toHaveLength(3);
    expect(s.activeTabId).toBe(s.tabs[0].id);
    expect(s.tabs.map((t) => m.firstLeaf(t.root).initialCwd)).toEqual([
      "/a",
      "/b",
      null,
    ]);
  });

  it("restores nested splits with dir and clamped ratio", async () => {
    const m = await fresh([
      {
        dir: "col",
        ratio: 0.95, // out of range -> clamped
        a: "/left",
        b: { dir: "row", ratio: "junk", a: "/r1", b: null },
      },
    ]);
    const root = m.usePtyStore.getState().tabs[0].root;
    expect(root.type).toBe("split");
    if (root.type !== "split") return;
    expect(root.dir).toBe("col");
    expect(root.ratio).toBe(0.85);
    expect(root.b.type).toBe("split");
    if (root.b.type !== "split") return;
    expect(root.b.ratio).toBe(0.5); // junk ratio -> default
    expect(m.collectLeaves(root).map((l) => l.initialCwd)).toEqual([
      "/left",
      "/r1",
      null,
    ]);
  });

  it("caps restore depth, collapsing deeper subtrees to empty leaves", async () => {
    type Snap =
      | string
      | { dir: "row"; ratio: number; a: Snap; b: Snap };
    const nest = (n: number): Snap =>
      n === 0
        ? "/deep"
        : { dir: "row", ratio: 0.5, a: nest(n - 1), b: `/lvl${n}` };

    const m = await fresh([nest(4)]);
    const leaves = m.collectLeaves(m.usePtyStore.getState().tabs[0].root);
    expect(leaves.map((l) => l.initialCwd)).toEqual([
      null, // depth-3 subtree collapsed instead of recursing forever
      "/lvl2",
      "/lvl3",
      "/lvl4",
    ]);
  });

  it("restores at most 9 tabs", async () => {
    const m = await fresh(Array.from({ length: 12 }, (_, i) => `/t${i}`));
    expect(m.usePtyStore.getState().tabs).toHaveLength(9);
  });

  it("falls back to one default tab on garbage snapshots", async () => {
    for (const garbage of ["not json {", '"just-a-string"', "{}", "[]"]) {
      vi.resetModules();
      localStorage.clear();
      localStorage.setItem(SNAPSHOT_KEY, garbage);
      const m: PtyModule = await import("./ptyStore");
      const s = m.usePtyStore.getState();
      expect(s.tabs).toHaveLength(1);
      expect(s.tabs[0].root.type).toBe("leaf");
    }
  });
});

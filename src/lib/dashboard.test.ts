import { describe, it, expect } from "vitest";
import { dashboardRows, paneState, waitingCount } from "./dashboard";
import type { LeafPane, PtyTab, PaneNode } from "../stores/ptyStore";

let nextId = 0;
function leaf(overrides: Partial<LeafPane> = {}): LeafPane {
  return {
    type: "leaf",
    id: `leaf-${nextId++}`,
    sessionId: "s",
    cwd: null,
    agentName: null,
    lastPromptSentAt: null,
    title: null,
    initialCwd: null,
    gitBranch: null,
    initialCmd: null,
    exited: false,
    lastExitCode: null,
    lastDurationMs: null,
    unread: false,
    attention: false,
    ...overrides,
  };
}

function tab(root: PaneNode, overrides: Partial<PtyTab> = {}): PtyTab {
  return {
    id: `tab-${nextId++}`,
    root,
    activePaneId: root.type === "leaf" ? root.id : "",
    unread: false,
    zoomedPaneId: null,
    broadcast: false,
    ...overrides,
  };
}

function split(a: PaneNode, b: PaneNode): PaneNode {
  return { type: "split", id: `split-${nextId++}`, dir: "row", ratio: 0.5, a, b };
}

describe("paneState", () => {
  it("applies precedence exited > attention > agent > idle", () => {
    expect(paneState(leaf({ exited: true, attention: true, agentName: "claude" }))).toBe("exited");
    expect(paneState(leaf({ attention: true, agentName: "claude" }))).toBe("attention");
    expect(paneState(leaf({ agentName: "claude" }))).toBe("agent");
    expect(paneState(leaf())).toBe("idle");
  });
});

describe("dashboardRows", () => {
  it("flattens panes in tab order then tree order", () => {
    const a1 = leaf({ cwd: "/a1" });
    const a2 = leaf({ cwd: "/a2" });
    const b1 = leaf({ cwd: "/b1" });
    const tabs = [
      tab(split(a1, a2), { activePaneId: a2.id }),
      tab(b1),
    ];
    const rows = dashboardRows(tabs, tabs[0].id);
    expect(rows.map((r) => r.cwd)).toEqual(["/a1", "/a2", "/b1"]);
    expect(rows.map((r) => r.tabIndex)).toEqual([0, 0, 1]);
  });

  it("marks the watched pane (focused pane of the active tab) only", () => {
    const a1 = leaf();
    const a2 = leaf();
    const b1 = leaf();
    const tabs = [
      tab(split(a1, a2), { activePaneId: a1.id }),
      tab(b1), // focused in its tab, but the tab is inactive
    ];
    const rows = dashboardRows(tabs, tabs[0].id);
    expect(rows.map((r) => r.watched)).toEqual([true, false, false]);
    expect(rows.map((r) => r.focused)).toEqual([true, false, true]);
  });

  it("prefers cwd over initialCwd and carries branch/timer/title through", () => {
    const l = leaf({
      cwd: "/live",
      initialCwd: "/init",
      gitBranch: "feature/x",
      lastPromptSentAt: 123,
      title: "claude — repl",
    });
    const rows = dashboardRows([tab(l)], null);
    expect(rows[0].cwd).toBe("/live");
    expect(rows[0].gitBranch).toBe("feature/x");
    expect(rows[0].lastPromptSentAt).toBe(123);
    expect(rows[0].title).toBe("claude — repl");

    const fallback = dashboardRows([tab(leaf({ initialCwd: "/init" }))], null);
    expect(fallback[0].cwd).toBe("/init");
  });

  it("counts attention panes", () => {
    const tabs = [
      tab(split(leaf({ attention: true }), leaf({ agentName: "claude" }))),
      tab(leaf({ attention: true, exited: true })), // exited wins precedence
    ];
    const rows = dashboardRows(tabs, null);
    expect(waitingCount(rows)).toBe(1);
  });
});

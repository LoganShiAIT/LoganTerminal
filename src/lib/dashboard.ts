import { collectLeaves, type LeafPane, type PtyTab } from "../stores/ptyStore";
import type { GitDirty } from "./git";

/**
 * Display state of a pane in the agent overview, by precedence:
 * a dead shell trumps everything, a needs-a-human flag trumps a merely
 * running agent, and anything else is an idle shell.
 */
export type PaneState = "exited" | "attention" | "agent" | "idle";

export interface DashboardRow {
  tabId: string;
  /** 0-based; the UI shows tabIndex + 1 to match ⌘1-9. */
  tabIndex: number;
  paneId: string;
  state: PaneState;
  /** Detected agent CLI name, if any (independent of state precedence). */
  agentName: string | null;
  /** Best display label: OSC 0/2 title, else cwd (caller renders basename). */
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  /** Uncommitted-change counts — surfaces which agents touched files. */
  gitDirty: GitDirty | null;
  unread: boolean;
  lastPromptSentAt: number | null;
  /** This pane is its tab's focused pane. */
  focused: boolean;
  /** ...and that tab is the active one (i.e. the pane being watched now). */
  watched: boolean;
}

export function paneState(leaf: LeafPane): PaneState {
  if (leaf.exited) return "exited";
  if (leaf.attention) return "attention";
  if (leaf.agentName) return "agent";
  return "idle";
}

/** Flat projection of every pane, in tab order then pane-tree order. */
export function dashboardRows(
  tabs: PtyTab[],
  activeTabId: string | null,
): DashboardRow[] {
  const rows: DashboardRow[] = [];
  tabs.forEach((tab, tabIndex) => {
    for (const leaf of collectLeaves(tab.root)) {
      const focused = leaf.id === tab.activePaneId;
      rows.push({
        tabId: tab.id,
        tabIndex,
        paneId: leaf.id,
        state: paneState(leaf),
        agentName: leaf.agentName,
        title: leaf.title,
        cwd: leaf.cwd ?? leaf.initialCwd,
        gitBranch: leaf.gitBranch,
        gitDirty: leaf.gitDirty,
        unread: leaf.unread,
        lastPromptSentAt: leaf.lastPromptSentAt,
        focused,
        watched: focused && tab.id === activeTabId,
      });
    }
  });
  return rows;
}

/** Panes worth surfacing first: attention beats everything, then agents. */
export function waitingCount(rows: DashboardRow[]): number {
  return rows.filter((r) => r.state === "attention").length;
}

import {
  activeLeafOf,
  attentionPanes,
  type PtyTab,
} from "../../../stores/ptyStore";
import { dirLabel } from "../../../lib/paths";
import { kbd } from "../../../lib/keys";
import { t } from "../../../i18n";
import { pty, ui, type PaletteAction } from "./types";

/**
 * The fleet-management commands. Panes flagged for attention come first in
 * the whole palette — they are the "why did it just ping me" flow, and the
 * answer should be one keystroke away.
 */
export function agentActions(
  tabs: PtyTab[],
  activeTabId: string | null,
  fleetCommand: string,
): PaletteAction[] {
  const group = t("Agents");
  const actions: PaletteAction[] = [];

  const attn = attentionPanes(tabs);
  if (attn.length > 0) {
    actions.push({
      id: "attn-next",
      group,
      label: t("Go to pane needing attention ({n} waiting)", { n: attn.length }),
      transient: true,
      run: () => pty().jumpToAttention(),
    });
    for (const { tab, tabIndex, leaf } of attn) {
      const cwd = leaf.cwd ?? leaf.initialCwd;
      actions.push({
        id: `attn-${leaf.id}`,
        group,
        label: t("{agent} needs attention — tab {n}{where}", {
          agent: leaf.agentName ?? t("shell"),
          n: tabIndex + 1,
          where: cwd ? ` · ${dirLabel(cwd)}` : "",
        }),
        transient: true,
        run: () => {
          pty().setActiveTab(tab.id);
          pty().setActivePane(tab.id, leaf.id);
        },
      });
    }
  }

  actions.push(
    {
      id: "agent-overview",
      group,
      label: t("Agent overview — every pane, state, branch"),
      hint: kbd("⌘⇧O"),
      keepFocus: true,
      run: () => ui().setDashboardOpen(true),
    },
    {
      id: "worktree-modal",
      group,
      label: t("Worktrees — new agent worktree / manage"),
      hint: kbd("⌘⇧N"),
      keepFocus: true,
      run: () => ui().setWorktreeModalOpen(true),
    },
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activePane = activeTab ? activeLeafOf(activeTab) : null;
  if (activePane && !activePane.exited) {
    actions.push({
      id: "agent-prompt-timer-reset",
      group,
      label: t("Start/reset idle timer"),
      run: () => pty().markAgentIdle(activePane.id),
    });
  }

  // Fleet spawn — clave-style grid + claude-squad-style launch command.
  const fleetCmd = fleetCommand.trim();
  const fleetLabel = fleetCmd
    ? t("running `{cmd}`", { cmd: fleetCmd })
    : t("plain shells");
  for (const panes of [2, 4] as const) {
    actions.push({
      id: `fleet-new-${panes}`,
      group,
      label: t("New fleet tab — {panes}, {cmd}", {
        panes: panes === 2 ? t("2 panes") : t("2×2 grid"),
        cmd: fleetLabel,
      }),
      run: () => pty().addFleetTab(panes, fleetCmd || null),
    });
  }

  return actions;
}

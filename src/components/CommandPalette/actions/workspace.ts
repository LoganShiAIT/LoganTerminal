import { workspaceCwd, cycleWorkspace, closeWorkspace } from "../../../lib/workspace";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import {
  activeLeafOf,
  type PtyTab,
} from "../../../stores/ptyStore";
import { dirLabel } from "../../../lib/paths";
import { kbd } from "../../../lib/keys";
import { t } from "../../../i18n";
import { pty, type PaletteAction } from "./types";

/** Jump-to-tab entries plus the tab lifecycle commands. */
export function tabActions(
  tabs: PtyTab[],
  activeTabId: string | null,
): PaletteAction[] {
  const group = t("Tabs");
  const actions: PaletteAction[] = tabs.map((tab, i) => {
    const leaf = activeLeafOf(tab);
    const cwd = leaf.cwd ?? leaf.initialCwd;
    return {
      id: `tab-${tab.id}`,
      group,
      label: t("Go to tab {n} — {where}", {
        n: i + 1,
        where: cwd ? dirLabel(cwd) : t("shell"),
      }),
      hint: i < 9 ? kbd(`⌘${i + 1}`) : undefined,
      active: tab.id === activeTabId,
      transient: true,
      run: () => pty().setActiveTab(tab.id),
    };
  });

  actions.push(
    {
      id: "tab-new",
      group,
      label: t("New tab"),
      hint: kbd("⌘T"),
      run: () => {
        pty().addTab(workspaceCwd());
      },
    },
    {
      id: "tab-close",
      group,
      label: t("Close current tab"),
      run: () => {
        const id = useWorkspaceStore.getState().activeId;
        if (id) closeWorkspace(id);
      },
    },
    {
      id: "tab-next",
      group,
      label: t("Next tab"),
      hint: kbd("⌘⇧]"),
      run: () => cycleWorkspace(1),
    },
    {
      id: "tab-prev",
      group,
      label: t("Previous tab"),
      hint: kbd("⌘⇧["),
      run: () => cycleWorkspace(-1),
    },
  );

  return actions;
}

/** Splitting, focus, zoom and broadcast — everything inside one tab. */
export function paneActions(
  tabs: PtyTab[],
  activeTabId: string | null,
): PaletteAction[] {
  const group = t("Panes");
  return [
    {
      id: "pane-split-right",
      group,
      label: t("Split pane right"),
      hint: kbd("⌘D"),
      run: () => pty().splitPane("row"),
    },
    {
      id: "pane-split-down",
      group,
      label: t("Split pane down"),
      hint: kbd("⌘⇧D"),
      run: () => pty().splitPane("col"),
    },
    {
      id: "pane-close",
      group,
      label: t("Close pane (last pane closes the tab)"),
      hint: kbd("⌘⇧W"),
      run: () => pty().closeActivePane(),
    },
    {
      id: "pane-next",
      group,
      label: t("Focus next pane"),
      run: () => pty().cyclePane(1),
    },
    {
      id: "pane-zoom",
      group,
      label: t("Toggle pane zoom (maximize)"),
      hint: kbd("⌘⇧Z"),
      run: () => pty().toggleZoom(),
    },
    {
      id: "pane-broadcast",
      group,
      label: t("Toggle broadcast input (type into all panes)"),
      hint: kbd("⌘⌥I"),
      active: tabs.find((tab) => tab.id === activeTabId)?.broadcast ?? false,
      run: () => {
        const s = pty();
        if (s.activeTabId) s.toggleBroadcast(s.activeTabId);
      },
    },
  ];
}
